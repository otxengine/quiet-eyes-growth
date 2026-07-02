import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { tavilySearch, isTavilyRateLimited } from '../../lib/tavily'; // shared cache (12h TTL)
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { buildKeywordQueries, buildUrlQueries } from '../../lib/dataSources';
import { buildSearchQueries, cityToEn } from '../../lib/businessProfile';
import { getAgentMission } from '../../lib/missionPlanner';

// Minimum interval between full web-signal collections per business
const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

export async function collectWebSignals(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  // ── Delta guard: skip if last run was <12h ago ────────────────────────────
  if (shouldSkipAgent(businessProfileId, 'collectWebSignals', MIN_INTERVAL_MS)) {
    await writeAutomationLog('collectWebSignals', businessProfileId, new Date().toISOString(), 0, 'success', 'ran_recently');
    return res.json({ new_signals: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  let newSignals = 0;
  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, city } = profile;

    const existingSignals = await prisma.rawSignal.findMany({
      where: { linked_business: businessProfileId },
      select: { url: true },
    });
    const existingUrls = new Set(existingSignals.map(s => s.url).filter(Boolean));

    const cityStr = cityToEn(city);

    // ── Mission-driven queries (agent_missions > sector_profile > fallback) ───
    const mission = getAgentMission<{ priority_queries_en?: string[]; exclude_topics?: string[] }>(profile, 'collectWebSignals');
    const queries: string[] = mission?.priority_queries_en?.length
      ? [...mission.priority_queries_en, ...buildSearchQueries(profile, cityStr).slice(0, 3)]
      : buildSearchQueries(profile, cityStr);

    // ── custom_keywords: user-configured keywords → one query each ──────────
    for (const q of buildKeywordQueries(profile, cityStr)) queries.push(q);

    // ── custom_urls: every configured source domain targeted with Tavily ─────
    for (const q of buildUrlQueries(profile, name)) queries.push(q);

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

    if (isTavilyRateLimited()) {
      await writeAutomationLog('collectWebSignals', businessProfileId, startTime, newSignals, 'failed', 'Tavily rate-limited — signals may be incomplete');
      return res.json({ new_signals: newSignals, tavily_rate_limited: true });
    }

    setLastRun(businessProfileId, 'collectWebSignals');
    await writeAutomationLog('collectWebSignals', businessProfileId, startTime, newSignals);
    return res.json({ new_signals: newSignals });
  } catch (err: any) {
    console.error('collectWebSignals error:', err.message);
    await writeAutomationLog('collectWebSignals', businessProfileId, startTime, newSignals, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
