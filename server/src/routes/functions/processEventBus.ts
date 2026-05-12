/**
 * processEventBus.ts — OTX-001/002/003/004 orchestration entry point.
 *
 * Called by runFullScan (or on demand) to:
 *   1. Fetch pending SystemEvents from the bus
 *   2. Route each event to relevant agents (OTX-001)
 *   3. Fuse related signals into composite representations (OTX-002)
 *   4. Score candidate actions (OTX-002)
 *   5. Decide: auto-execute / present / discard (OTX-003)
 *   6. Validate against business constraints (OTX-004)
 *   7. Create AutoAction records with full decision metadata
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { fetchPendingEvents, markProcessed } from '../../lib/eventBus';
import { processPendingEvents } from '../../lib/routingEngine';
import {
  normalizeSignal,
  fuseSignals,
  scoreCandidateActions,
  createCompositeSignal,
} from '../../lib/signalProcessor';
import { decide, createActionWithDecision } from '../../lib/executionDecider';
import { validateAction, ensureConstraints } from '../../lib/constraintValidator';

export async function processEventBus(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  let processed = 0;
  let actionsCreated = 0;

  try {
    // Ensure business has default constraints
    await ensureConstraints(businessProfileId);

    // ── Step 1: Fetch pending events ────────────────────────────────────────
    const pendingEvents = await fetchPendingEvents(businessProfileId, 30);
    if (pendingEvents.length === 0) {
      return res.json({ processed: 0, actions_created: 0, message: 'No pending events' });
    }

    // ── Step 2: Route events (OTX-001) ──────────────────────────────────────
    const dispatches = await processPendingEvents(pendingEvents);
    processed = dispatches.length;

    // ── Step 3: Fetch recent MarketSignals for fusion (OTX-002) ─────────────
    const recentSignals = await prisma.marketSignal.findMany({
      where: {
        linked_business: businessProfileId,
        is_dismissed:    false,
        detected_at:     { gte: new Date(Date.now() - 48 * 3600 * 1000).toISOString() },
      },
      orderBy: { detected_at: 'desc' },
      take: 30,
    });

    const signalObjects = recentSignals.map(normalizeSignal);

    // ── Step 4: Fuse signals into composite groups (OTX-002) ─────────────────
    const fusedGroups = fuseSignals(signalObjects);

    // ── Step 5: Score + decide + validate for each high-value group ──────────
    for (const group of fusedGroups) {
      if (group.length === 0) continue;

      // Use the highest-confidence signal in the group as the representative
      const representative = group.reduce((best, s) => s.confidence > best.confidence ? s : best, group[0]);

      // Build candidate actions based on signal type
      const rawCandidates = buildCandidateActions(representative);
      if (rawCandidates.length === 0) continue;

      // Score candidates (OTX-002)
      const scored = await scoreCandidateActions(rawCandidates, representative, businessProfileId);
      const topAction = scored[0];
      if (!topAction || topAction.score < 50) continue;

      // Determine fusion type
      const fusionType = group.length > 1
        ? (group.every(s => s.category === group[0].category) ? 'semantic' : 'multi')
        : 'temporal';

      // Create composite signal record (OTX-002)
      const composite = await createCompositeSignal(
        businessProfileId,
        group,
        fusionType,
        topAction,
        scored
      );

      // Execution decision (OTX-003)
      const decisionInput = {
        businessId:     businessProfileId,
        actionType:     topAction.type,
        confidenceScore: topAction.score,
        predictedImpact: representative.impact,
        contextAttrs: {
          hour:     new Date().getHours(),
          hasToken: true, // caller verifies actual token availability
        },
      };

      // Constraint validation (OTX-004)
      const validation = await validateAction(businessProfileId, {
        type:    topAction.type,
        content: topAction.prefilledText,
      });

      if (!validation.valid) {
        // Hard violation — skip this action
        await prisma.compositeSignal.update({
          where: { id: composite.id },
          data:  { status: 'dismissed' },
        });
        continue;
      }

      // Create the AutoAction with full decision metadata (OTX-003)
      const { decision: decisionResult } = await createActionWithDecision({
        businessId:   businessProfileId,
        agentName:    representative.source,
        actionType:   topAction.type,
        description:  topAction.description,
        payload: {
          label:          topAction.label,
          prefilled_text: validation.action.content || topAction.prefilledText || '',
          source_signal:  representative.id,
          composite_id:   composite.id,
        },
        revenueImpact: representative.impact === 'high' ? 500 : 200,
        decisionInput,
      });

      // Update composite signal with constraint notes
      await prisma.compositeSignal.update({
        where: { id: composite.id },
        data: {
          status: decisionResult.decision === 'discard' ? 'dismissed' : 'scored',
        },
      });

      if (decisionResult.decision !== 'discard') {
        actionsCreated++;
      }
    }

    // ── Step 6: Mark all dispatched events as processed ─────────────────────
    for (const dispatch of dispatches) {
      await markProcessed(dispatch.eventId);
    }

    return res.json({
      pending_events:  pendingEvents.length,
      processed,
      signal_groups:   fusedGroups.length,
      actions_created: actionsCreated,
      elapsed_ms:      Date.now() - new Date(startTime).getTime(),
    });

  } catch (err: any) {
    console.error('[processEventBus] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── Build candidate actions from a signal ────────────────────────────────────
function buildCandidateActions(signal: ReturnType<typeof normalizeSignal>) {
  const candidates: Array<{
    type: string;
    label: string;
    description: string;
    prefilledText?: string;
  }> = [];

  const { category, summary, impact } = signal;

  // Always offer a social post
  if (['local_event', 'sports_match', 'market_signal', 'general', 'seasonal_promo', 'event'].includes(category)) {
    candidates.push({
      type:        'social_post',
      label:       `📣 פרסם על: ${summary.slice(0, 40)}`,
      description: `פוסט שיווקי לרגל: ${summary}`,
      prefilledText: (signal.rawPayload as any)?.prefilled_text || '',
    });
  }

  // Campaign for high-impact signals
  if (impact === 'high') {
    candidates.push({
      type:        'campaign',
      label:       `🎯 קמפיין: ${summary.slice(0, 40)}`,
      description: `קמפיין ממומן המבוסס על: ${summary}`,
    });
  }

  // Review reply for review signals
  if (category === 'review' || category === 'reputation') {
    candidates.push({
      type:        'review_reply',
      label:       `💬 הגב לביקורת`,
      description: `תגובה לביקורת: ${summary}`,
      prefilledText: (signal.rawPayload as any)?.prefilled_text || '',
    });
  }

  return candidates;
}
