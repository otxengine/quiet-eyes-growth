import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { invokeLLM } from '../../lib/llm';
import { tavilySearch } from '../../lib/tavily';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { publishEvent } from '../../lib/eventBus';

const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours — Google Places API quota
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';

async function findPlaceId(name: string, city: string): Promise<string | null> {
  if (!GOOGLE_API_KEY) { console.warn('[collectReviews] No GOOGLE_PLACES_API_KEY'); return null; }
  try {
    const input = encodeURIComponent(`${name} ${city}`);
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${input}&inputtype=textquery&fields=place_id&key=${GOOGLE_API_KEY}`);
    const data: any = await res.json();
    const placeId = data.candidates?.[0]?.place_id || null;
    console.log(`[collectReviews] findPlaceId status=${data.status} placeId=${placeId} candidates=${data.candidates?.length ?? 0}`);
    return placeId;
  } catch (e: any) { console.warn('[collectReviews] findPlaceId error:', e.message); return null; }
}

async function getPlaceReviews(placeId: string): Promise<any[]> {
  if (!GOOGLE_API_KEY) return [];
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=rating,user_ratings_total,reviews&language=iw&key=${GOOGLE_API_KEY}`);
    const data: any = await res.json();
    const reviews = data.result?.reviews || [];
    console.log(`[collectReviews] getPlaceReviews status=${data.status} reviews=${reviews.length} total_ratings=${data.result?.user_ratings_total ?? 0}`);
    return reviews;
  } catch (e: any) { console.warn('[collectReviews] getPlaceReviews error:', e.message); return []; }
}

// ── Batch topic extraction — 1 Haiku call for all reviews ────────────────────

async function batchExtractTopics(
  reviews: Array<{ text: string; sentiment: string }>,
): Promise<Array<{ topics: string; topic_sentiment: string }>> {
  const fallback = reviews.map(r => ({ topics: r.sentiment, topic_sentiment: '{}' }));
  if (reviews.length === 0) return fallback;

  const itemsStr = reviews
    .map((r, i) => `[${i}] "${r.text.substring(0, 200)}"`)
    .join('\n');

  try {
    const result = await invokeLLM({
      prompt: `Extract topics from the following reviews. For each review: up to 4 topics (service/price/quality/cleanliness/atmosphere/availability/delivery) and a sentiment per topic (positive/negative/neutral).
${itemsStr}
Return ONLY valid JSON. ALL string values must be in Hebrew. {"results":[{"topics":["נושא1"],"sentiments":{"נושא1":"positive"}},...]}, array of the same length and order.`,
      response_json_schema: { type: 'object' },
      model: 'haiku',
      maxTokens: 900,
    });

    const results: any[] = result?.results || [];
    return reviews.map((r, i) => {
      const item = results[i];
      if (!item?.topics || !Array.isArray(item.topics)) return { topics: r.sentiment, topic_sentiment: '{}' };
      return {
        topics:          item.topics.join(','),
        topic_sentiment: JSON.stringify(item.sentiments || {}),
      };
    });
  } catch {
    return fallback;
  }
}

