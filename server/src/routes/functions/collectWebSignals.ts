import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

async function tavilySearch(query: string, maxResults = 5): Promise<any[]> {
  if (!TAVILY_API_KEY) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query, search_depth: 'advanced', max_results: maxResults, include_answer: false }),
    });
    if (!res.ok) {
      console.error('Tavily error:', res.status, await res.text());
      return [];
    }
    const data: any = await res.json();
    return data.results || [];
  } catch (e: any) {
    console.error('tavilySearch exception:', e.message);
    return [];
  }
}

export async function collectWebSignals(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    // Fetch profile from DB — don't rely on req.body for name/category/city
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city, custom_keywords, custom_urls } = profile;

    const existingSignals = await prisma.rawSignal.findMany({ where: { linked_business: businessProfileId } });
    const existingUrls = new Set(existingSignals.map(s => s.url).filter(Boolean));

    // City/category → English for Tavily (works better than Hebrew)
    const cityEn: Record<string, string> = {
      'תל אביב': 'Tel Aviv', 'ירושלים': 'Jerusalem', 'חיפה': 'Haifa',
      'בני ברק': 'Bnei Brak', 'ראשון לציון': 'Rishon LeZion', 'נתניה': 'Netanya',
      'זכרון יעקב': 'Zichron Yaakov', 'אשדוד': 'Ashdod', 'רמת גן': 'Ramat Gan',
    };
    const categoryEn: Record<string, string> = {
      'מסעדה': 'restaurant', 'כושר': 'fitness gym', 'יופי': 'beauty salon',
      'restaurant': 'restaurant', 'fitness': 'fitness gym', 'beauty': 'beauty salon', 'local': 'local business',
    };
    const cityStr = cityEn[city] || city;
    const catStr = categoryEn[category] || category;

    const queries = [
      `"${name}" reviews ratings Israel`,
      `${catStr} ${cityStr} Israel reviews 2025`,
      `${catStr} ${cityStr} best recommendations`,
      `"${name}" ${cityStr} Israel`,
    ];

    // Add English translations of Hebrew custom keywords
    if (custom_keywords) {
      const kws = custom_keywords.split(',').map((k: string) => k.trim()).filter(Boolean).slice(0, 2);
      for (const kw of kws) queries.push(`${kw} ${cityStr} Israel`);
    }
    // Also try custom URLs directly
    if (custom_urls) {
      const urls = custom_urls.split('\n').map((u: string) => u.trim()).filter((u: string) => u.startsWith('http')).slice(0, 3);
      for (const url of urls) {
        const siteQuery = `site:${new URL(url).hostname} ${name} OR ${catStr} ${cityStr}`;
        queries.push(siteQuery);
      }
    }

    let newSignals = 0;
    for (const query of queries) {
      const results = await tavilySearch(query, 5);
      console.log(`Tavily query "${query}": ${results.length} results`);
      for (const r of results) {
        if (!r.url || existingUrls.has(r.url)) continue;
        await prisma.rawSignal.create({
          data: {
            source: `tavily_web: ${query}`,
            content: (r.content || r.title || '').substring(0, 500),
            url: r.url,
            signal_type: 'web_search',
            source_origin: 'tavily',
            detected_at: new Date().toISOString(),
            linked_business: businessProfileId,
          },
        });
        existingUrls.add(r.url);
        newSignals++;
      }
    }

    await writeAutomationLog('collectWebSignals', businessProfileId, startTime, newSignals);
    console.log(`collectWebSignals done: ${newSignals} new signals for "${profile.name}"`);
    return res.json({ new_signals: newSignals });
  } catch (err: any) {
    console.error('collectWebSignals error:', err.message);
    await writeAutomationLog('collectWebSignals', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
