import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { startCostTracking, popCost } from '../../lib/llm';
import { batchExtractTopics } from '../../lib/reviewTaxonomy';
import { getSectorProfile } from '../../lib/businessProfile';
import { resolveTopicSet } from '../../lib/reviewTopicPacks';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { tryDecryptToken } from '../../lib/crypto';
import { getValidGoogleToken } from '../../lib/googleTokenRefresh';
import { normReviewOrigin } from '../../lib/signalGuard';
import { findPlaceId } from '../../lib/googlePlaces';
import { submitGoogleReviewsTask, hasDataForSeoCreds } from '../../lib/dataforseo';
import {
  detectCompetitorMentions, snapshotRatingHistory, createNegativeReviewAlerts,
  publishNewReviewEvents, backfillTopicsFor,
} from '../../lib/reviewPostProcessing';
import { runCollectCompetitorReviews } from './collectCompetitorReviews';

// Review sources: DataForSEO for every business (async, results land in /api/webhooks/dataforseo), plus the
// Google Business Profile API when a customer has connected it. Google Places, SerpAPI and Tavily web search
// were removed as review sources: Places returned no reviews and web search pulled in other businesses' reviews.
const SERVER_BASE_URL = process.env.SERVER_BASE_URL || 'http://localhost:3007';

const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours — one DataForSEO task per business per half day

