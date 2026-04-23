import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { businessProfileId } = await req.json();
  if (!businessProfileId) return Response.json({ error: 'Missing businessProfileId' }, { status: 400 });

  const bp = await base44.asServiceRole.entities.BusinessProfile.get(businessProfileId);
  if (!bp) return Response.json({ error: 'Business profile not found' }, { status: 404 });

  console.log(`[autoConfigOsint] Starting for "${bp.name}" (${bp.category}, ${bp.city})`);

  // Build context about the business
  const businessContext = [
    `שם העסק: ${bp.name}`,
    `קטגוריה: ${bp.category}`,
    `עיר: ${bp.city}`,
    bp.full_address ? `כתובת מלאה: ${bp.full_address}` : null,
    bp.target_market ? `שוק יעד: ${bp.target_market}` : null,
    bp.relevant_services ? `שירותים: ${bp.relevant_services}` : null,
    bp.website_url ? `אתר: ${bp.website_url}` : null,
    bp.facebook_url ? `פייסבוק: ${bp.facebook_url}` : null,
    bp.instagram_url ? `אינסטגרם: ${bp.instagram_url}` : null,
    bp.tiktok_url ? `טיקטוק: ${bp.tiktok_url}` : null,
  ].filter(Boolean).join('\n');

  const prompt = `אתה מומחה OSINT עסקי בישראל. בהתבסס על פרטי העסק הבא:

${businessContext}

בצע את המשימות הבאות:

1. **מילות מפתח (keywords)**: הצע 15-25 מילות מפתח וביטויי חיפוש רלוונטיים בעברית שמתאימים לתחום העסק, כולל:
   - שמות שירותים ספציפיים
   - ביטויים שלקוחות פוטנציאליים מחפשים
   - ביטויים גיאוגרפיים (עם שם העיר והאזור)
   - וריאציות נפוצות וכינויים
   - ביטויים של כוונת קנייה

2. **כתובות URL למעקב (urls)**: הצע 5-15 כתובות אתרים ספציפיות וממשיות לניטור, כולל:
   - פורומים ישראליים רלוונטיים לתחום (כמו FXP, תפוז פורומים)
   - אתרי ביקורות רלוונטיים (Google Maps, Facebook, Yelp ישראל)
   - אתרי חדשות/בלוגים מקצועיים בתחום
   - קבוצות או עמודי פייסבוק פופולריים בתחום
   - אתרי השוואת מחירים אם רלוונטי
   - דפי "מובילי השוק" או מדריכים בתחום

3. **מתחרים (competitors)**: זהה 3-8 מתחרים אמיתיים וספציפיים באותה עיר ותחום. עבור כל מתחרה ציין:
   - שם העסק
   - קטגוריה
   - כתובת משוערת (אם ידוע)
   - שירותים עיקריים

חשוב: תן רק תוצאות אמיתיות ורלוונטיות. אל תמציא שמות עסקים.`;

  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt,
    add_context_from_internet: true,
    model: 'gemini_3_flash',
    response_json_schema: {
      type: "object",
      properties: {
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "רשימת מילות מפתח וביטויי חיפוש"
        },
        urls: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string" },
              label: { type: "string", description: "תיאור קצר של המקור" },
              type: { type: "string", enum: ["forum", "review_site", "news", "social", "comparison", "guide", "other"] }
            }
          },
          description: "רשימת URLs לניטור"
        },
        competitors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              category: { type: "string" },
              address: { type: "string" },
              services: { type: "string" }
            }
          },
          description: "רשימת מתחרים"
        }
      }
    }
  });

  console.log(`[autoConfigOsint] AI returned: ${result.keywords?.length || 0} keywords, ${result.urls?.length || 0} urls, ${result.competitors?.length || 0} competitors`);

  // Save keywords and URLs to BusinessProfile
  const keywordsStr = (result.keywords || []).join(', ');
  const urlsStr = (result.urls || []).map(u => u.url).join('\n');

  await base44.asServiceRole.entities.BusinessProfile.update(businessProfileId, {
    custom_keywords: keywordsStr,
    custom_urls: urlsStr,
  });

  // Create competitors
  const competitorsCreated = [];
  for (const comp of (result.competitors || [])) {
    if (!comp.name) continue;
    const existing = await base44.asServiceRole.entities.Competitor.filter({ linked_business: businessProfileId, name: comp.name });
    if (existing.length > 0) continue;

    const created = await base44.asServiceRole.entities.Competitor.create({
      name: comp.name,
      category: comp.category || bp.category,
      address: comp.address || '',
      services: comp.services || '',
      linked_business: businessProfileId,
    });
    competitorsCreated.push(created);
  }

  console.log(`[autoConfigOsint] Saved ${competitorsCreated.length} new competitors`);

  return Response.json({
    keywords: result.keywords || [],
    urls: result.urls || [],
    competitors_created: competitorsCreated.length,
    keywords_count: (result.keywords || []).length,
    urls_count: (result.urls || []).length,
  });
});