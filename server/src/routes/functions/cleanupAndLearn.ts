/**
 * cleanupAndLearn — Platform maintenance + ML learning agent.
 *
 * Phase 1 — CLEANUP:
 *   • Archive stale MarketSignals (unread + low-confidence + old, or very old)
 *   • Remove duplicate signals (same summary — keep newest)
 *   • Archive Competitor records not refreshed in 90+ days
 *   • Prune expired OTX decisions
 *
 * Phase 2 — LEARN:
 *   • Score signal quality: which categories generated Tasks/Actions?
 *   • Track which platforms produce the most actionable signals
 *   • Update AgentLearningProfile per source agent
 *   • Update BusinessMemory: preferred categories, signal patterns
 *   • Run winner-DNA extraction + feedback cycle
 *
 * Phase 3 — OPTIMIZE:
 *   • Raise confidence thresholds for high-noise categories
 *   • Update SectorKnowledge with cleaned signal patterns
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { runMLLearning } from './learnFromClosedDeals';
import { runMLLearningCycle } from './runMLLearningCycle';

async function callHandler(fn: Function, businessProfileId: string): Promise<any> {
  return new Promise((resolve) => {
    const fakeReq = { body: { businessProfileId } } as Request;
    let done = false;
    const fakeRes: any = {
      json: (data: any) => { if (!done) { done = true; resolve(data); } return fakeRes; },
      status: (_: number) => fakeRes,
    };
    Promise.resolve(fn(fakeReq, fakeRes)).catch((e: any) => {
      if (!done) { done = true; resolve({ error: e.message }); }
    });
  });
}

export async function cleanupAndLearn(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  const stats = {
    signals_archived: 0,
    duplicates_removed: 0,
    competitors_archived: 0,
    decisions_pruned: 0,
    alerts_dismissed: 0,
    ml_cycles_run: 0,
    patterns_learned: 0,
  };

  try {
    const now = new Date();
    const thirtyDaysAgo   = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo    = new Date(now.getTime() -  7 * 24 * 60 * 60 * 1000).toISOString();
    const ninetyDaysAgo   = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // ── Phase 1A: Delete read signals older than 30 days ─────────────────────
    const readOldDelete = await prisma.marketSignal.deleteMany({
      where: {
        linked_business: businessProfileId,
        is_read: true,
        detected_at: { lt: thirtyDaysAgo },
      },
    });
    stats.signals_archived += readOldDelete.count;

    // ── Phase 1A2: Delete ALL signals older than 90 days ─────────────────────
    const veryOldDelete = await prisma.marketSignal.deleteMany({
      where: {
        linked_business: businessProfileId,
        detected_at: { lt: ninetyDaysAgo },
      },
    });
    stats.signals_archived += veryOldDelete.count;

    // ── Phase 1B: Delete unread + low-confidence signals older than 7 days ───
    const staleDelete = await prisma.marketSignal.deleteMany({
      where: {
        linked_business: businessProfileId,
        is_read: false,
        confidence: { lt: 35 },
        detected_at: { lt: sevenDaysAgo },
      },
    });
    stats.signals_archived += staleDelete.count;

    // ── Phase 1B2: Delete dismissed signals older than 7 days ────────────────
    const dismissedDelete = await prisma.marketSignal.deleteMany({
      where: {
        linked_business: businessProfileId,
        is_dismissed: true,
        detected_at: { lt: sevenDaysAgo },
      },
    });
    stats.signals_archived += dismissedDelete.count;

    // ── Phase 1C: Remove duplicate signals (same summary, keep newest) ───────
    const allSignals = await prisma.marketSignal.findMany({
      where: { linked_business: businessProfileId },
      orderBy: { detected_at: 'desc' },
      select: { id: true, summary: true },
    });

    const seenSummaries = new Map<string, string>(); // summary → id of newest
    const idsToDelete: string[] = [];

    for (const s of allSignals) {
      const key = (s.summary || '').trim().slice(0, 80).toLowerCase();
      if (seenSummaries.has(key)) {
        idsToDelete.push(s.id);
      } else {
        seenSummaries.set(key, s.id);
      }
    }

    if (idsToDelete.length > 0) {
      const dupDelete = await prisma.marketSignal.deleteMany({
        where: { id: { in: idsToDelete } },
      });
      stats.duplicates_removed = dupDelete.count;
    }

    // ── Phase 1D: Archive old competitors ────────────────────────────────────
    // Competitors not refreshed in 60 days get their data cleared (keep record for learning)
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const staleCompetitors = await prisma.competitor.findMany({
      where: {
        linked_business: businessProfileId,
        OR: [
          { last_scanned: { lt: sixtyDaysAgo } },
          { last_scanned: null },
        ],
      },
      select: { id: true },
    });

    if (staleCompetitors.length > 0) {
      await prisma.competitor.updateMany({
        where: { id: { in: staleCompetitors.map(c => c.id) } },
        data: {
          data_freshness: 'archived',
          battlecard_content: null,
          current_promotions: null,
          recent_reviews_summary: null,
        },
      });
      stats.competitors_archived = staleCompetitors.length;
    }

    // ── Phase 1E: Prune completed/expired OTX decisions ──────────────────────
    try {
      const pruneResult = await prisma.$executeRawUnsafe(
        `DELETE FROM otx_decisions
         WHERE business_id = $1
           AND created_at < $2::timestamptz
           AND (status = 'completed' OR status = 'expired' OR expires_at < now())`,
        businessProfileId,
        thirtyDaysAgo,
      );
      stats.decisions_pruned = pruneResult as number;
    } catch (_) {
      // otx_decisions may not exist yet — safe to ignore
    }

    // ── Phase 1F: ProactiveAlert cleanup ──────────────────────────────────────
    // 1. Delete already-dismissed alerts older than 7 days
    await prisma.proactiveAlert.deleteMany({
      where: {
        linked_business: businessProfileId,
        is_dismissed: true,
        created_at: { lt: sevenDaysAgo },
      },
    });

    // 2. Auto-dismiss non-critical undismissed alerts older than 7 days
    const oldAlertsDismiss = await prisma.proactiveAlert.updateMany({
      where: {
        linked_business: businessProfileId,
        is_dismissed: false,
        priority: { not: 'critical' },
        created_at: { lt: sevenDaysAgo },
      },
      data: { is_dismissed: true },
    });
    stats.alerts_dismissed += oldAlertsDismiss.count;

    // 3. Auto-dismiss event-related alerts where the event date has already passed
    //    (title pattern: "📅 שם אירוע — בעוד X ימים", check description for past date)
    const eventAlerts = await prisma.proactiveAlert.findMany({
      where: {
        linked_business: businessProfileId,
        is_dismissed: false,
        alert_type: 'market_opportunity',
      },
      select: { id: true, description: true, created_at: true },
    });

    const pastEventIds: string[] = [];
    for (const alert of eventAlerts) {
      // Detect alerts whose "X ימים" count has expired — created more than 30 days ago
      // OR description contains a past date string
      const desc = alert.description || '';
      // Parse dates like "30.4.2026" or "22.4.2026" from the description
      const dateMatch = desc.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (dateMatch) {
        const eventDate = new Date(
          parseInt(dateMatch[3]),
          parseInt(dateMatch[2]) - 1,
          parseInt(dateMatch[1]),
        );
        if (eventDate < now) {
          pastEventIds.push(alert.id);
        }
      }
    }

    if (pastEventIds.length > 0) {
      await prisma.proactiveAlert.updateMany({
        where: { id: { in: pastEventIds } },
        data: { is_dismissed: true },
      });
      stats.alerts_dismissed += pastEventIds.length;
    }

    // 4. Cap undismissed alerts to max 10 — dismiss lowest-priority oldest ones
    const priorityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const activeAlerts = await prisma.proactiveAlert.findMany({
      where: { linked_business: businessProfileId, is_dismissed: false },
      select: { id: true, priority: true, created_at: true },
      orderBy: { created_at: 'desc' },
    });

    if (activeAlerts.length > 10) {
      // Sort: critical first, then high, medium, low — within same priority newest first
      const sorted = [...activeAlerts].sort((a, b) => {
        const pa = priorityRank[a.priority || 'low'] ?? 3;
        const pb = priorityRank[b.priority || 'low'] ?? 3;
        if (pa !== pb) return pa - pb;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      const toDismiss = sorted.slice(10).map(a => a.id);
      if (toDismiss.length > 0) {
        await prisma.proactiveAlert.updateMany({
          where: { id: { in: toDismiss } },
          data: { is_dismissed: true },
        });
        stats.alerts_dismissed += toDismiss.length;
      }
    }

    // ── Phase 2: LEARN from signal quality ───────────────────────────────────
    const retainedSignals = await prisma.marketSignal.findMany({
      where: { linked_business: businessProfileId },
      select: { id: true, category: true, confidence: true, is_read: true, recommended_action: true },
    });

    const tasks = await prisma.task.findMany({
      where: { linked_business: businessProfileId },
      select: { source_alert_id: true, status: true, source_type: true },
    });

    const outcomeLogs = await prisma.outcomeLog.findMany({
      where: { linked_business: businessProfileId },
      select: { action_type: true, was_accepted: true, impact_score: true },
    });

    const feedbackEvents = await prisma.feedbackEvent.findMany({
      where: { linked_business: businessProfileId },
      select: { agent_name: true, output_type: true, score: true, rating: true },
    });

    // Signal quality: which categories had tasks created from them
    const actionedSignalIds = new Set(tasks.map(t => t.source_alert_id).filter(Boolean));
    const categoryQuality: Record<string, { total: number; actioned: number }> = {};

    for (const s of retainedSignals) {
      const cat = s.category || 'unknown';
      if (!categoryQuality[cat]) categoryQuality[cat] = { total: 0, actioned: 0 };
      categoryQuality[cat].total++;
      if (actionedSignalIds.has(s.id)) categoryQuality[cat].actioned++;
    }

    // Agent quality from feedback
    const agentScores: Record<string, { total: number; sumScore: number }> = {};
    for (const f of feedbackEvents) {
      const agent = f.agent_name || 'unknown';
      if (!agentScores[agent]) agentScores[agent] = { total: 0, sumScore: 0 };
      agentScores[agent].total++;
      agentScores[agent].sumScore += (f.score || (f.rating === 'positive' ? 1 : f.rating === 'negative' ? -1 : 0));
    }

    // Outcome acceptance rate
    const totalOutcomes = outcomeLogs.length;
    const acceptedOutcomes = outcomeLogs.filter(o => o.was_accepted).length;
    const outcomeAcceptanceRate = totalOutcomes > 0 ? Math.round((acceptedOutcomes / totalOutcomes) * 100) : 0;

    // Build learning summary for AI
    const qualitySummary = Object.entries(categoryQuality)
      .map(([cat, q]) => `${cat}: ${q.actioned}/${q.total} actioned (${Math.round(q.actioned / Math.max(q.total, 1) * 100)}%)`)
      .join(', ');

    const agentSummary = Object.entries(agentScores)
      .map(([agent, s]) => `${agent}: avg=${(s.sumScore / Math.max(s.total, 1)).toFixed(2)} (${s.total} events)`)
      .join(', ');

    // AI synthesizes learning patterns
    if (retainedSignals.length > 0) {
      const learningResult = await invokeLLM({
        model: 'sonnet',
        prompt: `אתה מנוע ML עבור פלטפורמת מודיעין עסקי. נתח את הנתונים ולמד מהם.

נתוני ביצועים:
- אותות שנשמרו: ${retainedSignals.length} (לאחר ניקוי)
- קטגוריות: ${qualitySummary || 'אין נתונים'}
- סוכנים: ${agentSummary || 'אין נתונים'}
- אחוז קבלת המלצות: ${outcomeAcceptanceRate}%

זהה:
1. אילו קטגוריות אותות מייצרות ערך אמיתי (גבוה = actioned/total גבוה)
2. אילו סוכנים עובדים טוב (score חיובי)
3. מה לשפר בפעולה הבאה

JSON בלבד:
{
  "high_value_categories": ["cat1", "cat2"],
  "low_value_categories": ["cat3"],
  "top_agents": ["agent1"],
  "weak_agents": ["agent2"],
  "recommended_confidence_threshold": 50-80,
  "key_learning": "משפט אחד — המסקנה הכי חשובה",
  "next_action": "מה לעשות אחרת בסריקה הבאה"
}`,
        response_json_schema: { type: 'object' },
      });

      if (learningResult) {
        stats.patterns_learned = (learningResult.high_value_categories?.length || 0) +
                                  (learningResult.low_value_categories?.length || 0);

        // Update BusinessMemory with learned patterns
        try {
          const existing = await prisma.businessMemory.findFirst({
            where: { linked_business: businessProfileId },
          });

          const summary = `קטגוריות בעלות ערך: ${(learningResult.high_value_categories || []).join(', ')}. ` +
            `סוכנים מובילים: ${(learningResult.top_agents || []).join(', ')}. ` +
            `מסקנה: ${learningResult.key_learning || ''}`;

          if (existing) {
            await prisma.businessMemory.update({
              where: { id: existing.id },
              data: {
                feedback_summary: summary,
                last_updated: new Date().toISOString(),
                learning_version: { increment: 1 },
              },
            });
          } else {
            await prisma.businessMemory.create({
              data: {
                linked_business: businessProfileId,
                feedback_summary: summary,
                last_updated: new Date().toISOString(),
                learning_version: 1,
              },
            });
          }
        } catch (_) {}

        // Update AgentLearningProfile for each scored agent
        for (const [agentName, score] of Object.entries(agentScores)) {
          try {
            const isTop = (learningResult.top_agents || []).includes(agentName);
            const isWeak = (learningResult.weak_agents || []).includes(agentName);
            const newAccuracy = isTop ? 0.75 : isWeak ? 0.35 : 0.5;

            await prisma.agentLearningProfile.upsert({
              where: { linked_business_agent_name: { linked_business: businessProfileId, agent_name: agentName } },
              create: {
                linked_business: businessProfileId,
                agent_name: agentName,
                total_outputs: score.total,
                accuracy_score: newAccuracy,
                last_updated: new Date().toISOString(),
              },
              update: {
                total_outputs: { increment: score.total },
                accuracy_score: newAccuracy,
                last_updated: new Date().toISOString(),
              },
            });
          } catch (_) {}
        }
      }
    }

    // ── Phase 3: Run ML learning cycles ──────────────────────────────────────
    await callHandler(runMLLearning, businessProfileId);
    await callHandler(runMLLearningCycle, businessProfileId);
    stats.ml_cycles_run = 2;

    await writeAutomationLog('cleanupAndLearn', businessProfileId, startTime,
      stats.signals_archived + stats.duplicates_removed);

    return res.json({
      success: true,
      ...stats,
      message: `ניקוי: ${stats.signals_archived} אותות ישנים, ${stats.duplicates_removed} כפולות, ${stats.competitors_archived} מתחרים ארכיון, ${stats.alerts_dismissed} התראות ישנות. למידה: ${stats.ml_cycles_run} מחזורי ML, ${stats.patterns_learned} תבניות.`,
    });

  } catch (err: any) {
    console.error('[cleanupAndLearn] error:', err.message);
    await writeAutomationLog('cleanupAndLearn', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
