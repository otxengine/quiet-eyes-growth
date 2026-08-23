import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { findPlaceId, getPlaceDetails } from '../../lib/googlePlaces';
import { normReviewOrigin } from '../../lib/signalGuard';
import { serpGoogleMapsReviews, firstValidDate } from '../../lib/serpapi';
import { submitGoogleReviewsTask, hasDataForSeoCreds } from '../../lib/dataforseo';
import { batchExtractTopics } from '../../lib/reviewTaxonomy';
import { getSectorProfile } from '../../lib/businessProfile';
import { resolveTopicSet } from '../../lib/reviewTopicPacks';
import { backfillTopicsFor } from '../../lib/reviewPostProcessing';
import { findDonorCandidates } from '../../lib/competitorDonor';

const MAX_REVIEWS = 300;
const DATAFORSEO_REVIEWS_ENABLED = process.env.DATAFORSEO_REVIEWS_ENABLED === 'true';
const SERVER_BASE_URL = process.env.SERVER_BASE_URL || 'http://localhost:3007';
// This function has no freshness guard of its own (unlike the other collect
// agents) — reusing its real-world daily cadence as the donor-freshness window.
const REVIEW_DONOR_FRESHNESS_MS = 24 * 60 * 60 * 1000;

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
export async function runCollectCompetitorReviews(businessProfileId: string) {
  const startTime = new Date().toISOString();
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) throw new Error('No business profile');

    const sp = getSectorProfile(profile);
    const topicSet = resolveTopicSet(sp?.sector_key ?? 'other', sp?.onboarding_review_extras ?? []);

    const competitors = await (prisma.competitor as any).findMany({
      where: { linked_business: businessProfileId, tracking_status: 'approved', not_relevant: false },
      select: { id: true, name: true, google_place_id: true },
    });

    let totalNew = 0;
    let tasksSubmitted = 0;
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

      // Cross-business cache: another business may already have fresh reviews for
      // this exact real-world competitor (same Google Place) — clone them instead
      // of paying for another SerpAPI/DataForSEO fetch.
      const donors = await findDonorCandidates(comp.id, businessProfileId, { googlePlaceId: placeId });
      if (donors.length > 0) {
        const freshThreshold = new Date(Date.now() - REVIEW_DONOR_FRESHNESS_MS).toISOString();
        const donorIds = donors.map(d => d.id);
        const freshDonor = await (prisma as any).$queryRawUnsafe(
          `SELECT linked_competitor AS competitor_id, MAX(created_date) AS freshest
           FROM reviews
           WHERE linked_competitor = ANY($1::text[])
           GROUP BY linked_competitor
           HAVING MAX(created_date::timestamptz) >= $2::timestamptz
           ORDER BY freshest DESC LIMIT 1`,
          donorIds, freshThreshold,
        ) as { competitor_id: string }[];

        if (freshDonor.length > 0) {
          const donorCompetitorId = freshDonor[0].competitor_id;
          // NOT EXISTS anti-join replicates this file's own dedup semantics
          // (google_review_id match OR first-50-chars-of-text match) — safe to
          // run regardless of what this competitor already has.
          const cloned = await (prisma as any).$executeRawUnsafe(
            `INSERT INTO reviews
               (id, linked_business, linked_competitor, platform, rating, text, reviewer_name,
                sentiment, response_status, source_url, source_origin, google_review_id,
                is_verified, created_at, topics, topic_sentiment)
             SELECT gen_random_uuid()::text, $1, $2, d.platform, d.rating, d.text, d.reviewer_name,
                    d.sentiment, NULL, d.source_url, d.source_origin, d.google_review_id,
                    d.is_verified, d.created_at, d.topics, d.topic_sentiment
             FROM reviews d
             WHERE d.linked_competitor = $3
               AND NOT EXISTS (
                 SELECT 1 FROM reviews o
                 WHERE o.linked_competitor = $2
                   AND ( (d.google_review_id IS NOT NULL AND o.google_review_id = d.google_review_id)
                      OR LEFT(o.text, 50) = LEFT(d.text, 50) )
               )`,
            businessProfileId, comp.id, donorCompetitorId,
          ) as number;

          const donorBusiness = donors.find(d => d.id === donorCompetitorId)?.linked_business;
          console.log(`[collectCompetitorReviews] cloned ${cloned} reviews for ${comp.name} from donor ${donorCompetitorId} (business ${donorBusiness}) — skipped SerpAPI/DataForSEO`);
          perCompetitor.push({ name: comp.name, new: cloned });
          totalNew += cloned;
          await backfillTopicsFor({ linked_competitor: comp.id }, topicSet);
          continue;
        }
      }

      // Dedup: existing ids and text-keys already stored for this competitor
      const existing = await (prisma.review as any).findMany({
        where: { linked_competitor: comp.id },
        select: { google_review_id: true, text: true },
      }) as Array<{ google_review_id: string | null; text: string }>;
      const existingIds  = new Set(existing.map(r => r.google_review_id).filter(Boolean));
      const existingKeys = new Set(existing.map(r => (r.text || '').substring(0, 50)));

      // Path 1a: DataForSEO reviews task — async (task_post → postback), never returns
      // reviews inline; results are written by the postback handler when the task completes.
      if (DATAFORSEO_REVIEWS_ENABLED && hasDataForSeoCreds()) {
        try {
          const { taskId, costUsd } = await submitGoogleReviewsTask({
            placeId,
            depth:       Number(process.env.DATAFORSEO_REVIEWS_DEPTH_COMPETITOR) || 500,
            sortBy:      'newest',
            postbackUrl: `${SERVER_BASE_URL}/api/webhooks/dataforseo?secret=${process.env.DATAFORSEO_WEBHOOK_SECRET || ''}`,
            tag:         comp.id,
          });
          if (taskId) {
            await prisma.dataForSeoReviewTask.create({
              data: {
                task_id: taskId, task_type: 'competitor', business_profile_id: businessProfileId,
                linked_competitor: comp.id, cost_usd: costUsd,
              },
            });
            tasksSubmitted++;
            console.log(`[collectCompetitorReviews] DataForSEO reviews task submitted: task_id=${taskId} competitor=${comp.name} (${comp.id}) placeId=${placeId} cost=$${costUsd}`);
          } else {
            console.warn(`[collectCompetitorReviews] DataForSEO reviews task_post returned no taskId for competitor=${comp.name} (${comp.id})`);
          }
        } catch (err: any) {
          console.warn('[collectCompetitorReviews] DataForSEO reviews task_post failed:', err.message);
        }
      }

      // Path 1b: SerpAPI (paginated, up to 300) — active when DataForSEO is disabled
      let rawReviews: any[] = DATAFORSEO_REVIEWS_ENABLED ? [] : await serpGoogleMapsReviews(placeId, MAX_REVIEWS);

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
        // gr.iso_date (SerpAPI) / gr.publishTime (Places API) are real timestamps;
        // gr.date (SerpAPI) is relative text ("3 months ago") and unparseable — never prefer it.
        const publishTime = firstValidDate(gr.iso_date, gr.publishTime) ?? new Date().toISOString();
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

      if (pending.length > 0) {
        const topicsArr = await batchExtractTopics(
          pending.map(p => ({ text: p.text })),
          undefined,
          topicSet,
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
                created_at:        publishTime,
                linked_business:   businessProfileId,
                linked_competitor: comp.id,  // AC4: scoped to competitor
                topics,
                topic_sentiment,
              },
            });
            totalNew++;
          } catch { continue; }
        }
      }

      perCompetitor.push({ name: comp.name, new: pending.length });

      // Backfill: existing reviews that were stored before topic extraction was added.
      // Runs every pass regardless of `pending.length`, since collection is dedup'd and
      // most passes find zero new reviews once a competitor is fully synced.
      await backfillTopicsFor({ linked_competitor: comp.id }, topicSet);
    }

    await writeAutomationLog('collectCompetitorReviews', businessProfileId, startTime, totalNew, 'success');
    console.log(`collectCompetitorReviews done: ${totalNew} new reviews across ${competitors.length} competitors, ${tasksSubmitted} DataForSEO task(s) submitted`);
    return { total_new: totalNew, per_competitor: perCompetitor, dataforseo_tasks_submitted: tasksSubmitted };
}

export async function collectCompetitorReviews(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  try {
    const result = await runCollectCompetitorReviews(businessProfileId);
    return res.json(result);
  } catch (err: any) {
    console.error('collectCompetitorReviews error:', err.message);
    await writeAutomationLog('collectCompetitorReviews', businessProfileId, new Date().toISOString(), 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
