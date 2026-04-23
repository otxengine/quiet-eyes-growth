import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import { findPlaceId, getPlaceDetails } from '../_shared/googlePlaces.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  let profile: any;

  if (body.businessProfileId) {
    const profiles = await base44.asServiceRole.entities.BusinessProfile.filter({ id: body.businessProfileId });
    profile = profiles[0];
  }
  if (!profile) {
    try {
      const user = await base44.auth.me();
      if (user) {
        const profiles = await base44.entities.BusinessProfile.filter({ created_by: user.email });
        profile = profiles[0];
      }
    } catch (_) {}
  }
  if (!profile) {
    const allProfiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = allProfiles[0];
  }
  if (!profile) {
    return Response.json({ error: 'No business profile found', new_reviews: 0 }, { status: 404 });
  }

  const { name, city } = profile;
  let newReviews = 0;
  let duplicatesSkipped = 0;
  let googleReviewsAdded = 0;
  let tavilyReviewsAdded = 0;

  // Pre-fetch existing reviews for dedup
  const existingReviews = await base44.asServiceRole.entities.Review.filter({ linked_business: profile.id });
  const existingUrls = new Set(existingReviews.map((e: any) => e.source_url).filter(Boolean));
  const existingGoogleIds = new Set(existingReviews.map((e: any) => e.google_review_id).filter(Boolean));
  const existingTexts = new Set(existingReviews.map((e: any) => (e.text || '').substring(0, 50)));

  // ===== PRIMARY SOURCE: Google Places API =====
  const placeId = profile.google_place_id || await findPlaceId(name, city);

  if (placeId) {
    // Cache place_id on profile if not set
    if (!profile.google_place_id) {
      try {
        await base44.asServiceRole.entities.BusinessProfile.update(profile.id, {
          google_place_id: placeId,
          google_place_id_verified: true,
        });
      } catch (_) {}
    }

    const details = await getPlaceDetails(placeId);
    if (details) {
      // Update google_rating and review_count on profile
      try {
        await base44.asServiceRole.entities.BusinessProfile.update(profile.id, {
          google_rating: details.rating,
          google_review_count: details.reviewCount,
        });
      } catch (_) {}

      const googleReviews = details.reviews || [];
      console.log(`collectReviews: ${googleReviews.length} ביקורות Google Places`);

      for (const gr of googleReviews) {
        // Dedup by Google review fingerprint (author + time)
        const googleId = `${gr.author_name}_${gr.time}`;
        if (existingGoogleIds.has(googleId)) { duplicatesSkipped++; continue; }

        const textKey = (gr.text || '').substring(0, 50);
        if (existingTexts.has(textKey)) { duplicatesSkipped++; continue; }
        if (!gr.text || gr.text.length < 5) continue;

        let sentiment = 'neutral';
        if (gr.rating >= 4) sentiment = 'positive';
        else if (gr.rating <= 2) sentiment = 'negative';

        const sourceUrl = `https://www.google.com/maps/place/?q=place_id:${placeId}`;

        await base44.asServiceRole.entities.Review.create({
          platform: 'Google',
          rating: gr.rating,
          text: gr.text.substring(0, 500),
          reviewer_name: gr.author_name || 'לקוח',
          sentiment,
          response_status: 'pending',
          source_url: sourceUrl,
          source_origin: 'google_places',
          google_review_id: googleId,
          is_verified: true,
          created_at: new Date(gr.time * 1000).toISOString(),
          linked_business: profile.id,
        });

        existingGoogleIds.add(googleId);
        existingTexts.add(textKey);
        newReviews++;
        googleReviewsAdded++;
      }
    }
  } else {
    console.log(`collectReviews: Google Places לא זמין — עובר ל-Tavily fallback`);
  }

  // ===== FALLBACK SOURCE: Tavily RawSignals =====
  const rawSignals = await base44.asServiceRole.entities.RawSignal.filter(
    { linked_business: profile.id }, '-detected_at', 200
  );

  const reviewPlatformPatterns = [
    'google.com/maps', 'maps.google', 'facebook.com', 'instagram.com',
    'wolt.com', '10bis.co.il', 'rest.co.il', 'zap.co.il', 'tripadvisor',
    'yelp.com', 'yad2.co.il', 'bizportal', 'mako.co.il', 'ynet.co.il'
  ];

  const businessNameParts = name.split(' ').filter((p: string) => p.length > 2);

  const reviewSignals = rawSignals.filter((s: any) => {
    const url = (s.url || '').toLowerCase();
    const content = s.content || '';
    const isReviewPlatform = reviewPlatformPatterns.some(p => url.includes(p));
    const mentionsBusiness = businessNameParts.some((part: string) => content.includes(part));
    const hasRealUrl = s.url && s.url.startsWith('http') && s.source_origin !== 'llm';
    return isReviewPlatform && mentionsBusiness && hasRealUrl;
  });

  console.log(`collectReviews: ${reviewSignals.length} Tavily signals למשוב`);

  for (const signal of reviewSignals) {
    if (existingUrls.has(signal.url)) { duplicatesSkipped++; continue; }

    let parsed: any;
    try {
      parsed = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `הטקסט הזה נאסף מהדף: ${signal.url}
תוכן: "${signal.content}"

האם זה מכיל ביקורת לקוח על העסק "${name}"?
אם כן, חלץ מהטקסט הזה בלבד:
- text: ציטוט מדויק של תוכן הביקורת מהטקסט (לא המצאה)
- rating: דירוג כוכבים אם מוזכר (1-5), 0 אם לא מוזכר
- reviewer_name: שם הכותב אם מוזכר בטקסט
- platform: שם הפלטפורמה לפי ה-URL

אם זה לא ביקורת על "${name}" — החזר { "is_review": false }`,
        response_json_schema: {
          type: 'object',
          properties: {
            is_review: { type: 'boolean' },
            text: { type: 'string' },
            rating: { type: 'number' },
            reviewer_name: { type: 'string' },
            platform: { type: 'string' },
          }
        }
      });
    } catch (err) {
      console.error('LLM parse error:', err.message);
      continue;
    }

    if (!parsed?.is_review || !parsed.text || parsed.text.length < 10) continue;

    const textKey = parsed.text.substring(0, 50);
    if (existingTexts.has(textKey)) { duplicatesSkipped++; continue; }

    let sentiment = 'neutral';
    if (parsed.rating >= 4) sentiment = 'positive';
    else if (parsed.rating <= 2) sentiment = 'negative';
    else {
      try {
        const sr = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `Analyze the sentiment of this review: "${parsed.text}"\nReturn ONLY one word: positive, negative, or neutral`
        });
        const s = (sr || '').trim().toLowerCase().replace(/[^a-z]/g, '');
        if (['positive', 'negative', 'neutral'].includes(s)) sentiment = s;
      } catch (_) {}
    }

    await base44.asServiceRole.entities.Review.create({
      platform: parsed.platform || signal.platform || 'אתר חיצוני',
      rating: parsed.rating || 0,
      text: parsed.text.substring(0, 500),
      reviewer_name: parsed.reviewer_name || 'לקוח',
      sentiment,
      response_status: 'pending',
      source_url: signal.url,
      source_origin: 'tavily',
      is_verified: false,
      created_at: new Date().toISOString(),
      linked_business: profile.id,
    });

    existingUrls.add(signal.url);
    existingTexts.add(textKey);
    newReviews++;
    tavilyReviewsAdded++;
  }

  console.log(`collectReviews: ${newReviews} חדשות (${googleReviewsAdded} Google, ${tavilyReviewsAdded} Tavily), ${duplicatesSkipped} כפולים`);
  return Response.json({
    new_reviews: newReviews,
    google_reviews_added: googleReviewsAdded,
    tavily_reviews_added: tavilyReviewsAdded,
    duplicates_skipped: duplicatesSkipped,
    signals_checked: reviewSignals.length,
  });
});
