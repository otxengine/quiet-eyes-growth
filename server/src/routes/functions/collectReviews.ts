import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { invokeLLM, startCostTracking, popCost } from '../../lib/llm';
import { batchExtractTopics } from '../../lib/reviewTaxonomy';
import { getSectorProfile } from '../../lib/businessProfile';
import { resolveTopicSet } from '../../lib/reviewTopicPacks';
import { tavilySearch } from '../../lib/tavily';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { tryDecryptToken } from '../../lib/crypto';
import { normReviewOrigin } from '../../lib/signalGuard';
import { findPlaceId, getPlaceDetails } from '../../lib/googlePlaces';
import { serpGoogleMapsReviews, hasSerpApiKey, firstValidDate } from '../../lib/serpapi';
import { submitGoogleReviewsTask, hasDataForSeoCreds } from '../../lib/dataforseo';
import {
  detectCompetitorMentions, snapshotRatingHistory, createNegativeReviewAlerts,
  publishNewReviewEvents, backfillTopicsFor,
} from '../../lib/reviewPostProcessing';
import { runCollectCompetitorReviews } from './collectCompetitorReviews';

const DATAFORSEO_REVIEWS_ENABLED = process.env.DATAFORSEO_REVIEWS_ENABLED === 'true';
const SERVER_BASE_URL = process.env.SERVER_BASE_URL || 'http://localhost:3007';

const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours — Google Places API quota

const SOURCE_QUERIES: Record<string, (name: string, city: string) => string> = {
  facebook:    (n: string, c: string) => `"${n}" ביקורות OR reviews site:facebook.com ${c}`,
  instagram:   (n: string, _c: string) => `"${n}" comments OR תגובות site:instagram.com`,
  tripadvisor: (n: string, _c: string) => `"${n}" site:tripadvisor.com OR site:tripadvisor.co.il`,
  waze:        (n: string, c: string) => `"${n}" site:waze.com ${c}`,
  tiktok:      (n: string, _c: string) => `"${n}" site:tiktok.com`,
  wolt:        (n: string, _c: string) => `"${n}" ביקורות site:wolt.com`,
  '10bis':     (n: string, c: string) => `"${n}" ביקורות site:10bis.co.il OR "${n}" ${c} 10bis`,
  easy:        (n: string, _c: string) => `"${n}" ביקורות OR חוות דעת site:easy.co.il`,
  booking:     (n: string, _c: string) => `"${n}" reviews site:booking.com OR site:booking.co.il`,
  forums:      (n: string, c: string) => `"${n}" חוות דעת OR ביקורות OR המלצה site:tapuz.co.il OR site:zap.co.il OR "${n}" פורום ${c}`,
};
const SOURCE_PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook', instagram: 'Instagram', tripadvisor: 'TripAdvisor',
  waze: 'Waze', tiktok: 'TikTok', wolt: 'Wolt',
  '10bis': '10BIS', easy: 'easy.co.il', booking: 'Booking.com', forums: 'פורומים',
};

