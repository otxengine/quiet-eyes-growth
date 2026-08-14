/**
 * Shared review post-processing — runs after new Review rows are written,
 * whether by a synchronous collector tier or an async DataForSEO postback.
 * Extracted from collectReviews.ts so both callers stay in sync.
 */
import { prisma } from '../db';
import { publishEvent } from './eventBus';
import { batchExtractTopics } from './reviewTaxonomy';

export async function detectCompetitorMentions(businessProfileId: string, sinceTimestamp: string): Promise<void> {
  try {
    const knownCompetitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
      select: { id: true, name: true },
      take: 10,
    });
    if (knownCompetitors.length === 0) return;

    const freshReviews = await prisma.review.findMany({
      where: { linked_business: businessProfileId, created_date: { gte: new Date(sinceTimestamp) } },
      select: { id: true, text: true, sentiment: true, rating: true, reviewer_name: true },
    });
    for (const rev of freshReviews) {
      const textLower = (rev.text || '').toLowerCase();
      for (const comp of knownCompetitors) {
        if (!comp.name || !textLower.includes(comp.name.toLowerCase())) continue;
        const sigTitle = `לקוח מזכיר "${comp.name}" בביקורת`;
        const alreadyExists = await prisma.marketSignal.findFirst({
          where: {
            linked_business: businessProfileId,
            category: 'competitor_mention',
            summary: { contains: comp.name },
            detected_at: { gte: new Date(Date.now() - 7 * 86400000).toISOString() },
          },
        });
        if (alreadyExists) continue;
        const isPositiveForUs = rev.sentiment === 'positive' || (rev.rating || 0) >= 4;
        await prisma.marketSignal.create({
          data: {
            linked_business: businessProfileId,
            summary: `${sigTitle} — ${isPositiveForUs ? 'בהשוואה לטובתנו' : 'השוואה שלילית — בדוק'}`,
            category: 'competitor_mention',
            impact_level: isPositiveForUs ? 'low' : 'high',
            confidence: 75,
            recommended_action: isPositiveForUs
              ? `השתמש בהשוואה כחומר שיווקי נגד ${comp.name}`
              : `בחן מה ${comp.name} מציע שאנו לא — ${(rev.text || '').slice(0, 80)}`,
            source_description: JSON.stringify({
              review_id: rev.id,
              reviewer: rev.reviewer_name,
              competitor_name: comp.name,
              review_snippet: (rev.text || '').slice(0, 200),
              sentiment: rev.sentiment,
            }),
            is_read: false,
            detected_at: new Date().toISOString(),
          },
        }).catch(() => {});
      }
    }
  } catch (_) {}
}

export async function snapshotRatingHistory(businessProfileId: string, newReviewsCount: number, source: string): Promise<void> {
  try {
    const allRatings = await prisma.review.findMany({
      where: { linked_business: businessProfileId },
      select: { rating: true },
    });
    if (allRatings.length === 0) return;
    const avgRating = allRatings.reduce((s, r) => s + (r.rating || 0), 0) / allRatings.length;
    await prisma.$executeRawUnsafe(
      `INSERT INTO rating_history (business_id, avg_rating, review_count, new_reviews, source) VALUES ($1, $2::numeric, $3, $4, $5)`,
      businessProfileId, parseFloat(avgRating.toFixed(2)), allRatings.length, newReviewsCount, source,
    );
  } catch (_) {}
}

export async function createNegativeReviewAlerts(businessProfileId: string): Promise<void> {
  try {
    const recentNegatives = await prisma.review.findMany({
      where: {
        linked_business: businessProfileId,
        sentiment: 'negative',
        created_date: { gte: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
      },
      orderBy: { created_date: 'desc' },
      take: 5,
    });

    for (const rev of recentNegatives) {
      const alertTitle = `ביקורת שלילית חדשה: ${rev.reviewer_name || 'לקוח'} (${rev.rating || '?'}⭐)`;
      const exists = await prisma.proactiveAlert.findFirst({
        where: { linked_business: businessProfileId, title: alertTitle, is_dismissed: false },
      });
      if (exists) continue;
      await prisma.proactiveAlert.create({
        data: {
          alert_type: 'negative_review',
          title: alertTitle,
          description: (rev.text || '').substring(0, 150),
          suggested_action: `צור תגובה מקצועית ל${rev.reviewer_name || 'לקוח'}`,
          priority: (rev.rating || 5) <= 2 ? 'high' : 'medium',
          source_agent: JSON.stringify({
            action_label: 'הגב עכשיו',
            action_type: 'respond',
            review_id: rev.id,
            urgency_hours: 6,
            impact_reason: 'תגובה תוך 6 שעות מגדילה שימור לקוחות ב-40%',
          }),
          is_dismissed: false,
          is_acted_on: false,
          created_at: new Date().toISOString(),
          linked_business: businessProfileId,
        },
      }).catch(() => {});
    }
  } catch (_) {}
}

export async function publishNewReviewEvents(
  businessProfileId: string,
  sinceTimestamp: string,
  opts: { source?: string; extraPayload?: Record<string, any>; impact?: 'high' | 'medium' | 'low' } = {},
): Promise<void> {
  try {
    const freshReviews = await prisma.review.findMany({
      where: { linked_business: businessProfileId, created_date: { gte: new Date(sinceTimestamp) } },
      select: { id: true },
    });
    for (const rev of freshReviews) {
      publishEvent({
        businessId: businessProfileId,
        eventType: 'new_review',
        source: opts.source ?? 'collectReviews',
        payload: { review_id: rev.id, ...opts.extraPayload },
        contextAttrs: { impact: opts.impact ?? 'low' },
      }).catch(() => {});
    }
  } catch (_) {}
}

/** Backfills topics/sentiment for reviews stored before topic extraction ran (or truncated batches). */
export async function backfillTopicsFor(
  where: { linked_business?: string; linked_competitor?: string },
  topicSet: any,
): Promise<void> {
  const untopiced = await prisma.review.findMany({
    where: { ...where, OR: [{ topic_sentiment: null }, { topic_sentiment: '{}' }] },
    select: { id: true, text: true },
    take: 30,
  }) as Array<{ id: string; text: string }>;
  if (untopiced.length === 0) return;

  const eligible = untopiced.filter(r => (r.text || '').length >= 5);
  if (eligible.length === 0) return;

  const backfill = await batchExtractTopics(eligible.map(r => ({ text: r.text })), undefined, topicSet);
  for (let i = 0; i < eligible.length; i++) {
    const { topics, topic_sentiment } = backfill[i];
    if (!topics) continue;
    await prisma.review.update({
      where: { id: eligible[i].id },
      data: { topics, topic_sentiment },
    }).catch(() => {});
  }
}