export async function collectReviews(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (!req.body.force && shouldSkipAgent(businessProfileId, 'collectReviews', MIN_INTERVAL_MS)) {
    await writeAutomationLog('collectReviews', businessProfileId, new Date().toISOString(), 0, 'success', 'ran_recently');
    return res.json({ new_reviews: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  startCostTracking(businessProfileId);
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, city } = profile;
    const sp = getSectorProfile(profile);
    const topicSet = resolveTopicSet(sp?.sector_key ?? 'other', sp?.onboarding_review_extras ?? []);
    let newReviews = 0;
    let googleAdded = 0;
    let gmbPathResult: 'success' | 'failed' | 'not_connected' = 'not_connected';

    const existingReviews = await prisma.review.findMany({ where: { linked_business: businessProfileId } });
    const existingGoogleIds = new Set(existingReviews.map((r: typeof existingReviews[0]) => r.google_review_id).filter(Boolean));
    const existingTexts = new Set(existingReviews.map((r: typeof existingReviews[0]) => (r.text || '').substring(0, 50)));
    // GBP API reviews carry no public per-review URL — the business's own Maps page is the closest link.
    const placeLink = (id: string | null) => id
      ? `https://www.google.com/maps/place/?q=place_id:${id}`
      : `https://www.google.com/maps/search/?q=${encodeURIComponent(name)}`;

    // ── Google My Business API (OAuth) — preferred when client has connected ────
    const gmbAccount = await prisma.socialAccount.findFirst({
      where: { linked_business: businessProfileId, platform: 'google_business', is_connected: true },
    });
    const gmbLocationPath = gmbAccount?.page_id;
    const rawProfileToken = (profile as any).google_access_token as string | null;
    // Auto-refreshing — a stale 1h token would 401 and the handler below would disconnect the account
    const gmbToken = (gmbAccount ? await getValidGoogleToken(businessProfileId).catch(() => null) : null)
      || (rawProfileToken ? tryDecryptToken(rawProfileToken) : null);
    // Reviews stored earlier by a scraper (SerpAPI/DataForSEO/Places) lack the GBP review name the
    // reply API needs — matched by text+rating below and linked instead of skipped.
    const scrapedByText = new Map(existingReviews
      // Star-only/short reviews share near-empty text, so text can't pair them — they'd link to an arbitrary row.
      .filter((r: typeof existingReviews[0]) => r.platform === 'Google' && !r.linked_competitor && !r.google_review_id?.startsWith('accounts/') && (r.text || '').length >= 5)
      .map((r: typeof existingReviews[0]) => [(r.text || '').substring(0, 50), r]));

    if (gmbToken && gmbLocationPath) {
      if (!gmbLocationPath.includes('/')) {
        gmbPathResult = 'failed';
        console.warn(`[collectReviews] GMB page_id "${gmbLocationPath}" is not a valid location path (expected "accounts/X/locations/Y") — skipping GMB`);
      } else {
        gmbPathResult = 'success'; // account is connected; only reverts on auth error
        try {
          let nextPageToken: string | undefined;
          const gmbPending: Array<{ gr: any; reviewId: string; text: string; textKey: string; rating: number; sentiment: string; reviewerName: string }> = [];
          do {
            // GMB API returns reviews newest-first (updateTime desc) by default
            const pageUrl = `https://mybusiness.googleapis.com/v4/${gmbLocationPath}/reviews?pageSize=50${nextPageToken ? `&pageToken=${nextPageToken}` : ''}`;
            const gmbRes = await fetch(pageUrl, { headers: { Authorization: `Bearer ${gmbToken}` } });
            if (!gmbRes.ok) {
              const errData: any = await gmbRes.json().catch(() => ({}));
              // SERVICE_DISABLED = an API is off in our Cloud project — reconnecting can't fix that, so don't disconnect the customer
              const isAuthErr = (gmbRes.status === 401 || gmbRes.status === 403) && !JSON.stringify(errData).includes('SERVICE_DISABLED');
              console.warn(`[collectReviews] GMB API ${gmbRes.status}: ${errData?.error?.message || 'unknown error'}${isAuthErr ? '' : ' — falling back to Places'}`);
              if (isAuthErr && gmbAccount) {
                gmbPathResult = 'failed';
                await prisma.socialAccount.update({
                  where: { id: gmbAccount.id },
                  data:  { is_connected: false, last_error: `gmb_${gmbRes.status}:${errData?.error?.message || 'auth_failed'}` },
                }).catch(() => {});
                await writeAutomationLog('collectReviews', businessProfileId, startTime, 0, 'failed', `gmb_${gmbRes.status}:${errData?.error?.message || 'auth_failed'}`);
                return res.json({ new_reviews: 0, oauth_error: true, reason: `gmb_${gmbRes.status}`, gmb_path: 'failed' });
              }
              break;
            }
            const gmbData: any = await gmbRes.json();
            nextPageToken = gmbData.nextPageToken;
            const pendingBefore = gmbPending.length;
            let linkedThisPage = 0;
            for (const gr of (gmbData.reviews || [])) {
              const reviewId = gr.name;
              if (existingGoogleIds.has(reviewId)) {
                // AC4: sync owner reply on already-stored review — only mutable fields touched
                if (gr.reviewReply?.comment) {
                  await prisma.review.updateMany({
                    where: { google_review_id: reviewId, linked_business: businessProfileId },
                    data:  { response_status: 'published', suggested_response: gr.reviewReply.comment },
                  });
                }
                continue;
              }
              const text = gr.comment || '';
              const textKey = text.substring(0, 50);
              const rating = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }[gr.starRating as string] ?? 0;
              if (existingTexts.has(textKey) || text.length < 5) {
                const scraped = scrapedByText.get(textKey);
                if (scraped && scraped.rating === rating) {
                  await prisma.review.updateMany({
                    where: { id: scraped.id, linked_business: businessProfileId },
                    data:  {
                      google_review_id: reviewId,
                      ...(gr.reviewReply?.comment ? { response_status: 'published', suggested_response: gr.reviewReply.comment } : {}),
                    },
                  });
                  scrapedByText.delete(textKey);
                  existingGoogleIds.add(reviewId);
                  linkedThisPage++;
                }
                continue;
              }
              const sentiment = rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';
              const reviewerName = gr.reviewer?.displayName || 'לקוח';
              gmbPending.push({ gr, reviewId, text, textKey, rating, sentiment, reviewerName });
            }
            // AC2: page had no new reviews — stop early, older pages won't have new ones either
            if (gmbPending.length === pendingBefore && linkedThisPage === 0) break;
          } while (nextPageToken);

          if (gmbPending.length > 0) {
            const gmbTopics = await batchExtractTopics(gmbPending.map(p => ({ text: p.text })), undefined, topicSet);
            for (let i = 0; i < gmbPending.length; i++) {
              const { gr, reviewId, text, textKey, rating, sentiment, reviewerName } = gmbPending[i];
              const { topics, topic_sentiment } = gmbTopics[i];
              await prisma.review.create({
                data: {
                  platform: 'Google',
                  rating,
                  text: text.substring(0, 2000),
                  reviewer_name: reviewerName,
                  sentiment,
                  response_status: gr.reviewReply ? 'published' : 'pending',
                  source_url: placeLink(profile.google_place_id),
                  source_origin: normReviewOrigin('google_business_api', 'collectReviews:gmb'),
                  google_review_id: reviewId,
                  is_verified: true,
                  created_at: gr.createTime || new Date().toISOString(),
                  linked_business: businessProfileId,
                  topics,
                  topic_sentiment,
                },
              });
              existingGoogleIds.add(reviewId);
              existingTexts.add(textKey);
              newReviews++;
              googleAdded++;
            }
          }
        } catch (err: any) {
          console.warn('GMB API reviews fetch failed, falling back to Places:', err.message);
        }
      }
    }

    // ── DataForSEO google/reviews task — the review source ───────────────────
    // Async (task_post → postback), so it never adds to googleAdded/newReviews here —
    // results arrive later via /api/webhooks/dataforseo and run through the same
    // post-processing pipeline. No fallback source: if it can't run, the reason is logged as a failure.
    let dataforseoTaskPending = false;
    let dataforseoProblem: string | undefined;
    if (googleAdded === 0 && !(process.env.DATAFORSEO_REVIEWS_ENABLED === 'true' && hasDataForSeoCreds())) {
      dataforseoProblem = 'dataforseo_disabled';
      console.warn(`[collectReviews] DataForSEO reviews disabled or missing credentials — no reviews collected for businessProfileId=${businessProfileId}`);
    } else if (googleAdded === 0) {
      try {
        const dfsPlaceId: string | null = profile.google_place_id || await findPlaceId(name, city);
        if (dfsPlaceId && !profile.google_place_id) {
          await prisma.businessProfile.update({ where: { id: businessProfileId }, data: { google_place_id: dfsPlaceId, google_place_id_verified: true } });
        }
        if (dfsPlaceId) {
          const { taskId, costUsd } = await submitGoogleReviewsTask({
            placeId:     dfsPlaceId,
            depth:       Number(process.env.DATAFORSEO_REVIEWS_DEPTH_OWN) || 300,
            sortBy:      'newest',
            postbackUrl: `${SERVER_BASE_URL}/api/webhooks/dataforseo?secret=${process.env.DATAFORSEO_WEBHOOK_SECRET || ''}`,
            tag:         businessProfileId,
          });
          if (taskId) {
            await prisma.dataForSeoReviewTask.create({
              data: { task_id: taskId, task_type: 'own', business_profile_id: businessProfileId, cost_usd: costUsd },
            });
            dataforseoTaskPending = true;
            console.log(`[collectReviews] DataForSEO reviews task submitted: task_id=${taskId} businessProfileId=${businessProfileId} placeId=${dfsPlaceId} cost=$${costUsd}`);
          } else {
            dataforseoProblem = 'dataforseo_no_task';
            console.warn(`[collectReviews] DataForSEO reviews task_post returned no taskId for businessProfileId=${businessProfileId} — see [dataforseo] warnings above for the reason`);
          }
        } else {
          dataforseoProblem = 'no_google_place';
          console.warn(`[collectReviews] No Google place found for businessProfileId=${businessProfileId} — no reviews collected`);
        }
      } catch (err: any) {
        dataforseoProblem = `dataforseo_error:${err.message}`;
        console.warn('[collectReviews] DataForSEO reviews task_post failed:', err.message);
      }
    }

    // ── Competitor mention detection in new reviews ──────────────────────────
    if (newReviews > 0) {
      await detectCompetitorMentions(businessProfileId, startTime);
    }

    setLastRun(businessProfileId, 'collectReviews');
    const collected = gmbPathResult === 'success' || dataforseoTaskPending;
    await writeAutomationLog('collectReviews', businessProfileId, startTime, newReviews, collected ? 'success' : 'failed', collected ? undefined : dataforseoProblem, popCost(businessProfileId));
    console.log(`collectReviews done: ${newReviews} new reviews from Google Business Profile, DataForSEO task ${dataforseoTaskPending ? 'pending' : `not sent (${dataforseoProblem ?? 'not needed'})`}`);

    // ── Snapshot current avg rating → rating_history for trend graph ─────────
    await snapshotRatingHistory(businessProfileId, newReviews, 'collectReviews');

    // ── Recompute own google_rating/google_review_count from ingested Google reviews ──
    // GBP's Business Information API doesn't expose an aggregate rating — compute it
    // from the reviews already pulled via the GMB v4 API above, same source as everywhere else.
    if (googleAdded > 0) {
      const ownGoogleReviews = await prisma.review.findMany({
        where: { linked_business: businessProfileId, linked_competitor: null, platform: 'Google' },
        select: { rating: true },
      });
      if (ownGoogleReviews.length > 0) {
        const avgRating = ownGoogleReviews.reduce((s: number, r: typeof ownGoogleReviews[0]) => s + (r.rating || 0), 0) / ownGoogleReviews.length;
        await prisma.businessProfile.update({
          where: { id: businessProfileId },
          data: { google_rating: parseFloat(avgRating.toFixed(2)), google_review_count: ownGoogleReviews.length },
        }).catch(() => {});
      }
    }

    // ── Real-time alert: create ProactiveAlert for new negative reviews ───────
    if (newReviews > 0) {
      await createNegativeReviewAlerts(businessProfileId);
    }

    // Publish one new_review event per review — exactly once (KAN-18 AC4)
    if (newReviews > 0) {
      await publishNewReviewEvents(businessProfileId, startTime, {
        source: 'collectReviews',
        extraPayload: { google_added: googleAdded },
        impact: googleAdded > 0 ? 'medium' : 'low',
      });
    }

    // Backfill own reviews that lack topic_sentiment (pre-extraction era or truncated batch)
    await backfillTopicsFor({ linked_business: businessProfileId }, topicSet);

    // Auto-trigger competitor review collection in background (KAN-127) — unless
    // the caller (e.g. onboarding) is already triggering it explicitly itself,
    // to avoid a duplicate concurrent SerpAPI/DataForSEO run.
    if (!req.body.skipCompetitorTrigger) {
      runCollectCompetitorReviews(businessProfileId).catch(e =>
        console.error('[collectReviews] background competitor ingest failed:', e.message)
      );
    }

    return res.json({
      new_reviews: newReviews,
      google_reviews_added: googleAdded,
      gmb_path: gmbPathResult,
      dataforseo_task_pending: dataforseoTaskPending,
      ...(dataforseoProblem && !dataforseoTaskPending ? { reason: dataforseoProblem } : {}),
    });
  } catch (err: any) {
    console.error('collectReviews error:', err.message);
    await writeAutomationLog('collectReviews', businessProfileId, startTime, 0, 'failed', err.message, popCost(businessProfileId));
    return res.status(500).json({ error: err.message });
  }
}
