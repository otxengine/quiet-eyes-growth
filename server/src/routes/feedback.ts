/**
 * Feedback API — receives user feedback on AI outputs.
 * POST /api/feedback
 * Body: { businessProfileId, aiOutputId?, agentName, module, outputType, rating, score, comment?, tags?, correction? }
 *
 * After storing feedback, runs an incremental learning update:
 * - updates AgentLearningProfile accuracy
 * - appends patterns to BusinessMemory
 * - creates a LearningSignal if pattern occurs 3+ times
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { incrementalMemoryUpdate } from '../services/learning/BusinessMemoryEngine';
import { updateWeightFromFeedback } from '../services/learning/PolicyWeightUpdater';
import { bus } from '../events/EventBus';
import { nanoid } from 'nanoid';

const router = Router();

// POST /api/feedback
router.post('/', async (req: Request, res: Response) => {
  const {
    businessProfileId,
    aiOutputId,
    agentName,
    module: moduleName,
    outputType,
    rating,       // 'positive' | 'negative' | 'neutral'
    score,        // 1 | -1 | 0
    comment,
    tags,         // comma-separated string or array
    correction,
    actionTaken,  // 'accepted' | 'rejected' | 'edited' | 'ignored'
  } = req.body;

  if (!businessProfileId || !agentName) {
    return res.status(400).json({ error: 'Missing businessProfileId or agentName' });
  }

  const numScore = typeof score === 'number' ? score : rating === 'positive' ? 1 : rating === 'negative' ? -1 : 0;
  const tagsStr  = Array.isArray(tags) ? tags.join(',') : (tags || '');

  try {
    // 1. Store feedback event
    const event = await prisma.feedbackEvent.create({
      data: {
        linked_business: businessProfileId,
        ai_output_id:    aiOutputId || null,
        agent_name:      agentName,
        module:          moduleName || agentName,
        output_type:     outputType || 'general',
        rating:          rating || (numScore > 0 ? 'positive' : numScore < 0 ? 'negative' : 'neutral'),
        score:           numScore,
        comment:         comment || null,
        tags:            tagsStr || null,
        correction:      correction || null,
        action_taken:    actionTaken || null,
      },
    });

    // 2. Update AIOutput if linked
    if (aiOutputId) {
      await prisma.aIOutput.update({
        where: { id: aiOutputId },
        data: {
          feedback_score: numScore,
          outcome_status: numScore > 0 ? 'accepted' : numScore < 0 ? 'rejected' : 'acknowledged',
        },
      }).catch(() => {});
    }

    // 3. Increment AgentLearningProfile
    await upsertAgentProfile(businessProfileId, agentName, numScore, outputType, tagsStr);

    // 4. Update BusinessMemory
    await updateBusinessMemory(businessProfileId, agentName, numScore, tagsStr, correction, comment);

    // 5. Detect recurring patterns → LearningSignal
    await detectAndPersistPatterns(businessProfileId, agentName, numScore, tagsStr, outputType);

    // 6. New learning layer: incremental memory + policy weight update
    const traceId = `fb_${nanoid(10)}`;
    const tagArr = tagsStr ? tagsStr.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
    await Promise.allSettled([
      incrementalMemoryUpdate(
        businessProfileId, agentName, numScore,
        tagArr, correction, comment, outputType, traceId,
      ),
      updateWeightFromFeedback(
        businessProfileId, agentName, outputType ?? 'general', numScore, traceId,
      ),
    ]);

    // 7. Emit feedback.received event
    await bus.emit(bus.makeEvent('feedback.received', businessProfileId, {
      feedback_id:  event.id,
      business_id:  businessProfileId,
      agent_name:   agentName,
      score:        numScore,
      output_type:  outputType,
      tags:         tagArr,
    }, traceId)).catch(() => {});

    return res.json({ ok: true, feedback_id: event.id });
  } catch (err: any) {
    console.error('[feedback]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/feedback/summary/:businessProfileId
router.get('/summary/:businessProfileId', async (req: Request, res: Response) => {
  const businessProfileId = String(req.params.businessProfileId);
  try {
    const [profiles, signals, memory, recentFeedback] = await Promise.all([
      prisma.agentLearningProfile.findMany({ where: { linked_business: businessProfileId } }),
      prisma.learningSignal.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { occurrence_count: 'desc' },
        take: 20,
      }),
      prisma.businessMemory.findUnique({ where: { linked_business: businessProfileId } }),
      prisma.feedbackEvent.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 50,
      }),
    ]);

    const totalFeedback = recentFeedback.length;
    const positiveCount = recentFeedback.filter(f => (f.score ?? 0) > 0).length;
    const negativeCount = recentFeedback.filter(f => (f.score ?? 0) < 0).length;
    const overallAccuracy = totalFeedback > 0 ? Math.round((positiveCount / totalFeedback) * 100) : null;

    return res.json({
      overall_accuracy: overallAccuracy,
      total_feedback: totalFeedback,
      positive_count: positiveCount,
      negative_count: negativeCount,
      agent_profiles: profiles,
      learning_signals: signals,
      business_memory: memory,
      recent_feedback: recentFeedback.slice(0, 20),
    });
  } catch (err: any) {
    console.error('[feedback/summary]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function upsertAgentProfile(
  businessProfileId: string,
  agentName: string,
  score: number,
  outputType: string | undefined,
  tags: string,
) {
  const existing = await prisma.agentLearningProfile.findFirst({
    where: { linked_business: businessProfileId, agent_name: agentName },
  });

  const positiveAdd = score > 0 ? 1 : 0;
  const negativeAdd = score < 0 ? 1 : 0;

  if (existing) {
    const newPos = (existing.positive_count ?? 0) + positiveAdd;
    const newNeg = (existing.negative_count ?? 0) + negativeAdd;
    const total  = (existing.total_outputs ?? 0) + 1;
    const accuracy = total > 0 ? newPos / total : 0.5;

    // Update rejected/accepted type lists
    let rejectedTypes: string[] = safeParse<string[]>(existing.rejected_types as any, []);
    let acceptedTypes: string[] = safeParse<string[]>(existing.accepted_types as any, []);

    if (score < 0 && outputType && !rejectedTypes.includes(outputType)) {
      rejectedTypes = [...rejectedTypes.slice(-19), outputType];
    }
    if (score > 0 && outputType && !acceptedTypes.includes(outputType)) {
      acceptedTypes = [...acceptedTypes.slice(-19), outputType];
    }

    await prisma.agentLearningProfile.update({
      where: { id: existing.id },
      data: {
        total_outputs:    total,
        positive_count:   newPos,
        negative_count:   newNeg,
        accuracy_score:   Math.round(accuracy * 1000) / 1000,
        rejected_types:   JSON.stringify(rejectedTypes),
        accepted_types:   JSON.stringify(acceptedTypes),
        last_updated:     new Date().toISOString(),
      },
    });
  } else {
    await prisma.agentLearningProfile.create({
      data: {
        linked_business:  businessProfileId,
        agent_name:       agentName,
        total_outputs:    1,
        positive_count:   positiveAdd,
        negative_count:   negativeAdd,
        accuracy_score:   positiveAdd > 0 ? 1.0 : 0.0,
        rejected_types:   score < 0 && outputType ? JSON.stringify([outputType]) : '[]',
        accepted_types:   score > 0 && outputType ? JSON.stringify([outputType]) : '[]',
        last_updated:     new Date().toISOString(),
      },
    });
  }
}

async function updateBusinessMemory(
  businessProfileId: string,
  agentName: string,
  score: number,
  tags: string,
  correction: string | undefined,
  comment: string | undefined,
) {
  const memory = await prisma.businessMemory.findUnique({
    where: { linked_business: businessProfileId },
  });

  const tagList = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  // Build or update rejected/accepted pattern lists
  let rejectedPatterns: string[] = safeParse<string[]>((memory?.rejected_patterns) as any, []);
  let acceptedPatterns: string[] = safeParse<string[]>((memory?.accepted_patterns) as any, []);

  if (score < 0) {
    const pattern = `${agentName}:${tagList[0] || 'rejected'}`;
    if (!rejectedPatterns.includes(pattern)) {
      rejectedPatterns = [...rejectedPatterns.slice(-29), pattern];
    }
  } else if (score > 0) {
    const pattern = `${agentName}:${tagList[0] || 'accepted'}`;
    if (!acceptedPatterns.includes(pattern)) {
      acceptedPatterns = [...acceptedPatterns.slice(-29), pattern];
    }
  }

  // Determine preferred tone from comment
  let preferredTone = memory?.preferred_tone || 'professional';
  if (comment?.includes('ישיר') || comment?.includes('קצר')) preferredTone = 'direct';
  if (comment?.includes('מפורט') || comment?.includes('מעמיק')) preferredTone = 'detailed';

  // Build feedback summary
  const existingSummary: Record<string, any> = safeParse(memory?.feedback_summary as any, {});
  if (tagList.length > 0) {
    const topTag = tagList[0];
    existingSummary[`tag_${topTag}`] = (existingSummary[`tag_${topTag}`] || 0) + 1;
    // Track most common rejection reason
    if (score < 0) {
      existingSummary.common_rejection = topTag;
    }
  }

  const updateData: any = {
    linked_business:  businessProfileId,
    rejected_patterns: JSON.stringify(rejectedPatterns),
    accepted_patterns: JSON.stringify(acceptedPatterns),
    feedback_summary:  JSON.stringify(existingSummary),
    preferred_tone:    preferredTone,
    last_updated:      new Date().toISOString(),
  };

  if (memory) {
    await prisma.businessMemory.update({ where: { id: memory.id }, data: updateData });
  } else {
    await prisma.businessMemory.create({ data: updateData });
  }
}

async function detectAndPersistPatterns(
  businessProfileId: string,
  agentName: string,
  score: number,
  tags: string,
  outputType: string | undefined,
) {
  const tagList = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const patternKey = `${agentName}:${score > 0 ? 'positive' : 'negative'}:${tagList[0] || outputType || 'general'}`;

  const existing = await prisma.learningSignal.findFirst({
    where: { linked_business: businessProfileId, pattern_key: patternKey },
  });

  if (existing) {
    const newCount = (existing.occurrence_count ?? 0) + 1;
    await prisma.learningSignal.update({
      where: { id: existing.id },
      data: { occurrence_count: newCount, last_seen: new Date().toISOString() },
    });
  } else {
    const label = score > 0
      ? `${agentName} — תוצאות מתקבלות: ${tagList[0] || outputType || 'כללי'}`
      : `${agentName} — תוצאות נדחות: ${tagList[0] || outputType || 'כללי'}`;

    await prisma.learningSignal.create({
      data: {
        linked_business:  businessProfileId,
        signal_type:      score > 0 ? 'positive_pattern' : 'negative_pattern',
        agent_name:       agentName,
        pattern_key:      patternKey,
        pattern_label:    label,
        weight:           score > 0 ? 0.1 : -0.1,
        occurrence_count: 1,
        last_seen:        new Date().toISOString(),
      },
    });
  }
}

function safeParse<T>(val: string | null | undefined, fallback: T): T {
  try { return val ? JSON.parse(val) : fallback; } catch { return fallback; }
}

export default router;
