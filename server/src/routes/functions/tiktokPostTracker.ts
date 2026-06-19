/**
 * tiktokPostTracker — עוקב אחר ביצועי סרטוני TikTok שפורסמו.
 *
 * זרימה:
 *   1. מחפש OrganicPost (platform='tiktok', status='published', 1-7 ימים אחורה)
 *   2. שולף פרופיל TikTok של העסק דרך Apify
 *   3. ממפה סרטונים שנסרקו לפוסטים שפורסמו (לפי קרבת זמן ±3h)
 *   4. משווה ביצועים לבנצ'מרק הסקטור (מ-tiktokSectorTrendAgent MarketSignals)
 *   5. שומר MarketSignal עם ביצועים + המלצת שיפור
 *   6. ProactiveAlert אם הסרטון מתחת לביצוע
 *
 * Delta guard: 12h
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { runApifyActor, hasApifyKey } from '../../lib/apify';

const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h

export async function tiktokPostTracker(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  if (shouldSkipAgent(businessProfileId, 'tiktokPostTracker', MIN_INTERVAL_MS)) {
    return res.json({ tracked: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    // ── 1. Find published TikTok posts from the last 7 days (but at least 24h old) ──
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000);
    const oneDayAgo    = new Date(Date.now() - 24 * 3600_000);

    const publishedPosts = await prisma.organicPost.findMany({
      where: {
        linked_business: businessProfileId,
        platform:        'tiktok',
        status:          'published',
        published_at: { gte: sevenDaysAgo, lte: oneDayAgo },
      },
      orderBy: { published_at: 'desc' },
      take: 5,
    });

    if (publishedPosts.length === 0) {
      setLastRun(businessProfileId, 'tiktokPostTracker');
      await writeAutomationLog('tiktokPostTracker', businessProfileId, startTime, 0);
      return res.json({ tracked: 0, note: 'No published TikTok posts in range (1-7 days ago)' });
    }

    // ── 2. Resolve TikTok username ─────────────────────────────────────────
    const tiktokUrl: string | null = (profile as any).tiktok_url || null;
    const tiktokAccount = await prisma.socialAccount.findFirst({
      where: { linked_business: businessProfileId, platform: 'tiktok_business', is_connected: true },
    });
    const tiktokUsername =
      (tiktokUrl ? (tiktokUrl.match(/@([\w.]+)/) || [])[1] : null) ||
      tiktokAccount?.account_name ||
      null;

    if (!tiktokUsername || !hasApifyKey()) {
      setLastRun(businessProfileId, 'tiktokPostTracker');
      await writeAutomationLog('tiktokPostTracker', businessProfileId, startTime, 0);
      return res.json({ tracked: 0, note: 'No TikTok URL/username or Apify key not configured' });
    }

    // ── 3. Scrape business TikTok profile ──────────────────────────────────
    const profileVideos = await runApifyActor(
      'clockworks~tiktok-profile-scraper',
      { profiles: [tiktokUsername], resultsPerPage: 20 },
      60_000,
      20,
    );

    if (profileVideos.length === 0) {
      setLastRun(businessProfileId, 'tiktokPostTracker');
      await writeAutomationLog('tiktokPostTracker', businessProfileId, startTime, 0);
      return res.json({ tracked: 0, note: `No videos found on TikTok profile @${tiktokUsername}` });
    }

    // ── 4. Sector benchmark from recent tiktokSectorTrend signals ──────────
    const benchmarkSignals = await prisma.marketSignal.findMany({
      where: {
        linked_business: businessProfileId,
        category: 'tiktok_sector_trend',
        detected_at: { gte: new Date(Date.now() - 7 * 24 * 3600_000).toISOString() },
      },
      take: 3,
    });

    let sectorAvgPlaysPerDay = 8000; // conservative default
    const benchmarkValues: number[] = [];
    for (const sig of benchmarkSignals) {
      try {
        const meta = JSON.parse(sig.source_description || '{}');
        const benchmarkPlays = meta.evidence?.avg_plays_per_day;
        if (benchmarkPlays && benchmarkPlays > 0) benchmarkValues.push(benchmarkPlays);
      } catch (_) {}
    }
    if (benchmarkValues.length > 0) {
      sectorAvgPlaysPerDay = Math.round(
        benchmarkValues.reduce((sum, v) => sum + v, 0) / benchmarkValues.length
      );
    }

    // ── 5. Match and evaluate each published post ──────────────────────────
    let tracked = 0;

    for (const post of publishedPosts) {
      if (!post.published_at) continue;

      // Skip if we already tracked this post recently
      const alreadyTracked = await prisma.marketSignal.findFirst({
        where: {
          linked_business: businessProfileId,
          category: 'tiktok_post_performance',
          summary: { contains: (post.content || '').slice(0, 30) },
          detected_at: { gte: new Date(Date.now() - 24 * 3600_000).toISOString() },
        },
      });
      if (alreadyTracked) continue;

      const publishedUnix = new Date(post.published_at).getTime() / 1000;

      // Find the scraped video closest in time (±3h window)
      const matchedVideo = profileVideos.find((v: any) => {
        const vTime = v.createTime || v.createTimestamp || 0;
        return Math.abs(vTime - publishedUnix) < 3 * 3600;
      });

      if (!matchedVideo) continue;

      const plays    = matchedVideo.stats?.playCount    ?? matchedVideo.playCount    ?? 0;
      const likes    = matchedVideo.stats?.diggCount    ?? matchedVideo.diggCount    ?? 0;
      const comments = matchedVideo.stats?.commentCount ?? matchedVideo.commentCount ?? 0;
      const shares   = matchedVideo.stats?.shareCount   ?? matchedVideo.shareCount   ?? 0;

      const ageHours     = (Date.now() / 1000 - publishedUnix) / 3600;
      const playsPerDay  = ageHours > 0 ? (plays / ageHours) * 24 : 0;
      const engRate      = plays > 0 ? (likes + comments) / plays : 0;
      const videoUrl     = matchedVideo.webVideoUrl || matchedVideo.shareUrl || '';

      const performance =
        playsPerDay >= sectorAvgPlaysPerDay * 0.8 ? 'above_benchmark' :
        playsPerDay >= sectorAvgPlaysPerDay * 0.4 ? 'at_benchmark'    : 'below_benchmark';

      // LLM: improvement recommendation
      const perfLabel =
        performance === 'above_benchmark' ? `מעל הממוצע ✅ (${Math.round(playsPerDay / sectorAvgPlaysPerDay * 100)}% מהבנצ'מרק)` :
        performance === 'at_benchmark'    ? `בממוצע ⚠️` : `מתחת לממוצע ❌`;

      const feedback = await invokeLLM({
        model: 'sonnet',
        maxTokens: 300,
        prompt: `You are a TikTok analyst for Israeli businesses. Provide a specific tactical recommendation to improve the video's performance.

Business: "${profile.name}" | Sector: ${profile.category}
Content: "${(post.content || '').slice(0, 200)}"
Performance: ${plays.toLocaleString()} views | ${(engRate * 100).toFixed(1)}% engagement | ${Math.round(playsPerDay).toLocaleString()} views/day after ${Math.round(ageHours)} hours
Benchmark: ${sectorAvgPlaysPerDay.toLocaleString()} views/day | Status: ${perfLabel}

Give a specific recommendation + one action (not "improve content" — but e.g. "reply to the first 5 comments within 30 minutes" or "share in Story with a Poll").
Return ONLY valid JSON. ALL string values must be in Hebrew: { "recommendation": "specific recommendation", "boost_action": "comment_reply|reshare_story|boost_ad|none" }`,
        response_json_schema: { type: 'object' },
      });

      // Save performance signal
      await prisma.marketSignal.create({
        data: {
          linked_business:    businessProfileId,
          summary:            `TikTok ביצועים: ${plays.toLocaleString()} צפיות | ${(engRate * 100).toFixed(1)}% eng — ${performance === 'above_benchmark' ? 'מעל ממוצע ✅' : performance === 'at_benchmark' ? 'בממוצע ⚠️' : 'מתחת לממוצע ❌'}`,
          category:           'tiktok_post_performance',
          impact_level:       performance === 'below_benchmark' ? 'high' : 'low',
          confidence:         82,
          recommended_action: feedback?.recommendation || 'בדוק את ביצועי הסרטון',
          source_urls:        videoUrl,
          source_description: JSON.stringify({
            action_type:                    'tiktok_post_tracker',
            post_content_preview:           (post.content || '').slice(0, 200),
            plays,
            likes,
            comments,
            shares,
            engagement_rate_pct:            parseFloat((engRate * 100).toFixed(1)),
            plays_per_day:                  Math.round(playsPerDay),
            age_hours:                      Math.round(ageHours),
            sector_benchmark_plays_per_day: sectorAvgPlaysPerDay,
            performance,
            boost_action:                   feedback?.boost_action || 'none',
            video_url:                      videoUrl,
          }),
          detected_at: new Date().toISOString(),
          is_read:     false,
        },
      });

      // ProactiveAlert only for underperforming posts
      if (performance === 'below_benchmark') {
        const boostAction = feedback?.boost_action || 'none';
        const boostLabel =
          boostAction === 'boost_ad'        ? 'שקול קידום ממומן של הסרטון' :
          boostAction === 'reshare_story'   ? 'שתף שוב בסטורי / WhatsApp קבוצות' :
          boostAction === 'comment_reply'   ? 'הגב לתגובות — מגביר פיזור אורגני' :
                                              'עקוב אחרי הביצועים 24 שעות נוספות';
        await prisma.proactiveAlert.create({
          data: {
            linked_business:  businessProfileId,
            alert_type:       'tiktok_underperforming',
            title:            `סרטון TikTok מתחת לביצוע: ${plays.toLocaleString()} צפיות (ממוצע סקטור: ${sectorAvgPlaysPerDay.toLocaleString()}/יום)`,
            description:      feedback?.recommendation || 'הסרטון מקבל פחות צפיות מהצפוי לסקטור',
            suggested_action: boostLabel,
            priority:         'medium',
            source_agent:     'tiktokPostTracker',
            is_dismissed:     false,
            is_acted_on:      false,
            created_at:       new Date().toISOString(),
          },
        }).catch(() => {});
      }

      tracked++;
    }

    setLastRun(businessProfileId, 'tiktokPostTracker');
    await writeAutomationLog('tiktokPostTracker', businessProfileId, startTime, tracked);
    console.log(`tiktokPostTracker done: ${tracked} posts tracked | benchmark: ${sectorAvgPlaysPerDay}/day`);

    return res.json({ tracked, sector_benchmark_plays_per_day: sectorAvgPlaysPerDay });

  } catch (err: any) {
    console.error('[tiktokPostTracker] error:', err.message);
    await writeAutomationLog('tiktokPostTracker', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
