import { prisma } from '../../db';

/**
 * insightAutoResolve — passive detection that a user took action.
 *
 * Called at the start of generateProactiveAlerts. Checks each pending alert
 * against the current state of the DB. If the underlying condition is gone,
 * marks the alert as is_acted_on=true — even if the user never clicked "Done".
 *
 * Rules:
 *   hot_lead       → auto-resolve if no hot leads remain
 *   negative_review → auto-resolve if no pending negative reviews remain
 *   demand_gap     → auto-resolve if same topic already has recent action
 *   Any type       → auto-dismiss if older than 14 days (stale)
 *   monthly_strategy → skip (managed separately)
 */
export async function insightAutoResolve(businessProfileId: string): Promise<number> {
  let resolved = 0;
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString();

  try {
    const pending = await prisma.proactiveAlert.findMany({
      where: { linked_business: businessProfileId, is_dismissed: false, is_acted_on: false },
    });
    if (pending.length === 0) return 0;

    // Load current state in parallel
    const twoDaysAgo = new Date(now.getTime() - 2 * 86400000).toISOString();
    const [hotLeads, negReviews, recentActions] = await Promise.all([
      prisma.lead.findMany({
        where: { linked_business: businessProfileId, status: 'hot' },
        select: { id: true, name: true },
      }),
      prisma.review.findMany({
        where: { linked_business: businessProfileId, response_status: 'pending' },
        select: { id: true, rating: true, sentiment: true },
      }),
      prisma.action.findMany({
        where: { linked_business: businessProfileId, created_date: { gte: new Date(twoDaysAgo) } },
        select: { id: true, title: true, reasoning: true },
      }),
    ]);

    const hasHotLeads     = hotLeads.length > 0;
    const hasNegReviews   = negReviews.some(r => (r.rating || 5) <= 2 || r.sentiment === 'negative');

    for (const alert of pending) {
      const createdAt = (alert.created_at || alert.created_date || '').toString();
      const isStale   = createdAt < fourteenDaysAgo;

      // Auto-dismiss stale alerts
      if (isStale && alert.alert_type !== 'monthly_strategy') {
        await prisma.proactiveAlert.update({
          where: { id: alert.id },
          data:  { is_dismissed: true },
        });
        resolved++;
        continue;
      }

      // hot_lead → if no hot leads remain, the situation changed
      if (alert.alert_type === 'hot_lead' && !hasHotLeads) {
        await prisma.proactiveAlert.update({
          where: { id: alert.id },
          data:  { is_acted_on: true },
        });
        resolved++;
        continue;
      }

      // negative_review → if no unanswered negative reviews remain
      if (alert.alert_type === 'negative_review' && !hasNegReviews) {
        await prisma.proactiveAlert.update({
          where: { id: alert.id },
          data:  { is_acted_on: true },
        });
        resolved++;
        continue;
      }

      // demand_gap → auto-resolve if a recent action addresses the same topic
      if (alert.alert_type === 'demand_gap') {
        const alertKeywords = (alert.title || alert.description || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const hasMatchingAction = recentActions.some(a => {
          const desc = ((a.title || '') + ' ' + (a.reasoning || '')).toLowerCase();
          return alertKeywords.some(kw => desc.includes(kw));
        });
        if (hasMatchingAction) {
          await prisma.proactiveAlert.update({
            where: { id: alert.id },
            data:  { is_acted_on: true },
          });
          resolved++;
          continue;
        }
      }
    }

    if (resolved > 0) {
      console.log(`[insightAutoResolve] auto-resolved ${resolved} alerts for ${businessProfileId}`);
    }
  } catch (err: any) {
    console.warn('[insightAutoResolve] non-fatal error:', err.message);
  }

  return resolved;
}
