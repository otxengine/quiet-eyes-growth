import { Request, Response } from 'express';
import { prisma } from '../../db';
import { getUserId } from '../../middleware/auth';

export async function logOutcome(req: Request, res: Response) {
  const { action_type, was_accepted, outcome_description, impact_score, linked_business, linked_action } = req.body;

  try {
    const userId = getUserId(req);
    const record = await prisma.outcomeLog.create({
      data: {
        action_type,
        was_accepted: was_accepted === true,
        outcome_description,
        impact_score: impact_score || 0,
        linked_business,
        linked_action,
        created_at: new Date().toISOString(),
        created_by: userId || undefined,
      },
    });

    // Also write FeedbackEvent so runMLLearningCycle can learn from it
    if (linked_business) {
      try {
        await prisma.feedbackEvent.create({
          data: {
            linked_business,
            ai_output_id: linked_action || record.id,
            agent_name: action_type || 'unknown',
            output_type: 'OutcomeLog',
            rating: was_accepted === true ? 'positive' : 'negative',
            score: was_accepted === true ? 1 : -1,
            tags: was_accepted === true ? 'accepted' : 'rejected',
          },
        });
      } catch (fbErr: any) {
        // Non-fatal: log but don't fail the outcome log write
        console.warn('logOutcome: FeedbackEvent write failed:', fbErr.message);
      }
    }

    return res.json({ success: true, id: record.id });
  } catch (err: any) {
    console.error('logOutcome error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
