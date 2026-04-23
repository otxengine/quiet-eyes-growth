import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

/**
 * runMLLearningCycle
 * Synthesizes feedback events into BusinessMemory and AgentLearningProfile.
 * Safe: learning_confidence < 0.5 → updates profile but does NOT override agent decisions.
 *
 * Body: { businessProfileId }
 */
export async function runMLLearningCycle(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600000);

    // Fetch feedback events from last 30 days
    const feedbackEvents = await prisma.feedbackEvent.findMany({
      where: {
        linked_business: businessProfileId,
        created_date: { gte: thirtyDaysAgo },
      },
      orderBy: { created_date: 'desc' },
      take: 100,
    });

    if (feedbackEvents.length === 0) {
      return res.json({ message: 'No feedback events to learn from', processed: 0 });
    }

    const positive = feedbackEvents.filter(f => f.rating === 'positive' || (f.score ?? 0) > 0);
    const negative = feedbackEvents.filter(f => f.rating === 'negative' || (f.score ?? 0) < 0);

    // Per-agent stats update
    const agentGroups: Record<string, { pos: number; neg: number }> = {};
    for (const event of feedbackEvents) {
      const agent = event.agent_name || 'unknown';
      if (!agentGroups[agent]) agentGroups[agent] = { pos: 0, neg: 0 };
      if ((event.score ?? 0) > 0) agentGroups[agent].pos++;
      else if ((event.score ?? 0) < 0) agentGroups[agent].neg++;
    }

    for (const [agentName, counts] of Object.entries(agentGroups)) {
      const total = counts.pos + counts.neg;
      const accuracy = total > 0 ? counts.pos / total : 0.5;
      await prisma.agentLearningProfile.upsert({
        where: { linked_business_agent_name: { linked_business: businessProfileId, agent_name: agentName } },
        create: {
          linked_business: businessProfileId,
          agent_name: agentName,
          total_outputs: total,
          positive_count: counts.pos,
          negative_count: counts.neg,
          accuracy_score: accuracy,
          last_updated: new Date().toISOString(),
        },
        update: {
          total_outputs: { increment: total },
          positive_count: { increment: counts.pos },
          negative_count: { increment: counts.neg },
          accuracy_score: accuracy,
          last_updated: new Date().toISOString(),
        },
      });
    }

    // Build learning profile via LLM
    const likedTexts = positive.slice(0, 15).map(f => f.comment || f.tags || '').filter(Boolean);
    const dislikedTexts = negative.slice(0, 15).map(f => {
      const reason = f.comment ? ` — סיבה: ${f.comment}` : '';
      return (f.tags || '') + reason;
    }).filter(Boolean);

    const learningProfile = await invokeLLM({
      model: 'haiku',
      prompt: `אתה מערכת למידה עסקית. נתח משוב של משתמש מהמערכת ובנה פרופיל העדפות.

עסק: "${profile.name}" — ${profile.category}, ${profile.city}
סה"כ משוב: ${feedbackEvents.length} (${positive.length} חיובי, ${negative.length} שלילי)

תוכן שהמשתמש אהב (${likedTexts.length}):
${likedTexts.join('\n') || 'אין עדיין'}

תוכן שלא עבד (${dislikedTexts.length}):
${dislikedTexts.join('\n') || 'אין עדיין'}

בנה פרופיל למידה. החזר JSON בלבד:
{
  "preferred_tone": "formal|casual|data_heavy|simple",
  "accepted_patterns": "תיאור קצר של סוגי תובנות שהמשתמש מעדיף",
  "rejected_patterns": "תיאור קצר של מה שלא עובד",
  "feedback_summary": "סיכום 1-2 משפטים של הלמידה",
  "learning_confidence": 0.0_to_1.0
}`,
      response_json_schema: { type: 'object' },
    });

    if (learningProfile && typeof learningProfile === 'object') {
      const confidence = Number(learningProfile.learning_confidence ?? 0);

      await prisma.businessMemory.upsert({
        where: { linked_business: businessProfileId },
        create: {
          linked_business: businessProfileId,
          preferred_tone: learningProfile.preferred_tone || null,
          accepted_patterns: learningProfile.accepted_patterns || null,
          rejected_patterns: learningProfile.rejected_patterns || null,
          feedback_summary: learningProfile.feedback_summary || null,
          last_updated: new Date().toISOString(),
          learning_version: 1,
        },
        update: {
          preferred_tone: learningProfile.preferred_tone || undefined,
          accepted_patterns: learningProfile.accepted_patterns || undefined,
          rejected_patterns: learningProfile.rejected_patterns || undefined,
          feedback_summary: learningProfile.feedback_summary || undefined,
          last_updated: new Date().toISOString(),
          learning_version: { increment: 1 },
        },
      });

      // Only record learning signal if confidence is meaningful
      if (confidence >= 0.5) {
        await prisma.learningSignal.create({
          data: {
            linked_business: businessProfileId,
            signal_type: 'feedback_synthesis',
            pattern_key: 'ml_cycle',
            pattern_label: learningProfile.feedback_summary?.slice(0, 100) || 'ML cycle complete',
            weight: confidence,
            occurrence_count: feedbackEvents.length,
            last_seen: new Date().toISOString(),
          },
        });
      }
    }

    await writeAutomationLog('runMLLearningCycle', businessProfileId, startTime, feedbackEvents.length);
    console.log(`runMLLearningCycle: processed ${feedbackEvents.length} events for ${profile.name}`);
    return res.json({
      processed: feedbackEvents.length,
      positive: positive.length,
      negative: negative.length,
      agents_updated: Object.keys(agentGroups).length,
    });
  } catch (err: any) {
    console.error('runMLLearningCycle error:', err.message);
    await writeAutomationLog('runMLLearningCycle', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
