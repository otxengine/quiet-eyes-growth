import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { invokeLLM } from '../../lib/llm';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';

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

async function searchNearbyCompetitors(category: string, city: string): Promise<any[]> {
  if (!GOOGLE_API_KEY) return [];
  try {
    // Hebrew query works better for Israeli cities
    const heCity = city; // already in Hebrew from DB
    const input = encodeURIComponent(`${category} ${heCity} ישראל`);
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${input}&language=iw&region=il&key=${GOOGLE_API_KEY}`);
    const data: any = await res.json();
    return data.results?.slice(0, 10) || [];
  } catch { return []; }
}

/** Extract a cuisine/specialty keyword from the business name (e.g. "סושי" from "אומה סושי בר") */
function extractSpecialty(name: string): string {
  const keywords = ['סושי', 'פיצה', 'בורגר', 'שווארמה', 'פלאפל', 'גריל', 'סטייק', 'פסטה', 'מאפייה',
                    'קפה', 'בית קפה', 'גלידה', 'סלט', 'מקסיקני', 'יפני', 'איטלקי', 'צרפתי', 'הודי', 'ערבי',
                    'sushi', 'pizza', 'burger', 'steak', 'grill', 'cafe', 'bakery'];
  const lower = name.toLowerCase();
  return keywords.find(k => lower.includes(k.toLowerCase())) || '';
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
    const extraCities: string[] = ((profile as any).additional_cities || '')
      .split(',').map((c: string) => c.trim()).filter(Boolean);

    // All areas to scan: primary city + additional cities
    const searchAreas = [city, ...extraCities];
    const specialty = extractSpecialty(name); // e.g. "סושי" from "אומה סושי בר"

    // Build targeted queries per area — Hebrew-first for better Israeli results
    const tavilyQueries: string[] = [];
    for (const area of searchAreas) {
      tavilyQueries.push(`מסעדות ${area} ביקורות מומלצות`);
      tavilyQueries.push(`${area} מסעדות הכי טובות 2024`);
      if (specialty) tavilyQueries.push(`${specialty} ${area}`);
      tavilyQueries.push(`restaurants ${area} Israel best rated`);
    }

    // Search Google Places + all Tavily queries in parallel
    const [googleResults, ...tavilyResultSets] = await Promise.all([
      searchNearbyCompetitors(category, city),
      ...tavilyQueries.map(q => tavilySearch(q, 5)),
    ]);
    const tavilyResults = tavilyResultSets.flat();
    console.log(`runCompetitorIdentification: ${googleResults.length} Google, ${tavilyResults.length} Tavily results for areas: ${searchAreas.join(', ')}, specialty: "${specialty}"`);

    const existingCompetitors = await prisma.competitor.findMany({ where: { linked_business: businessProfileId } });
    const existingNames = new Set(existingCompetitors.map(c => c.name.toLowerCase()));

    const contextBlock = [
      googleResults.length > 0 ? `תוצאות Google Places:\n${googleResults.map((p: any) =>
        `- ${p.name}: דירוג ${p.rating || '?'} (${p.user_ratings_total || 0} ביקורות), ${p.formatted_address || city}`
      ).join('\n')}` : '',
      tavilyResults.length > 0 ? `תוצאות חיפוש:\n${tavilyResults.map((r: any) =>
        `- כותרת: ${r.title}\n  תוכן: ${(r.content || '').substring(0, 200)}\n  URL: ${r.url}`
      ).join('\n')}` : '',
    ].filter(Boolean).join('\n\n');

    const areasDesc = searchAreas.join(', ');
    const competitorFields = `- name: שם המתחרה
- rating: דירוג (1-5 או null)
- review_count: מספר ביקורות או null
- address: כתובת אם ידועה (כולל עיר)
- strengths: חוזקות (עד 3, מופרד בפסיקים)
- weaknesses: חולשות (עד 3)
- price_range: טווח מחירים אם ידוע
- source_urls: מערך URLים רלוונטיים

החזר JSON: {"competitors": [...]}`;

    const specialtyLine = specialty ? ` (התמחות: ${specialty})` : '';

    const llmPrompt = contextBlock
      ? `אתה מנתח תחרותי לעסקים ישראלים. המשימה שלך: חלץ שמות של עסקים מתחרים מהטקסט הבא.

עסק שלנו: "${name}"${specialtyLine}, קטגוריה: ${category}, אזור: ${areasDesc}

${contextBlock}

הוראות חשובות:
1. חלץ כל שם של עסק/מסעדה/בר שמוזכר בטקסט — גם אם הוא לא מוגדר מפורשות כמתחרה
2. כלול עסקים מכל הערים שסרקנו: ${areasDesc}
3. אל תכלול את "${name}" עצמו
4. אם אין נתונים מספיקים מהטקסט, השתמש בידע שלך על עסקים בתחום "${category}"${specialtyLine} באזורים: ${areasDesc}

עבור כל מתחרה שזיהית:
${competitorFields}`
      : `אתה מנתח תחרותי לעסקים ישראלים.

עסק: "${name}"${specialtyLine}, קטגוריה: ${category}, אזור: ${areasDesc}

בהתבסס על הידע שלך על השוק הישראלי, ציין עד 6 עסקים מתחרים אמיתיים בתחום "${category}"${specialtyLine} באזורים: ${areasDesc}. השתמש בשמות אמיתיים ככל האפשר.

עבור כל מתחרה:
${competitorFields}`;

    const result = await invokeLLM({
      prompt: llmPrompt,
      response_json_schema: { type: 'object' },
      maxTokens: 1500,
    });

    console.log(`runCompetitorIdentification LLM result: ${JSON.stringify(result).substring(0, 500)}`);
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
            category,
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

    // Remove competitors outside the current search areas.
    // Any competitor whose address doesn't mention any of the valid cities is out of scope.
    const allCompetitors = await prisma.competitor.findMany({ where: { linked_business: businessProfileId } });
    const toDelete = allCompetitors.filter(comp => {
      const addr = (comp.address || '').toLowerCase();
      return !searchAreas.some(area => addr.includes(area.toLowerCase()));
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
      areas_scanned: searchAreas,
    });
  } catch (err: any) {
    console.error('runCompetitorIdentification error:', err.message);
    await writeAutomationLog('runCompetitorIdentification', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
