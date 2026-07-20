import { Request, Response } from 'express';
import { prisma } from '../../db';
import { callAIJson } from '../../lib/ai_router';
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

      let pageData: any = null;
      try {
        // Gemini Flash via page_parsing: handles noisy raw HTML universally
        // across all business sectors without domain-specific tuning.
        pageData = await callAIJson('page_parsing', `Extract prices, services, and menu highlights from the website of an Israeli business: "${comp.name}".
${pageText.slice(0, 4000)}

Extract ONLY items that appear explicitly in the text. Do not invent prices or services. Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "price_min": number_or_null,
  "price_max": number_or_null,
  "price_unit": "לשעה|לביקור|לחודש|למנה|לסשן|לטיפול|אחר|null",
  "price_tier": "budget|mid|premium|unknown",
  "evidence": "ציטוט מדויק מהאתר (עד 80 תווים)",
  "services": "comma-separated list of services/products offered, up to 80 chars, or null",
  "menu_highlights": "top 3 specific menu items or signature services, pipe-separated, or null"
}
If there are no explicit prices: return price_min=null`);
      } catch (_) { continue; }

      if (!pageData) continue;

      const hasPrices = pageData.price_min || pageData.price_max;
      const summary = hasPrices
        ? `₪${pageData.price_min}${pageData.price_max ? `–₪${pageData.price_max}` : '+'} ${pageData.price_unit || ''}`.trim()
        : '';

      const updateFields: Record<string, any> = { last_price_check: new Date().toISOString() };
      if (hasPrices) {
        updateFields.price_range       = summary;
        updateFields.last_known_prices = pageData.evidence ? `${summary} — "${pageData.evidence}"` : summary;
      }
      if (pageData.services && !(comp as any).services)        updateFields.services        = pageData.services;
      if (pageData.menu_highlights && !(comp as any).menu_highlights) updateFields.menu_highlights = pageData.menu_highlights;

      if (Object.keys(updateFields).length <= 1) continue; // only last_price_check — nothing useful

      // Update the Competitor record with price/services info
      await prisma.competitor.update({
        where: { id: comp.id },
        data: updateFields,
      }).catch((e: any) => console.warn(`[detectCompetitorPricing] write failed for ${comp.name}:`, e.message));

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
