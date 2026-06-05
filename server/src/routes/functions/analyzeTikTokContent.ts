import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { tavilySearch } from '../../lib/tavily';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { getValidTikTokToken } from '../../lib/tiktokTokenRefresh';

const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const GRAPH_BASE = 'https://open-api.tiktok.com';

const CITY_EN: Record<string, string> = {
  'תל אביב': 'Tel Aviv', 'ירושלים': 'Jerusalem', 'חיפה': 'Haifa',
  'זכרון יעקב': 'Zichron Yaakov', 'נתניה': 'Netanya', 'ראשון לציון': 'Rishon LeZion',
  'אשדוד': 'Ashdod', 'רמת גן': 'Ramat Gan', 'בני ברק': 'Bnei Brak',
};
const CAT_EN: Record<string, string> = {
  'מסעדה': 'restaurant', 'כושר': 'fitness gym', 'יופי': 'beauty salon',
  'קפה': 'cafe', 'מאפייה': 'bakery', 'ספא': 'spa',
};

async function fetchTikTokUserVideos(accessToken: string, openId: string): Promise<any[]> {
  try {
    const res = await fetch(`${GRAPH_BASE}/video/list/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        open_id: openId,
        fields: ['id', 'title', 'create_time', 'share_url', 'view_count', 'like_count', 'comment_count'],
        cursor: 0,
        max_count: 10,
      }),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    return data?.data?.videos || [];
  } catch { return []; }
}

async function apifyTikTokProfile(username: string): Promise<any[]> {
  if (!hasApifyKey() || !username) return [];
  return runApifyActor(
    'clockworks~tiktok-profile-scraper',
    { profiles: [username], resultsPerPage: 10 },
    60_000,
    20,
  );
}

export async function analyzeTikTokContent(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (shouldSkipAgent(businessProfileId, 'analyzeTikTokContent', MIN_INTERVAL_MS)) {
    return res.json({ videos_analyzed: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city } = profile;
    const cityStr = CITY_EN[city] || city;
    const catStr  = CAT_EN[category] || category;

    const tiktokAccount = await prisma.socialAccount.findFirst({
      where: { linked_business: businessProfileId, platform: 'tiktok_business', is_connected: true },
    });

    // Extract TikTok username from profile URL (entered during onboarding)
    // e.g. https://www.tiktok.com/@username → username
    const tiktokUrl: string | null = (profile as any).tiktok_url || null;
    const tiktokUsernameFromUrl = tiktokUrl
      ? (tiktokUrl.match(/@([\w.]+)/) || tiktokUrl.match(/tiktok\.com\/([\w.]+)/))?.[1] || null
      : null;
    console.log(`[analyzeTikTokContent] settings → tiktok_url=${tiktokUrl || 'none'} username=${tiktokUsernameFromUrl || 'none'} oauth=${!!tiktokAccount?.access_token}`);

    let videos: any[] = [];
    let dataSource = 'tavily';

    // ── 1. TikTok API (own videos — OAuth connected) ─────────────────────────
    if (tiktokAccount?.page_id) {
      const validToken = await getValidTikTokToken(businessProfileId);
      if (validToken) {
        videos = await fetchTikTokUserVideos(validToken, tiktokAccount.page_id);
        if (videos.length > 0) dataSource = 'tiktok_api';
      }
    }

    // ── 2. Apify — scrape by URL entered in onboarding (no OAuth needed) ─────
    if (videos.length === 0 && tiktokUsernameFromUrl) {
      const apifyVideos = await apifyTikTokProfile(tiktokUsernameFromUrl);
      if (apifyVideos.length > 0) { videos = apifyVideos; dataSource = 'apify_url'; }
    }

    // ── 3. Apify fallback — scrape by OAuth account name ─────────────────────
    if (videos.length === 0 && tiktokAccount?.account_name) {
      const apifyVideos = await apifyTikTokProfile(tiktokAccount.account_name);
      if (apifyVideos.length > 0) { videos = apifyVideos; dataSource = 'apify'; }
    }

    // ── 3. Sector TikTok trends via Tavily (always runs) ────────────────────
    const trendResults: any[] = [];
    const trendQueries = [
      `TikTok trending ${catStr} Israel 2025`,
      `viral ${catStr} TikTok content Israel`,
      `TikTok ${catStr} ${cityStr} influencer`,
    ];
    for (const q of trendQueries) {
      const r = await tavilySearch(q, 4);
      trendResults.push(...r);
    }

    // ── 4. LLM analysis ─────────────────────────────────────────────────────
    const ownVideosCtx = videos.length > 0
      ? `סרטוני TikTok האחרונים של העסק:\n${videos.slice(0, 6).map((v: any, i: number) =>
          `${i + 1}. "${v.title || v.text || 'ללא כותרת'}" — צפיות: ${v.view_count ?? v.playCount ?? '?'}, לייקים: ${v.like_count ?? v.diggCount ?? '?'}, תגובות: ${v.comment_count ?? v.commentCount ?? '?'}`
        ).join('\n')}`
      : 'TikTok לא מחובר — ניתוח מבוסס על מגמות שוק בלבד';

    const trendCtx = trendResults.length > 0
      ? `מגמות TikTok בסקטור:\n${trendResults.slice(0, 5).map(r => `- ${r.title || ''}: ${(r.content || '').slice(0, 120)}`).join('\n')}`
      : '';

    const result = await invokeLLM({
      maxTokens: 450,
      prompt: `You are a TikTok expert for small Israeli businesses. Analyze for "${name}" (${category}, ${city}).

${ownVideosCtx}

${trendCtx}

Extract strategic insights:
1. Current content performance (if available)
2. A rising TikTok trend relevant to the sector
3. A specific recommended content format
4. Optimal posting time

Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "performance_insight": "insight about current performance — one sentence",
  "sector_trend": "specific trend rising in the sector right now",
  "trending_formats": ["format1", "format2"],
  "recommended_action": "specific immediate action the business can take",
  "best_posting_hour": 19,
  "top_hashtags": ["#hashtag1", "#hashtag2", "#hashtag3"],
  "confidence": 0.72
}`,
      response_json_schema: { type: 'object' },
    });

    let created = 0;

    if (result?.performance_insight) {
      await prisma.marketSignal.create({
        data: {
          linked_business: businessProfileId,
          summary: `TikTok: ${result.performance_insight}`,
          category: 'social',
          impact_level: 'medium',
          confidence: result.confidence ?? 0.72,
          recommended_action: result.recommended_action || 'צור תוכן TikTok',
          detected_at: new Date().toISOString(),
          source_description: `TikTok Intelligence (${dataSource})`,
          is_read: false,
        },
      });
      created++;
    }

    if (result?.sector_trend) {
      const hashtags = (result.trending_formats || []).slice(0, 2).join(', ');
      await prisma.marketSignal.create({
        data: {
          linked_business: businessProfileId,
          summary: `טרנד TikTok בסקטור: ${result.sector_trend}`,
          category: 'trend',
          impact_level: 'high',
          confidence: 0.74,
          recommended_action: `פרסם בשעה ${result.best_posting_hour ?? 19}:00 | פורמט: ${hashtags || 'וידאו קצר 15-30 שניות'} | האשטאגים: ${(result.top_hashtags || []).slice(0, 3).join(' ')}`,
          detected_at: new Date().toISOString(),
          source_description: 'TikTok Trend Detector',
          is_read: false,
        },
      });
      created++;
    }

    setLastRun(businessProfileId, 'analyzeTikTokContent');
    await writeAutomationLog('analyzeTikTokContent', businessProfileId, startTime, created);
    console.log(`analyzeTikTokContent done: ${created} signals | source: ${dataSource} | videos: ${videos.length}`);
    return res.json({ items_created: created, data_source: dataSource, videos_analyzed: videos.length });

  } catch (err: any) {
    console.error('[analyzeTikTokContent]', err.message);
    await writeAutomationLog('analyzeTikTokContent', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
