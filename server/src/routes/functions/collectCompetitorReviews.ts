import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { findPlaceId, getPlaceDetails } from '../../lib/googlePlaces';
import { normReviewOrigin } from '../../lib/signalGuard';
import { serpGoogleMapsReviews } from '../../lib/serpapi';
import { invokeLLM } from '../../lib/llm';

const MAX_REVIEWS = 300;

// Identical taxonomy to collectReviews — same aspect extraction, same model
async function batchExtractTopics(
  reviews: Array<{ text: string; sentiment: string }>,
): Promise<Array<{ topics: string; topic_sentiment: string }>> {
  const fallback = reviews.map(r => ({ topics: r.sentiment, topic_sentiment: '{}' }));
  if (reviews.length === 0) return fallback;
  const itemsStr = reviews.map((r, i) => `[${i}] "${r.text.substring(0, 200)}"`).join('\n');
  try {
    const result = await invokeLLM({
      prompt: `Extract topics from the following reviews. For each review: up to 4 topics (service/price/quality/cleanliness/atmosphere/availability/delivery) and a sentiment per topic (positive/negative/neutral).\n${itemsStr}\nReturn ONLY valid JSON. ALL string values must be in Hebrew. {"results":[{"topics":["נושא1"],"sentiments":{"נושא1":"positive"}},...]}, array of the same length and order.`,
      response_json_schema: { type: 'object' },
      model: 'haiku',
      maxTokens: 900,
    });
    const results: any[] = result?.results || [];
    return reviews.map((r, i) => {
      const item = results[i];
      if (!item?.topics || !Array.isArray(item.topics)) return { topics: r.sentiment, topic_sentiment: '{}' };
      return { topics: item.topics.join(','), topic_sentiment: JSON.stringify(item.sentiments || {}) };
    });
  } catch { return fallback; }
}

/**
 * KAN-121 — Competitor Google review ingest.
 * Backfills up to 300 Google reviews per tracked competitor using:
 *   1. SerpAPI google_maps_reviews (paginated, up to 300) when SERPAPI_KEY is set
 *   2. Google Places API (up to 5 reviews) as fallback
 *
 * AC3/AC4 guarantees:
 *   - response_status is NULL → rows never appear in the ops inbox / autoRespondToReviews
 *   - linked_competitor is set → rows are scoped to the competitor, not the owner
 */
export async function collectCompetitorReviews(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const competitors = await (prisma.competitor as any).findMany({
      where: { linked_business: businessProfileId },
      select: { id: true, name: true, google_place_id: true },
    });

    let totalNew = 0;
    const perCompetitor: Array<{ name: string; new: number }> = [];

    for (const comp of competitors) {
      // Resolve Google place_id (cached on competitor row)
      let placeId: string | null = (comp as any).google_place_id || null;
      if (!placeId) {
        placeId = await findPlaceId(comp.name, (profile as any).city || '');
        if (placeId) {
          await (prisma.competitor as any).update({
            where: { id: comp.id },
            data: { google_place_id: placeId },
          }).catch(() => {});
        }
      }
      if (!placeId) { perCompetitor.push({ name: comp.name, new: 0 }); continue; }

      // Dedup: existing ids and text-keys already stored for this competitor
      const existing = await (prisma.review as any).findMany({
        where: { linked_competitor: comp.id },
        select: { google_review_id: true, text: true },
      }) as Array<{ google_review_id: string | null; text: string }>;
      const existingIds  = new Set(existing.map(r => r.google_review_id).filter(Boolean));
      const existingKeys = new Set(existing.map(r => (r.text || '').substring(0, 50)));

      // Path 1: SerpAPI (paginated, up to 300) — active when SERPAPI_KEY is set
      let rawReviews: any[] = await serpGoogleMapsReviews(placeId, MAX_REVIEWS);

      // Path 2: Google Places API fallback (≤5 reviews, always available)
      if (rawReviews.length === 0) {
        const details = await getPlaceDetails(placeId);
        rawReviews = details.reviews;
      }

      const pending: Array<{
        reviewId: string; text: string; rating: number;
        sentiment: string; reviewerName: string; publishTime: string;
      }> = [];

      for (const gr of rawReviews) {
        // Normalise across SerpAPI shape (gr.user.name / gr.snippet / gr.review_id)
        // and Places API (New) shape (gr.authorAttribution.displayName / gr.text.text / gr.name)
        const text        = gr.snippet || gr.text?.text || gr.comment || '';
        const authorName  = gr.user?.name || gr.authorAttribution?.displayName || 'לקוח';
        const rating      = gr.rating ?? 0;
        const publishTime = gr.date || gr.publishTime || new Date().toISOString();
        const reviewId    = gr.review_id || gr.name || `comp_${comp.id}_${authorName}_${rating}`;
        const textKey     = text.substring(0, 50);

        if (!text || text.length < 5) continue;
        if (existingIds.has(reviewId) || existingKeys.has(textKey)) continue;

        const sentiment = rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';
        pending.push({ reviewId, text, rating, sentiment, reviewerName: authorName, publishTime });
        existingIds.add(reviewId);
        existingKeys.add(textKey);
        if (pending.length + existing.length >= MAX_REVIEWS) break;
      }

      if (pending.length === 0) { perCompetitor.push({ name: comp.name, new: 0 }); continue; }

      const topicsArr = await batchExtractTopics(
        pending.map(p => ({ text: p.text, sentiment: p.sentiment })),
      );

      for (let i = 0; i < pending.length; i++) {
        const { reviewId, text, rating, sentiment, reviewerName, publishTime } = pending[i];
        const { topics, topic_sentiment } = topicsArr[i];
        try {
          await (prisma.review as any).create({
            data: {
              platform:          'Google',
              rating,
              text:              text.substring(0, 500),
              reviewer_name:     reviewerName,
              sentiment,
              // AC3: no response_status → never enters ops inbox or autoRespondToReviews
              response_status:   null,
              source_url:        `https://www.google.com/maps/place/?q=place_id:${placeId}`,
              source_origin:     normReviewOrigin('google_places', 'collectCompetitorReviews'),
              google_review_id:  reviewId,
              is_verified:       true,
              created_at:        new Date(publishTime).toISOString(),
              linked_business:   businessProfileId,
              linked_competitor: comp.id,  // AC4: scoped to competitor
              topics,
              topic_sentiment,
            },
          });
          totalNew++;
        } catch { continue; }
      }

      perCompetitor.push({ name: comp.name, new: pending.length });
    }

    await writeAutomationLog('collectCompetitorReviews', businessProfileId, startTime, totalNew, 'success');
    console.log(`collectCompetitorReviews done: ${totalNew} new reviews across ${competitors.length} competitors`);
    return res.json({ total_new: totalNew, per_competitor: perCompetitor });
  } catch (err: any) {
    console.error('collectCompetitorReviews error:', err.message);
    await writeAutomationLog('collectCompetitorReviews', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
