import { Request, Response } from 'express';
import { prisma } from '../../db';

/**
 * updateInsightMemory — called when user acts on or dismisses an insight.
 *
 * action='completed': records what types/platforms the user responds to → accepted_patterns
 * action='dismissed': records title keywords the user ignores → rejected_patterns
 *
 * Both update agent_weights so generateProactiveAlerts learns over time.
 */
export async function updateInsightMemory(req: Request, res: Response) {
  const { businessProfileId, alertType, actionPlatform, title, action } = req.body;
  if (!businessProfileId || !action) return res.status(400).json({ error: 'Missing required fields' });

  try {
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
      weights['generateProactiveAlerts'] = Math.max(0.1, current - 0.02);

      await prisma.agentLearningProfile.upsert({
        where:  { linked_business_agent_name: { linked_business: businessProfileId, agent_name: 'generateProactiveAlerts' } },
        create: { linked_business: businessProfileId, agent_name: 'generateProactiveAlerts', total_outputs: 1, negative_count: 1, accuracy_score: 0.4 },
        update: { total_outputs: { increment: 1 }, negative_count: { increment: 1 }, last_updated: new Date().toISOString() },
      });

      const data = {
        rejected_patterns: JSON.stringify(rejected),
        agent_weights:     JSON.stringify(weights),
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
