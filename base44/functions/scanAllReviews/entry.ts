import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const PLATFORMS = [
  { name: 'Google Maps', queries: (n, c) => [`"${n}" ${c} ביקורות google`, `"${n}" חוות דעת`] },
  { name: 'Facebook', queries: (n, c) => [`"${n}" ${c} facebook ביקורות`, `"${n}" site:facebook.com`] },
  { name: 'Instagram', queries: (n, c) => [`"${n}" instagram ${c}`, `"${n}" ${c} instagram ביקורות`] },
  { name: 'Wolt', queries: (n, c) => [`"${n}" wolt ביקורות`, `"${n}" וולט חוות דעת`] },
  { name: 'Easy', queries: (n, c) => [`"${n}" easy ביקורות`, `"${n}" איזי חוות דעת`] },
  { name: '10bis', queries: (n, c) => [`"${n}" 10bis ביקורות`, `"${n}" תן ביס חוות דעת`] },
  { name: 'Rest', queries: (n, c) => [`"${n}" rest ביקורות`, `"${n}" site:rest.co.il`] },
  { name: 'Zap', queries: (n, c) => [`"${n}" zap ביקורות`, `"${n}" site:zap.co.il`] },
];

const BAD_URL_PATTERNS = ['login', 'sign_in', 'signin', 'signup', 'register', '/auth/', 'accounts.google', 'facebook.com/login'];

function isValidUrl(url) {
  if (!url || !url.startsWith('http')) return false;
  if (url.includes('google.com/search') || url.includes('bing.com/search')) return false;
  if (url.includes('vertexaisearch') || url.includes('grounding-api-redirect')) return false;
  return !BAD_URL_PATTERNS.some(p => url.includes(p));
}

Deno.serve(async (req) => {
  const startTime = new Date().toISOString();
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  let profile;

  if (body.businessProfileId) {
    const all = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = all.find(p => p.id === body.businessProfileId);
  }
  if (!profile) {
    const allProfiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = allProfiles[0];
  }
  if (!profile) {
    return Response.json({ error: 'No business profile', new_reviews: 0 }, { status: 404 });
  }

  const { name, category, city } = profile;

  // Pre-fetch existing reviews for dedup
  const existingReviews = await base44.asServiceRole.entities.Review.filter({ linked_business: profile.id });
  const existingTexts = new Set(existingReviews.map(e => (e.text || '').substring(0, 50)));
  const existingUrls = new Set(existingReviews.map(e => e.source_url).filter(Boolean));

  let totalNew = 0;
  let totalDupes = 0;
  let totalErrors = 0;
  const platformResults = {};

  for (const platform of PLATFORMS) {
    const queries = platform.queries(name, city);
    let platformNew = 0;

    for (const query of queries) {
      try {
        const searchResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `חפש באינטרנט: "${query}"

מצא ביקורות אמיתיות של לקוחות על העסק "${name}" ב${city} בפלטפורמה ${platform.name}.

כללים קריטיים:
1. החזר רק ביקורות שמתייחסות ישירות לעסק "${name}" — לא ביקורות על עסקים אחרים
2. הביקורת חייבת להזכיר את שם העסק או להיות מפורסמת בדף/פרופיל שלו
3. כתובת ה-URL חייבת להוביל ישירות לדף שבו הביקורת מופיעה
4. עדיף 0 ביקורות מאשר ביקורת אחת לא רלוונטית
5. אל תמציא ביקורות! רק ביקורות שבאמת מופיעות בתוצאות

עבור כל ביקורת:
- reviewer_name: שם המבקר (בעברית אם אפשר)
- rating: דירוג 1-5 (אם לא זמין, העריך מהסנטימנט)
- text: תוכן הביקורת המלא בעברית
- date: תאריך (YYYY-MM-DD אם נראה, אחרת "recent")
- source_url: כתובת URL ישירה לדף הביקורת

אם לא נמצאו ביקורות בפלטפורמה הזו, החזר מערך ריק.
החזר עד 5 ביקורות.`,
          model: 'gemini_3_flash',
          add_context_from_internet: true,
          response_json_schema: {
            type: "object",
            properties: {
              reviews: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    reviewer_name: { type: "string" },
                    rating: { type: "number" },
                    text: { type: "string" },
                    date: { type: "string" },
                    source_url: { type: "string" }
                  }
                }
              }
            }
          }
        });

        const reviews = searchResult?.reviews || [];

        for (const review of reviews) {
          if (!review.text || review.text.length < 10) continue;

          // Dedup check
          const textKey = (review.text || '').substring(0, 50);
          if (existingTexts.has(textKey)) { totalDupes++; continue; }
          if (review.source_url && existingUrls.has(review.source_url)) { totalDupes++; continue; }

          // Validate URL
          let sourceUrl = review.source_url || '';
          let isVerified = false;
          if (sourceUrl && isValidUrl(sourceUrl)) {
            try {
              const checkRes = await fetch(sourceUrl, {
                method: 'HEAD',
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Base44Bot/1.0)' },
                signal: AbortSignal.timeout(5000),
              });
              if (checkRes.ok) {
                isVerified = true;
              } else {
                sourceUrl = '';
              }
            } catch (_) {
              sourceUrl = '';
            }
          } else {
            sourceUrl = '';
          }

          // Sentiment analysis
          const sentimentResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: `Analyze the sentiment of this review: "${review.text}"\nReturn ONLY one word: positive, negative, or neutral`
          });
          const sentimentRaw = sentimentResult.trim().toLowerCase().replace(/[^a-z]/g, '');
          const sentiment = ['positive', 'negative', 'neutral'].includes(sentimentRaw) ? sentimentRaw : 'neutral';

          // Determine date
          let createdAt = new Date().toISOString();
          if (review.date && review.date !== 'recent') {
            try { createdAt = new Date(review.date).toISOString(); } catch (_) {}
          }

          const newReview = {
            platform: platform.name,
            rating: review.rating || 0,
            text: review.text.substring(0, 500),
            reviewer_name: review.reviewer_name || 'לקוח',
            sentiment,
            response_status: 'pending',
            source_url: sourceUrl,
            is_verified: isVerified,
            created_at: createdAt,
            linked_business: profile.id,
          };

          await base44.asServiceRole.entities.Review.create(newReview);
          existingTexts.add(textKey);
          if (sourceUrl) existingUrls.add(sourceUrl);
          platformNew++;
          totalNew++;

          // Alert for negative reviews
          if (review.rating && review.rating <= 2 && profile.wa_alert_negative_review !== false && profile.wa_alert_phone) {
            try {
              await base44.asServiceRole.functions.invoke('sendWhatsAppAlert', {
                alert_type: 'negative_review',
                data: newReview,
                linked_business: profile.id,
              });
            } catch (_) {}
          }
        }
      } catch (err) {
        console.error(`${platform.name} query error:`, err.message);
        totalErrors++;
      }
    }
    platformResults[platform.name] = platformNew;
  }

  // Log automation run
  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'scanAllReviews',
      start_time: startTime,
      end_time: new Date().toISOString(),
      status: totalErrors > PLATFORMS.length / 2 ? 'error' : 'success',
      items_processed: totalNew,
      error_message: totalErrors > 0 ? `${totalErrors} platform errors` : '',
      linked_business: profile.id,
    });
  } catch (_) {}

  console.log(`scanAllReviews: ${totalNew} new, ${totalDupes} dupes, ${totalErrors} errors`, platformResults);
  return Response.json({ new_reviews: totalNew, duplicates: totalDupes, errors: totalErrors, platforms: platformResults });
});