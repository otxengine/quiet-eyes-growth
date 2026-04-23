import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const TAVILY_API_KEY = Deno.env.get('TAVILY_API_KEY') || '';

const INTENT_KEYWORDS_HE = [
  'מחפש', 'מחפשת', 'מישהו יודע', 'מי מכיר', 'ממליצים',
  'צריך', 'צריכה', 'רוצה לקבל', 'איפה אפשר', 'כמה עולה',
  'מחיר', 'הצעת מחיר', 'מקצוען', 'מקצועי', 'אחד טוב',
  'אחת טובה', 'בדחיפות', 'עד מחר', 'השבוע', 'מי עושה',
];
const INTENT_KEYWORDS_EN = [
  'looking for', 'anyone know', 'recommendations', 'need', 'want',
  'price', 'quote', 'urgent', 'asap', 'who does', 'best place',
];
const ALL_INTENT = [...INTENT_KEYWORDS_HE, ...INTENT_KEYWORDS_EN];

function hasIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return ALL_INTENT.some(kw => lower.includes(kw));
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const startTime = new Date().toISOString();

  let profile: any;
  if (body.businessProfileId) {
    const all = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = all.find((p: any) => p.id === body.businessProfileId);
  }
  if (!profile) {
    const all = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = all[0];
  }
  if (!profile) return Response.json({ error: 'No profile' }, { status: 404 });

  const { name, category, city, relevant_services } = profile;

  const existingLeads = await base44.asServiceRole.entities.Lead.filter({ linked_business: profile.id });
  const existingSourceUrls = new Set(existingLeads.map((l: any) => l.source_url).filter(Boolean));

  const serviceList = (relevant_services || category).split(',').map((s: string) => s.trim()).slice(0, 3);

  const searchQueries: string[] = [
    `${category} ${city} מחפש ממליצים קבוצה פייסבוק site:facebook.com`,
    `${category} ${city} מחפשים המלצה site:facebook.com`,
    `${category} ${city} מחפש ממליצים site:facebook.com OR site:instagram.com`,
    `${category} ישראל ${city} מחפש פורום`,
    ...serviceList.map((s: string) => `${s} ${city} מחפש ממליצים`),
    `${category} ${city} מחפש קבוצות`,
    `${category} ${city} מאכזב לא מרוצה מחפש אחר`,
  ];

  let leadsFound = 0;
  let socialLeadsCreated = 0;

  for (const query of searchQueries) {
    if (!TAVILY_API_KEY) break;
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: TAVILY_API_KEY,
          query,
          search_depth: 'advanced',
          max_results: 5,
          include_answer: false,
        }),
      });

      if (!res.ok) continue;
      const data = await res.json();
      const results = data.results || [];

      for (const result of results) {
        if (!result.url || !result.content) continue;
        if (existingSourceUrls.has(result.url)) continue;

        const content = result.content || '';
        if (!hasIntent(content)) continue;
        if (content.length < 20) continue;

        leadsFound++;

        const extraction = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `הטקסט הזה נמצא ב: ${result.url}
תוכן: "${content.substring(0, 400)}"

האם זה מראה כוונת קנייה עבור שירותי "${category}" ב${city} או בסביבה?

אם כן — חלץ רק מה שמפורש (אל תמציא):
{
  "has_intent": true,
  "service_needed": "מה הם מחפשים בעברית",
  "urgency": "היום|השבוע|החודש|מתעניין",
  "budget_mentioned": "הטקסט המדויק אם הוזכר, אחרת ריק",
  "person_name": "שם פרטי בלבד אם הוזכר, אחרת ריק",
  "platform": "facebook|instagram|forum|other"
}

אם אין כוונת קנייה — החזר: { "has_intent": false }`,
          model: 'gemini_3_flash',
          response_json_schema: {
            type: 'object',
            properties: {
              has_intent: { type: 'boolean' },
              service_needed: { type: 'string' },
              urgency: { type: 'string' },
              budget_mentioned: { type: 'string' },
              person_name: { type: 'string' },
              platform: { type: 'string' },
            }
          }
        });

        if (!extraction?.has_intent) continue;

        const responseMsg = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `כתוב הודעת WhatsApp קצרה בעברית מ"${name}" (${category} ב${city}) למישהו שפרסם:
"${content.substring(0, 150)}"

ההודעה צריכה:
- להיות 2-3 שורות מקסימום
- להישמע טבעי ומועיל, לא מכירתי
- להזכיר את השירות הספציפי: ${extraction.service_needed || category}
- להזמין ליצור קשר
- טון: ${profile.tone_preference || 'ידידותי'}

החזר את טקסט ההודעה בלבד.`,
        });

        await base44.asServiceRole.entities.Lead.create({
          name: extraction.person_name || `ליד מ${extraction.platform || 'סושיאל'}`,
          source: extraction.platform || 'social',
          source_url: result.url,
          source_origin: 'tavily',
          service_needed: extraction.service_needed || category,
          budget_range: extraction.budget_mentioned || '',
          urgency: extraction.urgency || 'מתעניין',
          contact_info: '',
          contact_phone: '',
          intent_strength: 'high',
          intent_source: content.substring(0, 100),
          discovery_method: 'social_search',
          source_agent: 'הצייד',
          city,
          score: 65,
          status: 'warm',
          lifecycle_stage: 'new',
          notes: `נמצא בחיפוש סושיאל. תגובה מוכנה.`,
          suggested_first_message: responseMsg || '',
          linked_business: profile.id,
          created_at: new Date().toISOString(),
          discovered_at: new Date().toISOString(),
          freshness_score: 100,
        });

        existingSourceUrls.add(result.url);
        socialLeadsCreated++;

        await base44.asServiceRole.entities.ProactiveAlert.create({
          linked_business: profile.id,
          alert_type: 'opportunity',
          title: `ליד סושיאל: ${extraction.service_needed || category} — ${extraction.platform || 'social'}`,
          description: `מישהו מחפש ${extraction.service_needed || category} ב${city}. תגובה מוכנה לשליחה.`,
          suggested_action: responseMsg || `צור קשר לגבי ${extraction.service_needed || category}`,
          action_url: '/leads',
          priority: extraction.urgency === 'היום' || extraction.urgency === 'השבוע' ? 'critical' : 'high',
          source_agent: 'הצייד',
          is_dismissed: false,
          is_acted_on: false,
          created_at: new Date().toISOString(),
        });
      }
    } catch (err: any) {
      console.error(`[findSocialLeads] Query failed "${query}":`, err.message);
    }
  }

  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'findSocialLeads',
      start_time: startTime,
      end_time: new Date().toISOString(),
      status: 'success',
      items_processed: socialLeadsCreated,
      linked_business: profile.id,
    });
  } catch (_) {}

  console.log(`[findSocialLeads] Done: ${leadsFound} intent posts found, ${socialLeadsCreated} leads created`);
  return Response.json({
    intent_posts_found: leadsFound,
    social_leads_created: socialLeadsCreated,
  });
});