const SOURCE_QUERIES: Record<string, (name: string, city: string) => string> = {
  facebook:    (n, c) => `"${n}" ביקורות OR reviews site:facebook.com ${c}`,
  instagram:   (n, c) => `"${n}" comments OR תגובות site:instagram.com`,
  tripadvisor: (n, c) => `"${n}" site:tripadvisor.com OR site:tripadvisor.co.il`,
  waze:        (n, c) => `"${n}" site:waze.com ${c}`,
  tiktok:      (n, c) => `"${n}" site:tiktok.com`,
  wolt:        (n, c) => `"${n}" ביקורות site:wolt.com`,
  '10bis':     (n, c) => `"${n}" ביקורות site:10bis.co.il OR "${n}" ${c} 10bis`,
  easy:        (n, c) => `"${n}" ביקורות OR חוות דעת site:easy.co.il`,
  booking:     (n, c) => `"${n}" reviews site:booking.com OR site:booking.co.il`,
  forums:      (n, c) => `"${n}" חוות דעת OR ביקורות OR המלצה site:tapuz.co.il OR site:zap.co.il OR "${n}" פורום ${c}`,
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
    return res.json({ new_reviews: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, city } = profile;
    let newReviews = 0;
    let googleAdded = 0;

    const existingReviews = await prisma.review.findMany({ where: { linked_business: businessProfileId } });
    const existingGoogleIds = new Set(existingReviews.map(r => r.google_review_id).filter(Boolean));
    const existingTexts = new Set(existingReviews.map(r => (r.text || '').substring(0, 50)));

    // ── Google My Business API (OAuth) — preferred when client has connected ────
    const gmbAccount = await prisma.socialAccount.findFirst({
      where: { linked_business: businessProfileId, platform: 'google_business', is_connected: true },
    });
    const gmbLocationPath = gmbAccount?.page_id;
    const gmbToken = gmbAccount?.access_token || (profile as any).google_access_token;

    if (gmbToken && gmbLocationPath && gmbLocationPath.includes('/')) {
      try {
        const gmbRes = await fetch(
          `https://mybusiness.googleapis.com/v4/${gmbLocationPath}/reviews?pageSize=50`,
          { headers: { Authorization: `Bearer ${gmbToken}` } },
        );
        if (gmbRes.ok) {
          const gmbData: any = await gmbRes.json();
          // Collect all new reviews first, then batch-extract topics
          const gmbPending: Array<{ gr: any; reviewId: string; text: string; textKey: string; rating: number; sentiment: string; reviewerName: string }> = [];
          for (const gr of (gmbData.reviews || [])) {
            const reviewId = gr.name;
            if (existingGoogleIds.has(reviewId)) continue;
            const text = gr.comment || '';
            const textKey = text.substring(0, 50);
            if (existingTexts.has(textKey) || text.length < 5) continue;
            const rating = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }[gr.starRating as string] ?? 0;
            const sentiment = rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';
            const reviewerName = gr.reviewer?.displayName || 'לקוח';
            gmbPending.push({ gr, reviewId, text, textKey, rating, sentiment, reviewerName });
          }
          const gmbTopics = await batchExtractTopics(gmbPending.map(p => ({ text: p.text, sentiment: p.sentiment })));
          for (let i = 0; i < gmbPending.length; i++) {
            const { gr, reviewId, text, textKey, rating, sentiment, reviewerName } = gmbPending[i];
            const { topics, topic_sentiment } = gmbTopics[i];
            await prisma.review.create({
              data: {
                platform: 'Google',
                rating,
                text: text.substring(0, 500),
                reviewer_name: reviewerName,
                sentiment,
                response_status: gr.reviewReply ? 'published' : 'pending',
                source_url: `https://www.google.com/maps/search/?q=${encodeURIComponent(name)}`,
                source_origin: 'google_business_api',
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

    // ── Google Places API — fallback when no OAuth token ─────────────────────
    if (googleAdded === 0) {
      const placeId = profile.google_place_id || await findPlaceId(name, city);
      if (placeId) {
        if (!profile.google_place_id) {
          await prisma.businessProfile.update({ where: { id: businessProfileId }, data: { google_place_id: placeId, google_place_id_verified: true } });
        }
        const googleReviews = await getPlaceReviews(placeId);
        const placesPending: Array<{ gr: any; googleId: string; textKey: string; sentiment: string }> = [];
        for (const gr of googleReviews) {
          const googleId = `places_${gr.author_name}_${gr.time}`;
          if (existingGoogleIds.has(googleId)) continue;
          const textKey = (gr.text || '').substring(0, 50);
          if (existingTexts.has(textKey) || !gr.text || gr.text.length < 5) continue;
          const sentiment = gr.rating >= 4 ? 'positive' : gr.rating <= 2 ? 'negative' : 'neutral';
          placesPending.push({ gr, googleId, textKey, sentiment });
        }
        const placesTopics = await batchExtractTopics(placesPending.map(p => ({ text: p.gr.text, sentiment: p.sentiment })));
        for (let i = 0; i < placesPending.length; i++) {
          const { gr, googleId, textKey, sentiment } = placesPending[i];
          const { topics, topic_sentiment } = placesTopics[i];
          await prisma.review.create({
            data: {
              platform: 'Google',
              rating: gr.rating,
              text: gr.text.substring(0, 500),
              reviewer_name: gr.author_name || 'לקוח',
              sentiment,
              response_status: 'pending',
              source_url: `https://www.google.com/maps/place/?q=place_id:${placeId}`,
              source_origin: 'google_places',
              google_review_id: googleId,
              is_verified: true,
              created_at: new Date(gr.time * 1000).toISOString(),
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
      const tavilyResults = await tavilySearch(`"${name}" ביקורות ${city}`, 8);
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
          sentiment: (p.parsed.rating || 0) >= 4 ? 'positive' : (p.parsed.rating || 0) <= 2 ? 'negative' : 'neutral',
        })));
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
                text: parsed.text.substring(0, 500),
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
    const sourcesToScan = requestedSources.filter(s => s !== 'google' && SOURCE_QUERIES[s]);
    let sourcesScanCount = 0;
    for (const source of sourcesToScan) {
      const query = SOURCE_QUERIES[source](name, city);
      const platformLabel = SOURCE_PLATFORM_LABELS[source] || source;
      const tavilyHits = await tavilySearch(query, 6);
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
        sentiment: (p.rating || 0) >= 4 ? 'positive' : (p.rating || 0) <= 2 ? 'negative' : 'neutral',
      })));
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
              text: p.text.substring(0, 500),
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

    // ── Tavily fallback from raw signals ─────────────────────────────────────
    const rawSignals = await prisma.rawSignal.findMany({
      where: { linked_business: businessProfileId, source_origin: 'tavily' },
      orderBy: { created_date: 'desc' },
      take: 200,
    });

    const reviewPlatforms = ['google.com/maps', 'facebook.com', 'tripadvisor', 'yelp.com', 'wolt.com', '10bis.co.il'];
    const nameParts = name.split(' ').filter((p: string) => p.length > 2);
    const existingUrls = new Set(existingReviews.map(r => r.source_url).filter(Boolean));

    const reviewSignals = rawSignals.filter(s => {
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
        .map((s, i) => `[${i}] מ-${s.url}: "${(s.content || '').substring(0, 250)}"`)
        .join('\n');
      let signalsParsed: any[] = [];
      try {
        const batchResult = await invokeLLM({
          prompt: `For each snippet, determine whether it is a review of "${name}". Extract: text, rating (1-5 or 0), reviewer_name, platform, is_review.\n${signalsStr}\nReturn ONLY valid JSON. ALL string values must be in Hebrew. {"results":[...]}, same length and same order.`,
          response_json_schema: { type: 'object' },
          model: 'haiku',
          maxTokens: 1000,
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
        sentiment: (p.parsed.rating || 0) >= 4 ? 'positive' : (p.parsed.rating || 0) <= 2 ? 'negative' : 'neutral',
      })));
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
              text: parsed.text.substring(0, 500),
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

    // ── Competitor mention detection in new reviews ──────────────────────────
    if (newReviews > 0) {
      try {
        const knownCompetitors = await prisma.competitor.findMany({
          where: { linked_business: businessProfileId },
          select: { id: true, name: true },
          take: 10,
        });
        if (knownCompetitors.length > 0) {
          const freshReviews = await prisma.review.findMany({
            where: { linked_business: businessProfileId, created_date: { gte: new Date(startTime) } },
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
        }
      } catch (_) {}
    }

    setLastRun(businessProfileId, 'collectReviews');
    await writeAutomationLog('collectReviews', businessProfileId, startTime, newReviews);
    console.log(`collectReviews done: ${newReviews} new reviews (${googleAdded} from Google, ${sourcesScanCount} from other sources)`);

    // ── Snapshot current avg rating → rating_history for trend graph ─────────
    try {
      const allRatings = await prisma.review.findMany({
        where: { linked_business: businessProfileId },
        select: { rating: true },
      });
      if (allRatings.length > 0) {
        const avgRating = allRatings.reduce((s, r) => s + (r.rating || 0), 0) / allRatings.length;
        await prisma.$executeRawUnsafe(
          `INSERT INTO rating_history (business_id, avg_rating, review_count, new_reviews, source) VALUES ($1, $2, $3, $4, $5)`,
          businessProfileId, avgRating.toFixed(2), allRatings.length, newReviews, 'collectReviews'
        );
      }
    } catch (_) {}

    // ── Real-time alert: create ProactiveAlert for new negative reviews ───────
    if (newReviews > 0) {
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
    // Publish to event bus (OTX-001)
    if (newReviews > 0) {
      publishEvent({
        businessId: businessProfileId,
        eventType:  'new_review',
        source:     'collectReviews',
        payload:    { new_reviews: newReviews, google_added: googleAdded },
        contextAttrs: { impact: googleAdded > 0 ? 'medium' : 'low' },
      }).catch(() => {});
    }
    return res.json({ new_reviews: newReviews, google_reviews_added: googleAdded, sources_scanned: sourcesToScan.length + (googleAdded > 0 ? 1 : 0) });
  } catch (err: any) {
    console.error('collectReviews error:', err.message);
    await writeAutomationLog('collectReviews', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
