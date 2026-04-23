import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

async function fetchPageText(url: string): Promise<string> {
  if (!TAVILY_API_KEY) return '';
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query: url,
        search_depth: 'basic',
        max_results: 1,
        include_raw_content: true,
      }),
    });
    if (!res.ok) return '';
    const data: any = await res.json();
    return data.results?.[0]?.raw_content || data.results?.[0]?.content || '';
  } catch { return ''; }
}

/**
 * detectCompetitorPricing
 * Scrapes competitor websites for price info and stores in competitor_changes.
 *
 * Body: { businessProfileId }
 * Returns: { competitors_checked, prices_found }
 */
export async function detectCompetitorPricing(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
    });

    // Use first URL from source_urls (pipe-separated) or name-based search
    const withWebsites = competitors.filter(c => c.source_urls);
    let pricesFound = 0;

    for (const comp of withWebsites) {
      const firstUrl = (comp.source_urls || '').split(' | ')[0].trim();
      if (!firstUrl) continue;
      const pageText = await fetchPageText(firstUrl);
      if (!pageText || pageText.length < 50) continue;

      let priceData: any = null;
      try {
        priceData = await invokeLLM({
          model: 'haiku',
          prompt: `נתח טקסט מאתר של עסק ישראלי: "${comp.name}".
${pageText.slice(0, 3000)}

חלץ מחירים אם קיימים. החזר JSON בלבד:
{
  "price_min": number_or_null,
  "price_max": number_or_null,
  "price_unit": "לשעה|לביקור|לחודש|למנה|לסשן|לטיפול|אחר|null",
  "price_tier": "budget|mid|premium|unknown",
  "evidence": "ציטוט קצר מהאתר (עד 80 תווים)"
}
אם אין מחירים: החזר price_min=null`,
          response_json_schema: { type: 'object' },
        });
      } catch (_) { continue; }

      if (!priceData || (!priceData.price_min && !priceData.price_max)) continue;

      const summary = priceData.price_min
        ? `₪${priceData.price_min}${priceData.price_max ? `–₪${priceData.price_max}` : '+'} ${priceData.price_unit || ''}`.trim()
        : 'מחירים לא פורסמו באתר';

      // Update the Competitor record with price info
      await prisma.competitor.update({
        where: { id: comp.id },
        data: {
          price_range: summary,
          last_known_prices: priceData.evidence ? `${summary} — "${priceData.evidence}"` : summary,
          last_price_check: new Date().toISOString(),
        },
      }).catch(() => {});

      pricesFound++;
    }

    await writeAutomationLog('detectCompetitorPricing', businessProfileId, startTime, pricesFound);
    console.log(`detectCompetitorPricing done: ${pricesFound} prices from ${withWebsites.length} competitors`);
    return res.json({ competitors_checked: withWebsites.length, prices_found: pricesFound });
  } catch (err: any) {
    console.error('detectCompetitorPricing error:', err.message);
    await writeAutomationLog('detectCompetitorPricing', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
