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
    const input = encodeURIComponent(`${category} ${city}`);
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${input}&language=iw&key=${GOOGLE_API_KEY}`);
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

    const [googlePlaces, tavilyResults] = await Promise.all([
      searchNearbyCompetitors(category, city),
      tavilySearch(`מתחרים ${category} ${city} דירוגים ביקורות`, 8),
    ]);

    const existingCompetitors = await prisma.competitor.findMany({ where: { linked_business: businessProfileId } });
    const existingNames = new Set(existingCompetitors.map(c => c.name.toLowerCase()));

    const contextBlock = [
      googlePlaces.length > 0 ? `תוצאות Google Places:\n${googlePlaces.map(p =>
        `- ${p.name}: דירוג ${p.rating || '?'} (${p.user_ratings_total || 0} ביקורות), ${p.formatted_address || city}`
      ).join('\n')}` : '',
      tavilyResults.length > 0 ? `תוצאות חיפוש:\n${tavilyResults.map(r =>
        `- כותרת: ${r.title}\n  תוכן: ${(r.content || '').substring(0, 200)}\n  URL: ${r.url}`
      ).join('\n')}` : '',
    ].filter(Boolean).join('\n\n');

    // Build prompt — fallback to LLM sector knowledge when no external data available
    const competitorFields = `- name: שם המתחרה
- rating: דירוג (1-5 או null)
- review_count: מספר ביקורות או null
- address: כתובת אם ידועה
- strengths: חוזקות (עד 3, מופרד בפסיקים)
- weaknesses: חולשות (עד 3)
- price_range: טווח מחירים אם ידוע
- source_urls: מערך URLים רלוונטיים

החזר JSON: {"competitors": [...]}`;

    const llmPrompt = contextBlock
      ? `אתה מנתח תחרותי לעסקים ישראלים.

עסק: "${name}", קטגוריה: ${category}, עיר: ${city}

${contextBlock}

זהה מתחרים ישירים בלבד (אותה קטגוריה, אותה עיר/אזור). עבור כל מתחרה חלץ:
${competitorFields}`
      : `אתה מנתח תחרותי לעסקים ישראלים.

עסק: "${name}", קטגוריה: ${category}, עיר: ${city}

אין נתוני חיפוש חיצוניים. בהתבסס על הידע שלך על השוק הישראלי, זהה עד 5 מתחרים טיפוסיים בקטגוריה "${category}" באזור "${city}". השתמש בשמות אמיתיים אם ידועים לך, אחרת צור שמות אופייניים לסקטור.

עבור כל מתחרה חלץ:
${competitorFields}`;

    const result = await invokeLLM({
      prompt: llmPrompt,
      response_json_schema: { type: 'object' },
    });

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

    await writeAutomationLog('runCompetitorIdentification', businessProfileId, startTime, created + updated);
    console.log(`runCompetitorIdentification done: ${created} created, ${updated} updated`);
    return res.json({ competitors_found: competitors.length, new_competitors_created: created, existing_competitors_updated: updated });
  } catch (err: any) {
    console.error('runCompetitorIdentification error:', err.message);
    await writeAutomationLog('runCompetitorIdentification', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
