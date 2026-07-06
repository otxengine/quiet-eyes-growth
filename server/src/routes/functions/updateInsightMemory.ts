import { Request, Response } from 'express';
import { prisma } from '../../db';

/**
 * updateInsightMemory — called when user acts on or dismisses an insight.
 *
 * action='completed': records what types/platforms the user responds to → accepted_patterns
 * action='dismissed': records title keywords + reason the user ignores → rejected_patterns
 *
 * entityType: 'alert' | 'signal' | 'competitor' | 'event' | 'retention'
 * entityId:   optional — if provided, marks the entity as dismissed in DB
 * reason:     optional free-text why not relevant
 *
 * Both update agent_weights so agents learn over time.
 */
export async function updateInsightMemory(req: Request, res: Response) {
  const { businessProfileId, alertType, actionPlatform, title, action, entityType, entityId, reason } = req.body;
  if (!businessProfileId || !action) return res.status(400).json({ error: 'Missing required fields' });

  try {
    // ── Entity-level dismiss: mark the specific DB record as dismissed ──────
    if (action === 'dismissed' && entityId) {
      const dismissData = { is_dismissed: true, ...(reason ? { dismiss_reason: reason } : {}) };
      if (entityType === 'signal') {
        await prisma.marketSignal.update({ where: { id: entityId }, data: dismissData }).catch(() => {});
      } else if (entityType === 'alert') {
        await prisma.proactiveAlert.update({ where: { id: entityId }, data: dismissData }).catch(() => {});
      } else if (entityType === 'competitor') {
        await (prisma as any).competitor.update({
          where: { id: entityId },
          data: { not_relevant: true, not_relevant_reason: reason || null },
        }).catch(() => {});
      }
    }

    const memory = await prisma.businessMemory.findFirst({ where: { linked_business: businessProfileId } });

    const safeParse = (val: string | null | undefined): Record<string, any> => {
      try { return val ? JSON.parse(val) : {}; } catch { return {}; }
    };
    const safeArr = (val: string | null | undefined): string[] => {
      try { const r = val ? JSON.parse(val) : []; return Array.isArray(r) ? r : []; } catch { return []; }
    };

    const weights  = safeParse(memory?.agent_weights);
    const current  = weights['generateProactiveAlerts'] ?? 0.5;

    if (action === 'completed' && alertType) {
      const accepted = safeArr(memory?.accepted_patterns);
      const pattern  = alertType + (actionPlatform ? `:${actionPlatform}` : '');
      if (!accepted.includes(pattern)) {
        accepted.unshift(pattern);
        if (accepted.length > 20) accepted.pop();
      }
      weights['generateProactiveAlerts'] = Math.min(1.0, current + 0.04);

      // Update AgentLearningProfile
      await prisma.agentLearningProfile.upsert({
        where:  { linked_business_agent_name: { linked_business: businessProfileId, agent_name: 'generateProactiveAlerts' } },
        create: { linked_business: businessProfileId, agent_name: 'generateProactiveAlerts', total_outputs: 1, positive_count: 1, accuracy_score: 0.7 },
        update: { total_outputs: { increment: 1 }, positive_count: { increment: 1 }, last_updated: new Date().toISOString() },
      });

      const data = {
        accepted_patterns: JSON.stringify(accepted),
        agent_weights:     JSON.stringify(weights),
        last_updated:      new Date().toISOString(),
      };
      if (memory) await prisma.businessMemory.update({ where: { id: memory.id }, data });
      else await prisma.businessMemory.create({ data: { linked_business: businessProfileId, ...data } });
    }

    if (action === 'dismissed' && title) {
      const rejected = safeArr(memory?.rejected_patterns);
      // Extract 2-3 meaningful keywords from title (skip short/common words)
      const stopWords = new Set(['של', 'עם', 'על', 'אל', 'את', 'כי', 'הם', 'הן', 'זה', 'זו', 'מה', 'לא', 'כן', 'כל', 'אחד', 'in', 'at', 'the', 'a', 'of']);
      const keyword = (title as string)
        .split(/\s+/)
        .filter(w => w.length >= 4 && !stopWords.has(w))
        .slice(0, 2)
        .join(' ')
        .toLowerCase()
        .trim();

      if (keyword && !rejected.includes(keyword)) {
        rejected.unshift(keyword);
        if (rejected.length > 15) rejected.pop();
      }

      // Also extract keywords from the reason (more specific signal for agents)
      if (reason) {
        const reasonKeyword = (reason as string)
          .split(/\s+/)
          .filter((w: string) => w.length >= 4 && !stopWords.has(w))
          .slice(0, 3)
          .join(' ')
          .toLowerCase()
          .trim();
        if (reasonKeyword && !rejected.includes(reasonKeyword)) {
          rejected.unshift(reasonKeyword);
          if (rejected.length > 20) rejected.pop();
        }
      }

      // Track entity-type dismissals for targeted agent suppression
      const agentName = entityType === 'signal' ? 'runIntelligenceEngines'
        : entityType === 'competitor' ? 'runCompetitorIdentification'
        : entityType === 'event' ? 'detectEvents'
        : 'generateProactiveAlerts';
      weights[agentName] = Math.max(0.1, (weights[agentName] ?? 0.5) - 0.03);
      weights['generateProactiveAlerts'] = Math.max(0.1, current - 0.02);

      await prisma.agentLearningProfile.upsert({
        where:  { linked_business_agent_name: { linked_business: businessProfileId, agent_name: agentName } },
        create: { linked_business: businessProfileId, agent_name: agentName, total_outputs: 1, negative_count: 1, accuracy_score: 0.4 },
        update: { total_outputs: { increment: 1 }, negative_count: { increment: 1 }, last_updated: new Date().toISOString() },
      });

      // Build structured feedback log — agents read this to understand what to skip
      const feedbackLog: any[] = [];
      try {
        const existing = memory?.feedback_summary;
        const parsed = existing ? JSON.parse(existing) : {};
        if (Array.isArray(parsed.dismissals)) feedbackLog.push(...parsed.dismissals);
      } catch {}
      feedbackLog.unshift({
        type: entityType || 'alert',
        title: (title as string)?.slice(0, 80) || '',
        reason: reason || '',
        at: new Date().toISOString(),
      });
      const trimmedLog = feedbackLog.slice(0, 30);

      const data = {
        rejected_patterns: JSON.stringify(rejected),
        agent_weights:     JSON.stringify(weights),
        feedback_summary:  JSON.stringify({ dismissals: trimmedLog }),
        last_updated:      new Date().toISOString(),
      };
      if (memory) await prisma.businessMemory.update({ where: { id: memory.id }, data });
      else await prisma.businessMemory.create({ data: { linked_business: businessProfileId, ...data } });
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error('updateInsightMemory error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