export async function collectReviews(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  const requestedSources: string[] = req.body.sources || [];
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (!req.body.force && shouldSkipAgent(businessProfileId, 'collectReviews', MIN_INTERVAL_MS)) {
    await writeAutomationLog('collectReviews', businessProfileId, new Date().toISOString(), 0, 'success', 'ran_recently');
    return res.json({ new_reviews: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  startCostTracking(businessProfileId);
  let tavilyFailed: string | undefined;
  const onTavilyError = (msg: string) => { tavilyFailed = msg; };
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

    // ── Google My Business API (OAuth) — preferred when client has connected ────
    const gmbAccount = await prisma.socialAccount.findFirst({
      where: { linked_business: businessProfileId, platform: 'google_business', is_connected: true },
    });
    const gmbLocationPath = gmbAccount?.page_id;
    const rawGmbToken = gmbAccount?.access_token;
    const gmbToken = (rawGmbToken ? tryDecryptToken(rawGmbToken) : null) || (profile as any).google_access_token;

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
              const isAuthErr = gmbRes.status === 401 || gmbRes.status === 403;
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
              if (existingTexts.has(textKey) || text.length < 5) continue;
              const rating = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }[gr.starRating as string] ?? 0;
              const sentiment = rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';
              const reviewerName = gr.reviewer?.displayName || 'לקוח';
              gmbPending.push({ gr, reviewId, text, textKey, rating, sentiment, reviewerName });
            }
            // AC2: page had no new reviews — stop early, older pages won't have new ones either
            if (gmbPending.length === pendingBefore) break;
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
                  source_url: `https://www.google.com/maps/search/?q=${encodeURIComponent(name)}`,
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

    // ── DataForSEO google/reviews task — depth backfill, priority 2 ──────────
    // Async (task_post → postback), so it never adds to googleAdded/newReviews here —
    // results arrive later via /api/webhooks/dataforseo and run through the same
    // post-processing pipeline. Falls through to SerpAPI when disabled, to Places
    // either way (see DATAFORSEO_REVIEWS_ENABLED rollout notes in dataforseo.ts).
    let dataforseoTaskPending = false;
    if (googleAdded === 0 && DATAFORSEO_REVIEWS_ENABLED && hasDataForSeoCreds()) {
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
            console.warn(`[collectReviews] DataForSEO reviews task_post returned no taskId for businessProfileId=${businessProfileId} — see [dataforseo] warnings above for the reason`);
          }
        }
      } catch (err: any) {
        console.warn('[collectReviews] DataForSEO reviews task_post failed, falling through to SerpAPI/Places:', err.message);
      }
    }

    // ── SerpAPI google_maps_reviews — depth backfill, fallback when DataForSEO disabled ──
    if (googleAdded === 0 && !DATAFORSEO_REVIEWS_ENABLED && hasSerpApiKey()) {
      try {
        const serpPlaceId: string | null = profile.google_place_id || await findPlaceId(name, city);
        if (serpPlaceId && !profile.google_place_id) {
          await prisma.businessProfile.update({ where: { id: businessProfileId }, data: { google_place_id: serpPlaceId, google_place_id_verified: true } });
        }
        if (serpPlaceId) {
          const serpReviews = await serpGoogleMapsReviews(serpPlaceId, 300);
          const serpPending: Array<{
            reviewId: string; textKey: string; text: string;
            rating: number; sentiment: string; reviewerName: string; createdAt: string;
          }> = [];
          for (const sr of serpReviews) {
            const text: string = sr.snippet || '';
            if (!text || text.length < 5) continue;
            const reviewId = `serpgmr_${(sr.user?.link || sr.user?.name || '').replace(/[^a-z0-9]/gi, '_').substring(0, 40)}`;
            if (existingGoogleIds.has(reviewId)) continue;
            const textKey = text.substring(0, 50);
            if (existingTexts.has(textKey)) continue;
            const rating: number = sr.rating || 0;
            const sentiment = rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';
            const createdAt = firstValidDate(sr.iso_date) ?? new Date().toISOString();
            serpPending.push({ reviewId, textKey, text, rating, sentiment, reviewerName: sr.user?.name || 'לקוח', createdAt });
          }
          if (serpPending.length > 0) {
            const serpTopics = await batchExtractTopics(serpPending.map(p => ({ text: p.text })), undefined, topicSet);
            for (let i = 0; i < serpPending.length; i++) {
              const { reviewId, textKey, text, rating, sentiment, reviewerName, createdAt } = serpPending[i];
              const { topics, topic_sentiment } = serpTopics[i];
              await prisma.review.create({
                data: {
                  platform:        'Google',
                  rating,
                  text:            text.substring(0, 2000),
                  reviewer_name:   reviewerName,
                  sentiment,
                  response_status: 'pending',
                  source_url:      `https://www.google.com/maps/search/?q=${encodeURIComponent(name)}`,
                  source_origin:   normReviewOrigin('serp_google_maps_reviews', 'collectReviews:serp'),
                  google_review_id: reviewId,
                  is_verified:     true,
                  created_at:      createdAt,
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
        }
      } catch (err: any) {
        console.warn('[collectReviews] SerpAPI google_maps_reviews failed, falling through to Places:', err.message);
      }
    }

    // ── Google Places API — fallback, priority 3 (≤5 sample) ────────────────
    if (googleAdded === 0) {
      const placeId = profile.google_place_id || await findPlaceId(name, city);
      if (placeId) {
        if (!profile.google_place_id) {
          await prisma.businessProfile.update({ where: { id: businessProfileId }, data: { google_place_id: placeId, google_place_id_verified: true } });
        }
        const { reviews: googleReviews } = await getPlaceDetails(placeId);
        const placesPending: Array<{ gr: any; googleId: string; textKey: string; sentiment: string; reviewText: string; authorName: string }> = [];
        for (const gr of googleReviews) {
          const reviewText  = gr.text?.text || '';
          const authorName  = gr.authorAttribution?.displayName || 'לקוח';
          const reviewTime  = Math.floor(new Date(gr.publishTime).getTime() / 1000);
          const googleId    = `places_${authorName}_${reviewTime}`;
          if (existingGoogleIds.has(googleId)) continue;
          const textKey = reviewText.substring(0, 50);
          if (existingTexts.has(textKey) || !reviewText || reviewText.length < 5) continue;
          const sentiment = gr.rating >= 4 ? 'positive' : gr.rating <= 2 ? 'negative' : 'neutral';
          placesPending.push({ gr, googleId, textKey, sentiment, reviewText, authorName });
        }
        const placesTopics = await batchExtractTopics(placesPending.map(p => ({ text: p.reviewText })), undefined, topicSet);
        for (let i = 0; i < placesPending.length; i++) {
          const { gr, googleId, textKey, sentiment, reviewText, authorName } = placesPending[i];
          const { topics, topic_sentiment } = placesTopics[i];
          await prisma.review.create({
            data: {
              platform: 'Google',
              rating: gr.rating,
              text: reviewText.substring(0, 2000),
              reviewer_name: authorName,
              sentiment,
              response_status: 'pending',
              source_url: `https://www.google.com/maps/place/?q=place_id:${placeId}`,
              source_origin: 'google_places',
              google_review_id: googleId,
              is_verified: true,
              created_at: new Date(gr.publishTime).toISOString(),
              linked_business: businessProfileId,
              topics,
              topic_sentiment,
            },
          });
          existingGoogleIds.add(googleId);
          existingTexts.add(textKey);
          newReviews++;
          googleAdded++;
        }
      }
    }

    // ── Tavily direct search — when no Google API key available ──────────────
    if (googleAdded === 0) {
      const tavilyResults = await tavilySearch(`"${name}" ביקורות ${city}`, 8, 30, onTavilyError);
      // Batch-classify all Tavily results in one Haiku call
      const tavilyContents = tavilyResults
        .map(r => ({ content: r.content || r.snippet || '', url: r.url || '' }))
        .filter(r => r.content.length >= 20 && !existingTexts.has(r.content.substring(0, 50)));

      if (tavilyContents.length > 0) {
        const itemsStr = tavilyContents
          .map((r, i) => `[${i}] מ-${r.url}: "${r.content.substring(0, 300)}"`)
          .join('\n');
        let tavilyParsed: any[] = [];
        try {
          const batchResult = await invokeLLM({
            prompt: `For each text snippet, determine whether it contains a review of "${name}". Extract: text (up to 300 chars), rating (1-5 or 0), reviewer_name, platform, is_review (true/false).\n${itemsStr}\nReturn ONLY valid JSON. ALL string values must be in Hebrew. {"results":[{...},...]}, array of the same length and order.`,
            response_json_schema: { type: 'object' },
            model: 'haiku',
            maxTokens: 1000,
            costTrackingId: businessProfileId,
          });
          tavilyParsed = batchResult?.results || [];
        } catch { tavilyParsed = []; }

        const tavilyReviewsPending: Array<{ parsed: any; url: string }> = [];
        for (let i = 0; i < tavilyContents.length; i++) {
          const parsed = tavilyParsed[i];
          if (!parsed?.text || parsed.text.length < 10 || parsed.is_review === false) continue;
          if (existingTexts.has(parsed.text.substring(0, 50))) continue;
          tavilyReviewsPending.push({ parsed, url: tavilyContents[i].url });
        }
        const tavilyTopics = await batchExtractTopics(tavilyReviewsPending.map(p => ({
          text: p.parsed.text,
        })), businessProfileId, topicSet);
        for (let i = 0; i < tavilyReviewsPending.length; i++) {
          const { parsed, url } = tavilyReviewsPending[i];
          const { topics, topic_sentiment } = tavilyTopics[i];
          const rating = parsed.rating || 0;
          const sentiment = rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';
          try {
            await prisma.review.create({
              data: {
                platform: parsed.platform || 'אתר חיצוני',
                rating,
                text: parsed.text.substring(0, 2000),
                reviewer_name: parsed.reviewer_name || 'לקוח',
                sentiment,
                response_status: 'pending',
                source_url: url || `https://www.google.com/search?q=${encodeURIComponent(name + ' ביקורות')}`,
                source_origin: 'tavily',
                is_verified: false,
                created_at: new Date().toISOString(),
                linked_business: businessProfileId,
                topics,
                topic_sentiment,
              },
            });
            existingTexts.add(parsed.text.substring(0, 50));
            newReviews++;
          } catch { continue; }
        }
      }
    }

    // ── Multi-source Tavily scan (facebook, instagram, tripadvisor, etc.) ────
    // ponytail: auto-fallback to all sources when tiers 1-3 found nothing; explicit sources still honoured otherwise
    const sourcesToScan = newReviews === 0
      ? Object.keys(SOURCE_QUERIES)
      : requestedSources.filter(s => s !== 'google' && SOURCE_QUERIES[s]);
    let sourcesScanCount = 0;
    for (const source of sourcesToScan) {
      const query = SOURCE_QUERIES[source](name, city);
      const platformLabel = SOURCE_PLATFORM_LABELS[source] || source;
      const tavilyHits = await tavilySearch(query, 6, 30, onTavilyError);
      const newHits = tavilyHits.filter(r => {
        const content = r.content || r.snippet || '';
        return content.length >= 20 && !existingTexts.has(content.substring(0, 50));
      });
      if (newHits.length === 0) continue;

      const itemsStr = newHits
        .map((r, i) => `[${i}] מ-${r.url}: "${(r.content || r.snippet || '').substring(0, 300)}"`)
        .join('\n');
      let parsed: any[] = [];
      try {
        const result = await invokeLLM({
          prompt: `For each text snippet, determine whether it contains a review of "${name}". Extract: text (up to 300 chars), rating (1-5 or 0), reviewer_name, is_review (true/false).\n${itemsStr}\nReturn ONLY valid JSON. ALL string values must be in Hebrew. {"results":[{...},...]}, array of the same length and order.`,
          response_json_schema: { type: 'object' },
          model: 'haiku',
          maxTokens: 900,
          costTrackingId: businessProfileId,
        });
        parsed = result?.results || [];
      } catch { parsed = []; }

      const pending: Array<{ p: any; url: string }> = [];
      for (let i = 0; i < newHits.length; i++) {
        const p = parsed[i];
        if (!p?.is_review || !p.text || p.text.length < 10) continue;
        if (existingTexts.has(p.text.substring(0, 50))) continue;
        pending.push({ p, url: newHits[i].url || '' });
      }
      const topics = await batchExtractTopics(pending.map(({ p }) => ({
        text: p.text,
      })), businessProfileId, topicSet);
      for (let i = 0; i < pending.length; i++) {
        const { p, url } = pending[i];
        const { topics: t, topic_sentiment } = topics[i];
        const rating = p.rating || 0;
        const sentiment = rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';
        try {
          await prisma.review.create({
            data: {
              platform: platformLabel,
              rating,
              text: p.text.substring(0, 2000),
              reviewer_name: p.reviewer_name || 'לקוח',
              sentiment,
              response_status: 'pending',
              source_url: url || null,
              source_origin: 'tavily',
              is_verified: false,
              created_at: new Date().toISOString(),
              linked_business: businessProfileId,
              topics: t,
              topic_sentiment,
            },
          });
          existingTexts.add(p.text.substring(0, 50));
          newReviews++;
          sourcesScanCount++;
        } catch { continue; }
      }
    }

    // ── Tavily fallback from raw signals (last resort — only when all prior tiers found nothing) ──
    if (newReviews === 0) {
    const rawSignals = await prisma.rawSignal.findMany({
      where: { linked_business: businessProfileId, source_origin: 'tavily' },
      orderBy: { created_date: 'desc' },
      take: 200,
    });

    const reviewPlatforms = ['google.com/maps', 'facebook.com', 'tripadvisor', 'yelp.com', 'wolt.com', '10bis.co.il'];
    const nameParts = name.split(' ').filter((p: string) => p.length > 2);
    const existingUrls = new Set(existingReviews.map((r: typeof existingReviews[0]) => r.source_url).filter(Boolean));

    const reviewSignals = rawSignals.filter((s: typeof rawSignals[0]) => {
      const url = (s.url || '').toLowerCase();
      const content = s.content || '';
      return reviewPlatforms.some(p => url.includes(p)) &&
        nameParts.some((part: string) => content.includes(part)) &&
        s.url?.startsWith('http') &&
        !existingUrls.has(s.url);
    }).slice(0, 20);

    if (reviewSignals.length > 0) {
      // Batch-classify raw signals in one Haiku call
      const signalsStr = reviewSignals
        .map((s: typeof reviewSignals[0], i: number) => `[${i}] מ-${s.url}: "${(s.content || '').substring(0, 250)}"`)
        .join('\n');
      let signalsParsed: any[] = [];
      try {
        const batchResult = await invokeLLM({
          prompt: `For each snippet, determine whether it is a review of "${name}". Extract: text, rating (1-5 or 0), reviewer_name, platform, is_review.\n${signalsStr}\nReturn ONLY valid JSON. ALL string values must be in Hebrew. {"results":[...]}, same length and same order.`,
          response_json_schema: { type: 'object' },
          model: 'haiku',
          maxTokens: 1000,
          costTrackingId: businessProfileId,
        });
        signalsParsed = batchResult?.results || [];
      } catch { signalsParsed = []; }

      const signalReviewsPending: Array<{ parsed: any; url: string }> = [];
      for (let i = 0; i < reviewSignals.length; i++) {
        const parsed = signalsParsed[i];
        if (!parsed?.is_review || !parsed.text || parsed.text.length < 10) continue;
        const textKey = parsed.text.substring(0, 50);
        if (existingTexts.has(textKey)) continue;
        signalReviewsPending.push({ parsed, url: reviewSignals[i].url || '' });
      }
      const signalTopics = await batchExtractTopics(signalReviewsPending.map(p => ({
        text: p.parsed.text,
      })), businessProfileId, topicSet);
      for (let i = 0; i < signalReviewsPending.length; i++) {
        const { parsed, url } = signalReviewsPending[i];
        const { topics, topic_sentiment } = signalTopics[i];
        const rating = parsed.rating || 0;
        const sentiment = rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';
        try {
          await prisma.review.create({
            data: {
              platform: parsed.platform || 'אתר חיצוני',
              rating,
              text: parsed.text.substring(0, 2000),
              reviewer_name: parsed.reviewer_name || 'לקוח',
              sentiment,
              response_status: 'pending',
              source_url: url,
              source_origin: 'tavily',
              is_verified: false,
              created_at: new Date().toISOString(),
              linked_business: businessProfileId,
              topics,
              topic_sentiment,
            },
          });
          existingTexts.add(parsed.text.substring(0, 50));
          newReviews++;
        } catch { continue; }
      }
    }
    } // end if (newReviews === 0) — T5 RawSignal fallback

    // ── Competitor mention detection in new reviews ──────────────────────────
    if (newReviews > 0) {
      await detectCompetitorMentions(businessProfileId, startTime);
    }

    setLastRun(businessProfileId, 'collectReviews');
    await writeAutomationLog('collectReviews', businessProfileId, startTime, newReviews, tavilyFailed ? 'failed' : 'success', tavilyFailed, popCost(businessProfileId));
    console.log(`collectReviews done: ${newReviews} new reviews (${googleAdded} from Google, ${sourcesScanCount} from other sources)`);

    // ── Snapshot current avg rating → rating_history for trend graph ─────────
    await snapshotRatingHistory(businessProfileId, newReviews, 'collectReviews');

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
      sources_scanned: sourcesToScan.length + (googleAdded > 0 ? 1 : 0),
      gmb_path: gmbPathResult,
      dataforseo_task_pending: dataforseoTaskPending,
    });
  } catch (err: any) {
    console.error('collectReviews error:', err.message);
    await writeAutomationLog('collectReviews', businessProfileId, startTime, 0, 'failed', err.message, popCost(businessProfileId));
    return res.status(500).json({ error: err.message });
  }
}
