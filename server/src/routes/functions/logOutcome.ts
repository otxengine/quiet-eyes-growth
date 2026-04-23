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
    return res.json({ success: true, id: record.id });
  } catch (err: any) {
    console.error('logOutcome error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
