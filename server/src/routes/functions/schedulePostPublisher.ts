import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { executeOrQueue } from '../../services/execution/executeOrQueue';

/**
 * schedulePostPublisher — finds content calendar tasks that are due today
 * (created by contentCalendarAgent with source_type='agent') and publishes them
 * to Facebook/Instagram via InstagramPublisher through the executeOrQueue flow.
 *
 * Respects autonomy_level:
 *   full_auto  → publishes immediately
 *   semi_auto  → queues for auto-publish in 4h (owner can cancel)
 *   manual     → creates PendingAlert with one-click publish button
 */
export async function schedulePostPublisher(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    // Check if any social account is connected for publishing
    const socialAccounts = await prisma.socialAccount.findMany({
      where: {
        linked_business: businessProfileId,
        is_connected: true,
        platform: { in: ['facebook_page', 'instagram_business'] },
      },
    });
    if (socialAccounts.length === 0) {
      await writeAutomationLog('schedulePostPublisher', businessProfileId, startTime, 0);
      return res.json({ published: 0, note: 'No social accounts connected — connect Facebook or Instagram first' });
    }

    // Find tasks that are due: agent-created content tasks that haven't been published
    const now = new Date();
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const dueTasks = await prisma.task.findMany({
      where: {
        linked_business: businessProfileId,
        source_type: 'agent',
        status: { in: ['pending', 'in_progress'] },
        due_date: { lte: todayEnd.toISOString() },
        title: { not: { contains: 'פורסם' } },
      },
      orderBy: { due_date: 'asc' },
      take: 5, // max 5 posts per run to avoid rate limits
    });

    if (dueTasks.length === 0) {
      await writeAutomationLog('schedulePostPublisher', businessProfileId, startTime, 0);
      return res.json({ published: 0, note: 'No pending content tasks due today' });
    }

    // Determine which platforms are connected
    const connectedPlatforms = socialAccounts.map(a => a.platform);
    const platform = connectedPlatforms.includes('instagram_business') && connectedPlatforms.includes('facebook_page')
      ? 'both'
      : connectedPlatforms.includes('instagram_business')
      ? 'instagram'
      : 'facebook';

    let published = 0;

    for (const task of dueTasks) {
      try {
        // Extract post content from task description
        const caption = task.description || task.title || '';
        if (!caption || caption.length < 10) continue;

        // Dispatch via executeOrQueue — respects autonomy_level
        const { executed, autoActionId } = await executeOrQueue({
          businessProfileId,
          agentName: 'schedulePostPublisher',
          actionType: 'post_publish',
          description: `פרסום פוסט: ${task.title}`,
          payload: {
            taskId: task.id,
            caption,
            platform,
          },
          revenueImpact: 150,
          autoExecuteAfterHours: 4,
        });

        // Mark task as ready_to_publish or done based on result
        await prisma.task.update({
          where: { id: task.id },
          data: {
            status: executed ? 'done' : 'ready_to_publish',
            notes: executed
              ? `פורסם אוטומטית ב: ${platform} · ${new Date().toLocaleDateString('he-IL')}`
              : `ממתין לפרסום — auto_action: ${autoActionId}`,
            completed_at: executed ? new Date().toISOString() : null,
          },
        });

        published++;
      } catch (err: any) {
        console.warn(`schedulePostPublisher: task ${task.id} failed:`, err.message);
      }
    }

    await writeAutomationLog('schedulePostPublisher', businessProfileId, startTime, published);
    console.log(`schedulePostPublisher done: ${published}/${dueTasks.length} tasks queued/published`);
    return res.json({ published, total_due: dueTasks.length, platform });
  } catch (err: any) {
    console.error('schedulePostPublisher error:', err.message);
    await writeAutomationLog('schedulePostPublisher', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
