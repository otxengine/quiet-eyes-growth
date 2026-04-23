import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { invokeLLM } from '../../lib/llm';

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';

async function findPlaceId(name: string, city: string): Promise<string | null> {
  if (!GOOGLE_API_KEY) return null;
  try {
    const input = encodeURIComponent(`${name} ${city}`);
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${input}&inputtype=textquery&fields=place_id&key=${GOOGLE_API_KEY}`);
    const data: any = await res.json();
    return data.candidates?.[0]?.place_id || null;
  } catch { return null; }
}

async function getPlaceReviews(placeId: string): Promise<any[]> {
  if (!GOOGLE_API_KEY) return [];
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=rating,user_ratings_total,reviews&language=iw&key=${GOOGLE_API_KEY}`);
    const data: any = await res.json();
    return data.result?.reviews || [];
  } catch { return []; }
}

// ── P1: Sentiment Topic Extraction ───────────────────────────────────────────

async function extractTopics(
  text: string,
  overallSentiment: string
): Promise<{ topics: string; topic_sentiment: string }> {
  try {
    const result = await invokeLLM({
      prompt: `בדוק את הביקורת הבאה וחלץ עד 5 נושאים מרכזיים (כגון: שירות, מחיר, איכות, משלוח, ניקיון, זמינות).
לכל נושא ציין גם את הסנטימנט: positive / negative / neutral.
הביקורת: "${text.substring(0, 300)}"
החזר JSON בלבד: { "topics": ["נושא1","נושא2"], "sentiments": {"נושא1":"positive","נושא2":"negative"} }`,
      response_json_schema: { type: 'object' },
    });

    if (!result?.topics || !Array.isArray(result.topics)) {
      return { topics: overallSentiment, topic_sentiment: '{}' };
    }

    return {
      topics:          (result.topics as string[]).join(','),
      topic_sentiment: JSON.stringify(result.sentiments ?? {}),
    };
  } catch {
    return { topics: '', topic_sentiment: '{}' };
  }
}

export async function collectReviews(req: Request, res: Response) {
  const { businessProfileId } = req.body;
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

    // Google Places
    const placeId = profile.google_place_id || await findPlaceId(name, city);
    if (placeId) {
      if (!profile.google_place_id) {
        await prisma.businessProfile.update({ where: { id: businessProfileId }, data: { google_place_id: placeId, google_place_id_verified: true } });
      }
      const googleReviews = await getPlaceReviews(placeId);
      for (const gr of googleReviews) {
        const googleId = `${gr.author_name}_${gr.time}`;
        if (existingGoogleIds.has(googleId)) continue;
        const textKey = (gr.text || '').substring(0, 50);
        if (existingTexts.has(textKey) || !gr.text || gr.text.length < 5) continue;

        const sentiment = gr.rating >= 4 ? 'positive' : gr.rating <= 2 ? 'negative' : 'neutral';
        const { topics, topic_sentiment } = await extractTopics(gr.text, sentiment);
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

    // Tavily fallback from raw signals
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
    });

    for (const signal of reviewSignals.slice(0, 20)) {
      try {
        const parsed = await invokeLLM({
          prompt: `הטקסט הזה נאסף מ-${signal.url}:\n"${signal.content}"\n\nהאם זה ביקורת על "${name}"? חלץ: text (ציטוט מדויק), rating (1-5 או 0), reviewer_name, platform. אם לא ביקורת: {"is_review":false}`,
          response_json_schema: { type: 'object' },
        });
        if (!parsed?.is_review || !parsed.text || parsed.text.length < 10) continue;
        const textKey = parsed.text.substring(0, 50);
        if (existingTexts.has(textKey)) continue;

        const sentiment = parsed.rating >= 4 ? 'positive' : parsed.rating <= 2 ? 'negative' : 'neutral';
        const { topics, topic_sentiment } = await extractTopics(parsed.text, sentiment);
        await prisma.review.create({
          data: {
            platform: parsed.platform || 'אתר חיצוני',
            rating: parsed.rating || 0,
            text: parsed.text.substring(0, 500),
            reviewer_name: parsed.reviewer_name || 'לקוח',
            sentiment,
            response_status: 'pending',
            source_url: signal.url,
            source_origin: 'tavily',
            is_verified: false,
            created_at: new Date().toISOString(),
            linked_business: businessProfileId,
            topics,
            topic_sentiment,
          },
        });
        existingTexts.add(textKey);
        newReviews++;
      } catch { continue; }
    }

    await writeAutomationLog('collectReviews', businessProfileId, startTime, newReviews);
    console.log(`collectReviews done: ${newReviews} new reviews (${googleAdded} from Google)`);
    return res.json({ new_reviews: newReviews, google_reviews_added: googleAdded });
  } catch (err: any) {
    console.error('collectReviews error:', err.message);
    await writeAutomationLog('collectReviews', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
