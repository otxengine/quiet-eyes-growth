import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { tavilySearch } from '../../lib/tavily';          // shared cache (12h TTL)
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { buildKeywordQueries, buildUrlQueries } from '../../lib/dataSources';

// Minimum interval between full web-signal collections per business
const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

export async function collectWebSignals(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  // ── Delta guard: skip if last run was <6h ago ─────────────────────────────
  if (shouldSkipAgent(businessProfileId, 'collectWebSignals', MIN_INTERVAL_MS)) {
    return res.json({ new_signals: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city, custom_keywords, custom_urls } = profile;

    const existingSignals = await prisma.rawSignal.findMany({
      where: { linked_business: businessProfileId },
      select: { url: true },
    });
    const existingUrls = new Set(existingSignals.map(s => s.url).filter(Boolean));

    // City/category → English (Tavily works better with English)
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

    // Core queries
    const queries = [
      `"${name}" reviews ${cityStr} Israel`,
      `${catStr} ${cityStr} best recommendations 2025`,
      `${catStr} ${cityStr} Israel`,
    ];

    // ── custom_keywords: ALL configured keywords → one query each ───────────
    for (const q of buildKeywordQueries(profile, cityStr)) queries.push(q);

    // ── custom_urls: every configured source domain targeted with Tavily ─────
    for (const q of buildUrlQueries(profile, name)) queries.push(q);

    let newSignals = 0;
    for (const query of queries) {
      // tavilySearch uses basic depth + 4h in-memory cache
      const results = await tavilySearch(query, 4);
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

    setLastRun(businessProfileId, 'collectWebSignals');
    await writeAutomationLog('collectWebSignals', businessProfileId, startTime, newSignals);
    return res.json({ new_signals: newSignals });
  } catch (err: any) {
    console.error('collectWebSignals error:', err.message);
    await writeAutomationLog('collectWebSignals', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
