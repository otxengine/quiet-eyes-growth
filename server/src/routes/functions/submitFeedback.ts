import { Request, Response } from 'express';
import { prisma } from '../../db';
import { getUserId } from '../../middleware/auth';

/**
 * submitFeedback
 * Writes a FeedbackEvent to the DB so runMLLearningCycle can learn from it.
 *
 * Body: { businessProfileId, entity_type, entity_id, rating, tags, agent_name }
 *   rating: 5 = thumbs_up, 1 = thumbs_down
 */
export async function submitFeedback(req: Request, res: Response) {
  const { businessProfileId, entity_type, entity_id, rating, tags, agent_name, comment } = req.body;

  if (!businessProfileId || !entity_id) {
    return res.status(400).json({ error: 'Missing businessProfileId or entity_id' });
  }

  try {
    const userId = getUserId(req);

    const event = await prisma.feedbackEvent.create({
      data: {
        linked_business: businessProfileId,
        ai_output_id: entity_id,
        agent_name: agent_name || entity_type || 'unknown',
        output_type: entity_type || 'ProactiveAlert',
        rating: rating >= 4 ? 'positive' : 'negative',
        score: rating >= 4 ? 1 : -1,
        comment: comment || null,
        tags: Array.isArray(tags) ? tags.join(',') : (tags || null),
      },
    });

    return res.json({ success: true, id: event.id });
  } catch (err: any) {
    console.error('submitFeedback error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
