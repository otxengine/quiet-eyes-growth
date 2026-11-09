/**
 * Shared review post-processing — runs after new Review rows are written,
 * whether by a synchronous collector tier or an async DataForSEO postback.
 * Extracted from collectReviews.ts so both callers stay in sync.
 */
import { prisma } from '../db';
import { publishEvent } from './eventBus';
import { batchExtractTopics } from './reviewTaxonomy';

/**
 * A provider's link to one review: DataForSEO `review_url`, SerpAPI `link`, Places API `googleMapsUri`.
 * https only, since the UI renders it as an href and it comes from a third-party payload.
 */
export function reviewLink(item: any): string | null {
  const url = item?.review_url || item?.link || item?.googleMapsUri;
  return typeof url === 'string' && url.startsWith('https://') ? url : null;
}

/**
 * Points already-stored reviews at their own link. Rows saved before links were captured hold a
 * business-level URL; `stored` maps google_review_id → current source_url, so only changed rows are written.
 */
export async function relinkReviews(
  businessProfileId: string,
  stored: Map<string | null, string | null>,
  seen: Array<[string, string | null]>,
): Promise<void> {
  for (const [google_review_id, source_url] of seen) {
    if (!source_url || !stored.has(google_review_id) || stored.get(google_review_id) === source_url) continue;
    await prisma.review.updateMany({
      where: { linked_business: businessProfileId, google_review_id },
      data:  { source_url },
    }).catch(() => {});
  }
}

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
        // Only own reviews still awaiting a reply: answered ones are 'published', competitor rows have no status.
        response_status: 'pending',
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

// ponytail: 3-wide batches, not full concurrency — server/src/db.ts caps the
// Postgres pool at 8 connections (10s pool_timeout); this can fire alongside
// 4 other DB-heavy onboarding scans for the same business, and freshReviews
// can be ~300 rows on a first-time backfill. Back off to 2 if Render logs
// show pool_timeout/P2024.
const EVENTS_BATCH_CONCURRENCY = 3;

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
    for (let i = 0; i < freshReviews.length; i += EVENTS_BATCH_CONCURRENCY) {
      await Promise.allSettled(
        freshReviews.slice(i, i + EVENTS_BATCH_CONCURRENCY).map(rev =>
          publishEvent({
            businessId: businessProfileId,
            eventType: 'new_review',
            source: opts.source ?? 'collectReviews',
            payload: { review_id: rev.id, ...opts.extraPayload },
            contextAttrs: { impact: opts.impact ?? 'low' },
          })
        )
      );
    }
  } catch (_) {}
}

/** Backfills topics/sentiment for reviews stored before topic extraction ran (or truncated batches). */
export async function backfillTopicsFor(
  where: { linked_business?: string; linked_competitor?: string },
  topicSet: any,
): Promise<void> {
  // Star-only reviews ('' text) never get topics — exclude them, and read past other too-short rows so they
  // can't fill the batch and stall the queue. ponytail: stalls only if >200 untopiced 1–4 char reviews pile up.
  const untopiced = await prisma.review.findMany({
    where: { ...where, NOT: { text: '' }, OR: [{ topic_sentiment: null }, { topic_sentiment: '{}' }] },
    select: { id: true, text: true },
    take: 200,
  }) as Array<{ id: string; text: string }>;
  if (untopiced.length === 0) return;

  const eligible = untopiced.filter(r => (r.text || '').length >= 5).slice(0, 30);
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
