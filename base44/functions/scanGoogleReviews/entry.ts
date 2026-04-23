import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  let profile;

  if (body.businessProfileId) {
    const all = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = all.find(p => p.id === body.businessProfileId);
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
    return Response.json({ error: 'No business profile found', reviews_found: 0 }, { status: 404 });
  }

  const { name, category, city } = profile;

  // Search for Google Maps reviews
  const queries = [
    `"${name}" ${city} ביקורות google maps`,
    `"${name}" google maps reviews ${city}`,
    `"${name}" ${city} חוות דעת גוגל`,
  ];

  let reviewsFound = 0;
  let newSaved = 0;
  let duplicates = 0;

  for (const query of queries) {
    try {
      const searchResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `חפש באינטרנט: "${query}"

מצא ביקורות אמיתיות מ-Google Maps / Google Reviews עבור העסק "${name}" ב${city} בלבד.

כללים קריטיים:
1. החזר רק ביקורות שמתייחסות ישירות לעסק "${name}" — לא ביקורות על עסקים אחרים
2. רק ביקורות מ-Google Maps / Google Reviews
3. כתובת ה-URL חייבה להוביל לדף Google Maps של העסק
4. עדיף 0 ביקורות מאשר ביקורת אחת לא רלוונטית

עבור כל ביקורת:
- reviewer_name: שם המבקר
- rating: דירוג כוכבים (1-5)
- text: תוכן הביקורת (ציטוט מדויק)
- approximate_date: תאריך הביקורת אם ידוע
- url: קישור ל-Google Maps אם זמין

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
                  approximate_date: { type: "string" },
                  url: { type: "string" }
                }
              }
            }
          }
        }
      });

      const reviews = searchResult?.reviews || [];
      reviewsFound += reviews.length;

      for (const review of reviews) {
        if (!review.text || review.text.length < 10) continue;

        // Check for duplicates
        const existing = await base44.asServiceRole.entities.Review.filter({ linked_business: profile.id });
        const isDuplicate = existing.some(e => {
          const existText = (e.text || '').substring(0, 50);
          const newText = (review.text || '').substring(0, 50);
          return existText === newText || (e.reviewer_name === review.reviewer_name && e.platform === 'Google Maps');
        });
        if (isDuplicate) { duplicates++; continue; }

        // Analyze sentiment
        const sentimentResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `Analyze the sentiment of this Hebrew review: "${review.text}"\nReturn ONLY one word: positive, negative, or neutral`
        });
        const sentimentRaw = sentimentResult.trim().toLowerCase().replace(/[^a-z]/g, '');
        const sentiment = ['positive', 'negative', 'neutral'].includes(sentimentRaw) ? sentimentRaw : 'neutral';

        const newReview = {
          platform: 'Google Maps',
          rating: review.rating || 0,
          text: review.text.substring(0, 500),
          reviewer_name: review.reviewer_name || 'לקוח',
          sentiment,
          response_status: 'pending',
          source_url: review.url || '',
          created_at: review.approximate_date || new Date().toISOString(),
          linked_business: profile.id,
        };

        await base44.asServiceRole.entities.Review.create(newReview);
        newSaved++;

        // Trigger WhatsApp alert for negative reviews (1-2 stars)
        if (review.rating && review.rating <= 2 && profile.wa_alert_negative_review !== false && profile.wa_alert_phone) {
          try {
            await base44.asServiceRole.functions.invoke('sendWhatsAppAlert', {
              alert_type: 'negative_review',
              data: newReview,
              linked_business: profile.id,
            });
          } catch (err) {
            console.error('WhatsApp alert error:', err.message);
          }
        }
      }
    } catch (err) {
      console.error(`Google review query error "${query}":`, err.message);
    }
  }

  console.log(`scanGoogleReviews complete: ${reviewsFound} found, ${newSaved} new, ${duplicates} dupes`);
  return Response.json({ reviews_found: reviewsFound, new_reviews_saved: newSaved, duplicates });
});