import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { invokeLLM } from '../../lib/llm';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';
const CURRENT_YEAR = new Date().getFullYear();

async function tavilySearch(query: string, maxResults = 5): Promise<any[]> {
  if (!TAVILY_API_KEY) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query, search_depth: 'advanced', max_results: maxResults }),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    return data.results || [];
  } catch { return []; }
}

async function googlePlacesSearch(query: string, city: string): Promise<any[]> {
  if (!GOOGLE_API_KEY) return [];
  try {
    const input = encodeURIComponent(`${query} ${city} ישראל`);
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${input}&language=iw&region=il&key=${GOOGLE_API_KEY}`);
    const data: any = await res.json();
    return data.results?.slice(0, 10) || [];
  } catch { return []; }
}

export async function runCompetitorIdentification(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city } = profile;
    const radiusKm: number = (profile as any).search_radius_km || 15;
    const userExtraCities: string[] = ((profile as any).additional_cities || '')
      .split(',').map((c: string) => c.trim()).filter(Boolean);

    // ── Step 1: Understand the business type + get nearby cities ──────────────
    const contextResult = await invokeLLM({
      model: 'haiku',
      maxTokens: 400,
      prompt: `עסק ישראלי: "${name}", קטגוריה: ${category}, עיר: ${city}

1. מה הסוג המדויק של העסק? (למשל: "בר סושי יפני", "פיצרייה", "ספר לגברים")
2. מה מילות החיפוש הכי טובות למצוא מתחרים ישירים באותו תחום? (3 ביטויים בעברית)
3. אילו ערים נמצאות ברדיוס של ${radiusKm} ק"מ מ-${city} בישראל? (עד 5 ערים)

החזר JSON: {
  "business_type": "...",
  "search_terms": ["...", "...", "..."],
  "nearby_cities": ["...", "..."]
}`,
      response_json_schema: { type: 'object' },
    });

    const businessType: string = contextResult?.business_type || category;
    const searchTerms: string[] = contextResult?.search_terms || [name, category];
    const nearbyCities: string[] = contextResult?.nearby_cities || [];

    // Combine: city + LLM-suggested nearby cities + user's additional cities, deduplicated
    const allAreas = [...new Set([city, ...nearbyCities, ...userExtraCities])];

    console.log(`runCompetitorIdentification: type="${businessType}", areas=${JSON.stringify(allAreas)}, terms=${JSON.stringify(searchTerms)}`);

    // ── Step 2: Targeted searches — each term × each area ────────────────────
    const tavilyQueries: string[] = [];
    for (const area of allAreas) {
      for (const term of searchTerms) {
        tavilyQueries.push(`${term} ${area} ישראל ${CURRENT_YEAR}`);
      }
      // Restaurant directory searches for the area
      tavilyQueries.push(`site:rest.co.il ${searchTerms[0] || businessType} ${area}`);
    }

    const [googleResults, ...tavilyResultSets] = await Promise.all([
      googlePlacesSearch(searchTerms[0] || businessType, city),
      ...tavilyQueries.map(q => tavilySearch(q, 5)),
    ]);
    const tavilyResults = tavilyResultSets.flat();

    console.log(`runCompetitorIdentification: ${googleResults.length} Google, ${tavilyResults.length} Tavily results`);

    // ── Step 3: LLM identifies DIRECT competitors only ───────────────────────
    const existingCompetitors = await prisma.competitor.findMany({ where: { linked_business: businessProfileId } });
    const existingNames = new Set(existingCompetitors.map(c => c.name.toLowerCase()));

    const googleBlock = googleResults.length > 0
      ? `Google Places:\n${googleResults.map((p: any) =>
          `- ${p.name}: ${p.rating || '?'}★ (${p.user_ratings_total || 0} ביקורות) — ${p.formatted_address || city}`
        ).join('\n')}`
      : '';

    const tavilyBlock = tavilyResults.length > 0
      ? `תוצאות חיפוש:\n${tavilyResults.map((r: any) =>
          `- ${r.title}: ${(r.content || '').substring(0, 150)}`
        ).join('\n')}`
      : '';

    const contextBlock = [googleBlock, tavilyBlock].filter(Boolean).join('\n\n');
    const areasDesc = allAreas.join(', ');

    const llmPrompt = contextBlock
      ? `אתה מנתח תחרותי. זהה מתחרים ישירים לעסק "${name}" (${businessType}).

מתחרה ישיר = אותו סוג עסק בדיוק. דוגמה: לסושי בר — רק מסעדות סושי/יפניות, לא פיצריות.
אזורי סריקה: ${areasDesc} (${radiusKm} ק"מ מ-${city}).

${contextBlock}

מהרשימה, בחר רק עסקים שהם מתחרים ישירים ל-"${name}" (${businessType}).
אל תכלול את "${name}" עצמו.
אם אין מספיק נתונים מהחיפוש, השלם מהידע שלך על עסקים מסוג "${businessType}" באזורים: ${areasDesc}.

עבור כל מתחרה:
- name: שם העסק
- rating: דירוג (1-5 או null)
- review_count: מספר ביקורות או null
- address: כתובת כולל עיר
- strengths: חוזקות (עד 3, מופרדות בפסיק)
- weaknesses: חולשות (עד 3)
- price_range: טווח מחירים אם ידוע
- source_urls: ["url1", ...]

החזר JSON: {"competitors": [...]}`
      : `אתה מנתח תחרותי. רשום עד 6 מתחרים ישירים ל-"${name}" (${businessType}) באזורים: ${areasDesc}.
מתחרה ישיר = אותו סוג עסק בדיוק. השתמש בשמות אמיתיים ככל האפשר.

עבור כל מתחרה: name, rating, review_count, address (כולל עיר), strengths, weaknesses, price_range, source_urls.
החזר JSON: {"competitors": [...]}`;

    const result = await invokeLLM({
      model: 'sonnet',
      prompt: llmPrompt,
      response_json_schema: { type: 'object' },
      maxTokens: 2000,
    });

    console.log(`runCompetitorIdentification LLM: ${JSON.stringify(result).substring(0, 600)}`);
    const competitors: any[] = result?.competitors || [];
    let created = 0;
    let updated = 0;

    for (const c of competitors) {
      if (!c.name || c.name.toLowerCase() === name.toLowerCase()) continue;
      const nameKey = c.name.toLowerCase();
      const sourceUrls = (c.source_urls || []).filter((u: string) => u?.startsWith('http')).join(' | ');

      if (existingNames.has(nameKey)) {
        const existing = existingCompetitors.find(e => e.name.toLowerCase() === nameKey);
        if (existing) {
          await prisma.competitor.update({
            where: { id: existing.id },
            data: {
              rating: c.rating || existing.rating,
              review_count: c.review_count || existing.review_count,
              strengths: c.strengths || existing.strengths,
              weaknesses: c.weaknesses || existing.weaknesses,
              price_range: c.price_range || existing.price_range,
              source_urls: sourceUrls || existing.source_urls,
              last_scanned: new Date().toISOString(),
              data_freshness: 'fresh',
            },
          });
          updated++;
        }
      } else {
        await prisma.competitor.create({
          data: {
            name: c.name,
            category: businessType,
            rating: c.rating || null,
            review_count: c.review_count || null,
            address: c.address || city,
            strengths: c.strengths || '',
            weaknesses: c.weaknesses || '',
            price_range: c.price_range || '',
            source_urls: sourceUrls,
            last_scanned: new Date().toISOString(),
            data_freshness: 'fresh',
            verification_status: 'מאומתת',
            linked_business: businessProfileId,
          },
        });
        existingNames.add(nameKey);
        created++;
      }
    }

    // Remove competitors outside the current search scope (address doesn't match any area).
    const allCompetitors = await prisma.competitor.findMany({ where: { linked_business: businessProfileId } });
    const toDelete = allCompetitors.filter(comp => {
      const addr = (comp.address || '').toLowerCase();
      return !allAreas.some(area => addr.includes(area.toLowerCase()));
    });
    if (toDelete.length > 0) {
      await prisma.competitor.deleteMany({ where: { id: { in: toDelete.map(c => c.id) } } });
      console.log(`runCompetitorIdentification: removed ${toDelete.length} out-of-scope competitors`);
    }

    await writeAutomationLog('runCompetitorIdentification', businessProfileId, startTime, created + updated);
    console.log(`runCompetitorIdentification done: ${created} created, ${updated} updated, areas: ${areasDesc}`);
    return res.json({
      competitors_found: competitors.length,
      new_competitors_created: created,
      existing_competitors_updated: updated,
      out_of_scope_removed: toDelete.length,
      business_type: businessType,
      areas_scanned: allAreas,
    });
  } catch (err: any) {
    console.error('runCompetitorIdentification error:', err.message);
    await writeAutomationLog('runCompetitorIdentification', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
