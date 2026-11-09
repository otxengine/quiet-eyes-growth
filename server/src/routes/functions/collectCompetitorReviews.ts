import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { findPlaceId } from '../../lib/googlePlaces';
import { submitGoogleReviewsTask, hasDataForSeoCreds } from '../../lib/dataforseo';
import { getSectorProfile } from '../../lib/businessProfile';
import { resolveTopicSet } from '../../lib/reviewTopicPacks';
import { backfillTopicsFor } from '../../lib/reviewPostProcessing';
import { findDonorCandidates } from '../../lib/competitorDonor';

const SERVER_BASE_URL = process.env.SERVER_BASE_URL || 'http://localhost:3007';
// This function has no freshness guard of its own (unlike the other collect
// agents) — reusing its real-world daily cadence as the donor-freshness window.
const REVIEW_DONOR_FRESHNESS_MS = 24 * 60 * 60 * 1000;

/**
 * KAN-121 — Competitor Google review ingest.
 * Per tracked competitor: clone fresh reviews from another business tracking the same place (donor),
 * otherwise submit a DataForSEO reviews task — the only review source. Its webhook
 * (routes/webhooks/dataforseo.ts) writes, links and topic-tags the reviews when the task completes.
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
    const dataforseoOn = process.env.DATAFORSEO_REVIEWS_ENABLED === 'true' && hasDataForSeoCreds();
    if (!dataforseoOn) console.warn(`[collectCompetitorReviews] DataForSEO reviews disabled or missing credentials — no competitor reviews collected for business ${businessProfileId}`);

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
                      -- star-only/short texts can't identify a review: '' would match every other ''
                      OR (length(d.text) >= 5 AND LEFT(o.text, 50) = LEFT(d.text, 50)) )
               )`,
            businessProfileId, comp.id, donorCompetitorId,
          ) as number;

          const donorBusiness = donors.find(d => d.id === donorCompetitorId)?.linked_business;
          console.log(`[collectCompetitorReviews] cloned ${cloned} reviews for ${comp.name} from donor ${donorCompetitorId} (business ${donorBusiness}) — skipped DataForSEO`);
          perCompetitor.push({ name: comp.name, new: cloned });
          totalNew += cloned;
          await backfillTopicsFor({ linked_competitor: comp.id }, topicSet);
          continue;
        }
      }

      // DataForSEO reviews task — async (task_post → postback); the webhook writes the reviews.
      if (dataforseoOn) {
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
      perCompetitor.push({ name: comp.name, new: 0 }); // new reviews are counted by the webhook

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
