import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

async function tavilySearch(query: string, maxResults = 5): Promise<any[]> {
  if (!TAVILY_API_KEY) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query, search_depth: 'basic', max_results: maxResults }),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    return data.results || [];
  } catch { return []; }
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('he-IL');
}

/**
 * detectEvents — EventIntelligenceAgent
 * Finds local events 3–14 days ahead and estimates impact on the business.
 * Body: { businessProfileId }
 * Returns: { events_found, signals_created }
 */
export async function detectEvents(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city } = profile;
    const fromDate = daysFromNow(3);
    const toDate   = daysFromNow(14);

    // Search for upcoming local events
    const queries = [
      `אירועים ${city} ${fromDate} עד ${toDate}`,
      `פסטיבל כנס ${city} ${new Date().getFullYear()}`,
      `ירידים שוקים ${city} חודש הבא`,
      `אירועי ${category} ${city} קרוב`,
      `ימי כיף אירועי ענף ${category} ישראל`,
    ];

    const resultSets = await Promise.all(queries.map(q => tavilySearch(q, 4)));
    const allResults = resultSets.flat();

    const seen = new Set<string>();
    const unique = allResults.filter(r => {
      if (!r.url || seen.has(r.url)) return false;
      seen.add(r.url); return true;
    });

    if (unique.length === 0) {
      await writeAutomationLog('detectEvents', businessProfileId, startTime, 0);
      return res.json({ events_found: 0, signals_created: 0 });
    }

    // Fetch competitor data to check historical event attendance
    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
      take: 10,
    });
    const competitorNames = competitors.map(c => c.name).join(', ');

    const context = unique.slice(0, 15)
      .map(r => `[${r.url}] ${r.title || ''} — ${(r.content || '').slice(0, 300)}`)
      .join('\n\n');

    const analysis: any = await invokeLLM({
      model: 'haiku',
      prompt: `אתה סוכן אינטליגנציה עסקית. נתח אירועים מקומיים עבור העסק "${name}" (${category}, ${city}).
מתחרים ידועים: ${competitorNames || 'לא ידועים'}.
טווח תאריכים: ${fromDate} עד ${toDate}.

מקורות:
${context.slice(0, 3000)}

זהה אירועים שרלוונטיים לעסק. החזר JSON בלבד:
{
  "events": [{
    "name": "שם האירוע",
    "date_estimate": "תאריך/טווח משוער",
    "location": "מיקום",
    "type": "festival|fair|conference|sports|cultural|holiday",
    "relevance": "high|medium|low",
    "expected_traffic_boost": "גבוה|בינוני|נמוך",
    "opportunity": "הזדמנות ספציפית לעסק — עד 15 מילה",
    "competitor_likely_present": true,
    "recommended_action": "פעולה מוצעת לניצול האירוע"
  }],
  "has_events": true
}`,
      response_json_schema: { type: 'object' },
    }) as any;

    if (!analysis?.has_events || !analysis?.events?.length) {
      await writeAutomationLog('detectEvents', businessProfileId, startTime, 0);
      return res.json({ events_found: 0, signals_created: 0 });
    }

    // Filter relevant events only
    const relevantEvents = analysis.events.filter((e: any) => e.relevance !== 'low');

    const existingSignals = await prisma.marketSignal.findMany({
      where: { linked_business: businessProfileId, category: 'event' },
      select: { summary: true },
    });
    const existingNames = new Set(existingSignals.map(s => s.summary));

    let created = 0;
    for (const event of relevantEvents) {
      if (!event.name || existingNames.has(event.name)) continue;

      await prisma.marketSignal.create({
        data: {
          summary: event.name,
          category: 'event',
          impact_level: event.relevance === 'high' ? 'high' : 'medium',
          recommended_action: `${event.opportunity}\n\nפעולה: ${event.recommended_action}\nמיקום: ${event.location || city}\nתאריך: ${event.date_estimate || 'בקרוב'}${event.competitor_likely_present ? '\n\n⚠️ מתחרים עשויים להיות נוכחים' : ''}`,
          confidence: 70,
          source_urls: '',
          is_read: false,
          detected_at: new Date().toISOString(),
          linked_business: businessProfileId,
        },
      }).catch(() => {});

      existingNames.add(event.name);
      created++;
    }

    await writeAutomationLog('detectEvents', businessProfileId, startTime, created);
    return res.json({ events_found: relevantEvents.length, signals_created: created });
  } catch (err: any) {
    console.error('[detectEvents] error:', err.message);
    await writeAutomationLog('detectEvents', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
