import { Request, Response } from 'express';
import { executeOrQueue } from '../../services/execution/executeOrQueue';

/**
 * publishPost — called directly from the UI when a user clicks "פרסם עכשיו"
 * on a ProactiveAlert or ContentCalendar task.
 *
 * Routes through executeOrQueue so it respects autonomy_level:
 *   full_auto  → publishes immediately to Instagram/Facebook
 *   semi_auto  → queues for 4h (user can cancel), creates AutoAction record
 *   manual     → creates AutoAction in pending state, marks done when user approves
 *
 * Body: { businessProfileId, caption, imageUrl?, platform?, alertId? }
 */
export async function publishPost(req: Request, res: Response) {
  const { businessProfileId, caption, imageUrl, platform = 'both', alertId } = req.body;

  if (!businessProfileId || !caption) {
    return res.status(400).json({ error: 'Missing businessProfileId or caption' });
  }

  try {
    const { executed, autoActionId, method } = await executeOrQueue({
      businessProfileId,
      agentName: 'publishPost',
      actionType: 'post_publish',
      description: `פרסום פוסט: ${caption.substring(0, 60)}...`,
      payload: { caption, imageUrl: imageUrl || null, platform },
      revenueImpact: 200,
      autoExecuteAfterHours: 4,
    });

    return res.json({
      queued: true,
      executed,
      autoActionId,
      method,
      message: executed
        ? `הפוסט פורסם ב-${platform} ✓`
        : method === 'semi_auto'
        ? 'הפוסט בתור — יפורסם בעוד 4 שעות אם לא יבוטל'
        : 'הפוסט ממתין לאישור ידני',
    });
  } catch (err: any) {
    console.error('publishPost error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
