import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { invokeLLM } from '../../lib/llm';
import { tavilySearch } from '../../lib/tavily';

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
      prompt: `חלץ נושאים מהביקורות הבאות. לכל ביקורת: עד 4 נושאים (שירות/מחיר/איכות/ניקיון/אווירה/זמינות/משלוח) וסנטימנט לכל נושא (positive/negative/neutral).
${itemsStr}
JSON בלבד: {"results":[{"topics":["נושא1"],"sentiments":{"נושא1":"positive"}},...]}, מערך באותו אורך ובאותו סדר.`,
      response_json_schema: { type: 'object' },
      model: 'haiku',
      maxTokens: 1200,
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
            prompt: `עבור כל קטע טקסט, האם יש ביקורת על "${name}"? חלץ: text (עד 300 תווים), rating (1-5 או 0), reviewer_name, platform, is_review (true/false).\n${itemsStr}\nJSON בלבד: {"results":[{...},...]}, מערך באותו אורך ובאותו סדר.`,
            response_json_schema: { type: 'object' },
            model: 'haiku',
            maxTokens: 1500,
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
          prompt: `עבור כל קטע טקסט, האם יש ביקורת על "${name}"? חלץ: text (עד 300 תווים), rating (1-5 או 0), reviewer_name, is_review (true/false).\n${itemsStr}\nJSON בלבד: {"results":[{...},...]}, מערך באותו אורך ובאותו סדר.`,
          response_json_schema: { type: 'object' },
          model: 'haiku',
          maxTokens: 1200,
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
          prompt: `עבור כל קטע, האם זו ביקורת על "${name}"? חלץ: text, rating (1-5 או 0), reviewer_name, platform, is_review.\n${signalsStr}\nJSON בלבד: {"results":[...]}, אותו אורך ואותו סדר.`,
          response_json_schema: { type: 'object' },
          model: 'haiku',
          maxTokens: 1500,
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

    await writeAutomationLog('collectReviews', businessProfileId, startTime, newReviews);
    console.log(`collectReviews done: ${newReviews} new reviews (${googleAdded} from Google, ${sourcesScanCount} from other sources)`);
    return res.json({ new_reviews: newReviews, google_reviews_added: googleAdded, sources_scanned: sourcesToScan.length + (googleAdded > 0 ? 1 : 0) });
  } catch (err: any) {
    console.error('collectReviews error:', err.message);
    await writeAutomationLog('collectReviews', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
