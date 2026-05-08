/**
 * tiktokAudienceAgent — מנתח קהל יעד ב-TikTok לפי דפוסי engagement בסקטור.
 *
 * אין גישה לדמוגרפיה אמיתית מ-TikTok API (דורש Business Center מלא).
 * במקום זאת, מנתח BEHAVIORAL audience — מה הקהל בפועל צורך ומגיב לו:
 *   • גילאים / מגדר — נגזר ממחקר Tavily + engagement patterns
 *   • שעות פרסום אופטימליות — לפי התפלגות createTime של סרטוני הסקטור
 *   • Hooks שעובדים — לפי תבניות engagement גבוה
 *   • מה להימנע — לפי תבניות engagement נמוך
 *   • אסטרטגיית גדילה 30 ימים
 *
 * מקור נתונים: clockworks~tiktok-hashtag-scraper (אותם נתוני sector כמו tiktokSectorTrendAgent)
 * Cache: שיתוף cache עם tiktokSectorTrendAgent (אותו cache key)
 * Delta guard: 24h
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { shouldSkipAgent, setLastRun, cacheGet, cacheSet, TTL } from '../../lib/agentCache';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { tavilySearch } from '../../lib/tavily';

const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

// Shared with tiktokSectorTrendAgent — same hashtag resolution logic
const SECTOR_HASHTAGS: Record<string, string[]> = {
  'מסעדה':    ['מסעדה', 'אוכל', 'food_israel', 'restaurant_israel', 'שף'],
  'סושי':     ['סושי', 'sushi_israel', 'sushi', 'אוכל_יפני', 'מסעדה', 'food_israel'],
  'בר סושי':  ['סושי', 'sushi_israel', 'sushi', 'אוכל_יפני', 'מסעדה', 'food_israel'],
  'סושי בר':  ['סושי', 'sushi_israel', 'sushi', 'אוכל_יפני', 'מסעדה', 'food_israel'],
  'יפני':     ['אוכל_יפני', 'סושי', 'sushi', 'מסעדה'],
  'פיצה':     ['פיצה', 'pizza_israel', 'pizza', 'אוכל', 'food_israel'],
  'המבורגר':  ['המבורגר', 'burger_israel', 'burger', 'food_israel'],
  'קפה':      ['קפה', 'cafe_israel', 'לאטה', 'coffee', 'בית_קפה'],
  'מאפייה':   ['מאפייה', 'לחם', 'bakery_israel', 'עוגה', 'אפייה'],
  'כושר':     ['כושר', 'fitness_israel', 'אימון', 'gym_israel', 'workout'],
  'יוגה':     ['יוגה', 'yoga_israel', 'wellness', 'בריאות'],
  'יופי':     ['יופי', 'beauty_israel', 'מספרה', 'טיפוח', 'מניקור', 'איפור'],
  'מספרה':    ['מספרה', 'haircut_israel', 'שיער', 'beauty_israel'],
  'ספא':      ['ספא', 'spa_israel', 'עיסוי', 'wellness'],
  'חנות':     ['עסק_קטן_ישראל', 'חנות', 'קניות'],
  'אופנה':    ['אופנה', 'fashion_israel', 'בגדים', 'shopping_israel'],
  'שיניים':   ['שיניים', 'dental_israel', 'חיוך'],
  'חינוך':    ['חינוך', 'לימודים', 'קורס'],
  'נדלן':     ['נדלן', 'דירה', 'real_estate_israel'],
};

function resolveHashtags(category: string): string[] {
  if (SECTOR_HASHTAGS[category]) return SECTOR_HASHTAGS[category];
  const lower = category.toLowerCase();
  for (const [key, tags] of Object.entries(SECTOR_HASHTAGS)) {
    if (lower.includes(key) || key.includes(lower)) return tags;
  }
  const foodKeywords = ['אוכל', 'מנה', 'מסעדה', 'בר', 'שף', 'בישול'];
  if (foodKeywords.some(k => lower.includes(k) || category.includes(k))) {
    return ['אוכל', 'food_israel', 'מסעדה', 'restaurant_israel', 'שף'];
  }
  return [category, 'food_israel', 'israel', 'עסק_קטן_ישראל'];
}

const CAT_EN: Record<string, string> = {
  'מסעדה': 'restaurant', 'קפה': 'cafe', 'מאפייה': 'bakery',
  'כושר': 'fitness', 'יופי': 'beauty salon', 'ספא': 'spa',
  'חנות': 'local shop', 'שיניים': 'dental clinic', 'חינוך': 'education', 'נדלן': 'real estate',
};

export async function tiktokAudienceAgent(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  if (!req.body.force && shouldSkipAgent(businessProfileId, 'tiktokAudienceAgent', MIN_INTERVAL_MS)) {
    return res.json({ signals_created: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city } = profile;
    const catEn = CAT_EN[category] || category;
    const sectorHashtags = resolveHashtags(category);
    console.log(`[tiktokAudienceAgent] category="${category}" → hashtags: ${sectorHashtags.slice(0, 4).join(', ')}`);

    // ── 1. TikTok sector video data (reuse tiktokSectorTrendAgent cache) ──
    const apifyCacheKey = `apify_tiktok_hashtags:${sectorHashtags.slice(0, 3).join(',')}`;
    let rawVideos: any[] = cacheGet<any[]>(apifyCacheKey) || [];

    if (rawVideos.length === 0 && hasApifyKey()) {
      rawVideos = await runApifyActor(
        'clockworks~tiktok-hashtag-scraper',
        {
          hashtags:             sectorHashtags.slice(0, 5),
          resultsPerPage:       50,
          maxItems:             50,
          shouldDownloadVideos: false,
          shouldDownloadCovers: false,
        },
        90_000,
        50,
      );
      if (rawVideos.length > 0) cacheSet(apifyCacheKey, rawVideos, TTL.API_RESULT);
    }

    // ── 2. Derive behavioral patterns from video data ──────────────────────
    const hourCounts: Record<number, number> = {};
    const hashtagEngagement: Record<string, { total: number; count: number }> = {};
    const soundUsage: Record<string, number> = {};
    const engagements: number[] = [];

    for (const v of rawVideos) {
      const plays    = v.stats?.playCount    ?? v.playCount    ?? 0;
      const likes    = v.stats?.diggCount    ?? v.diggCount    ?? 0;
      const comments = v.stats?.commentCount ?? v.commentCount ?? 0;
      if (plays < 1000) continue;

      const eng = (likes + comments) / plays;
      engagements.push(eng);

      // Posting hour distribution (UTC)
      const createTime = v.createTime || v.createTimestamp || 0;
      if (createTime) {
        const hour = new Date(createTime * 1000).getUTCHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      }

      // Hashtag engagement scores
      for (const h of (v.hashtags || [])) {
        const tag = h.name || h;
        if (!tag) continue;
        if (!hashtagEngagement[tag]) hashtagEngagement[tag] = { total: 0, count: 0 };
        hashtagEngagement[tag].total += eng;
        hashtagEngagement[tag].count += 1;
      }

      // Sound usage frequency
      const music = v.music?.title || v.musicMeta?.musicName || '';
      if (music && music.length > 3) {
        soundUsage[music] = (soundUsage[music] || 0) + 1;
      }
    }

    const avgEng = engagements.length > 0
      ? engagements.reduce((a, b) => a + b, 0) / engagements.length
      : 0;

    // Top 3 posting hours by video count (shift UTC+3 for IL time)
    const topHours = Object.entries(hourCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 4)
      .map(([h]) => {
        const ilHour = (parseInt(h) + 3) % 24;
        return `${ilHour}:00`;
      });

    // Top hashtags by avg engagement (only those in 3+ videos)
    const topHashtags = Object.entries(hashtagEngagement)
      .filter(([, v]) => v.count >= 3)
      .map(([tag, v]) => ({ tag, avg: v.total / v.count }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 8)
      .map(h => `#${h.tag} (${(h.avg * 100).toFixed(1)}%)`);

    // Top sounds by frequency
    const topSounds = Object.entries(soundUsage)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([title, count]) => `"${title}" — ${count} סרטונים`);

    const videosAnalyzed = engagements.length;

    // ── 3. Tavily: audience research supplement ─────────────────────────────
    const tavilyResults = await tavilySearch(
      `TikTok ${catEn} Israel target audience demographics age interests 2025`,
      5,
    );
    const tavilyCtx = tavilyResults
      .slice(0, 3)
      .map(r => `${r.title || ''}: ${(r.content || '').slice(0, 150)}`)
      .join('\n');

    // ── 4. LLM audience synthesis ───────────────────────────────────────────
    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 900,
      prompt: `אתה מומחה TikTok ו-growth marketing לעסקים קטנים ישראלים. המשימה: לבנות פרופיל קהל יעד מדויק ש-${name} יוכל להשתמש בו לכל פיסת תוכן.

עסק: "${name}" | תחום: ${category} | עיר: ${city}

=== נתוני TikTok אמיתיים מ-${videosAnalyzed} סרטוני סקטור ===
• engagement ממוצע בסקטור: ${(avgEng * 100).toFixed(1)}%
• שעות שיא פעילות (שעון ישראל): ${topHours.join(', ') || 'לא זוהו'}
• hashtags עם highest engagement: ${topHashtags.slice(0, 6).join(' | ') || 'לא זוהו'}
• sounds פופולריים: ${topSounds.slice(0, 3).join(' | ') || 'לא זוהו'}

=== מחקר קהל מהאינטרנט ===
${tavilyCtx || 'לא נמצא מידע ספציפי'}

הנחיות:
- hooks_that_work: 3 משפטי פתיחה שפועלים על הקהל הספציפי הזה (לא גנריים — ספציפיים לסקטור ולכאב)
- growth_strategy_30d: 4 שלבים קונקרטיים עם שמות סוגי תוכן ספציפיים
- pain_points: כאבים ספציפיים שמניעים אנשים לחפש את ${category} ב-TikTok

JSON בלבד:
{
  "primary_audience": {
    "age_range": "X-Y",
    "gender_skew": "נשי X% / גברי Y%",
    "interests": ["עד 4 תחומי עניין ספציפיים לסקטור"],
    "pain_points": ["כאב 1 — ספציפי וקונקרטי", "כאב 2", "כאב 3"],
    "why_they_follow": "סיבה פסיכולוגית עמוקה — למה הקהל הזה צורך תוכן ${category} ב-TikTok"
  },
  "secondary_audience": {
    "age_range": "X-Y",
    "description": "מי הם ומה הם מחפשים"
  },
  "best_posting_windows": [
    { "days": "ראשון-חמישי", "time": "19:00-21:00", "reason": "סיבה ספציפית לסקטור זה" },
    { "days": "שישי-שבת", "time": "11:00-13:00", "reason": "סיבה ספציפית" }
  ],
  "hooks_that_work": [
    "Hook 1 — ספציפי לכאב של הקהל",
    "Hook 2 — שאלה מחדדת",
    "Hook 3 — עובדה מפתיעה"
  ],
  "content_to_avoid": "מה הקהל הזה מדלג עליו — ספציפי",
  "growth_strategy_30d": "שבוע 1: [מה לעשות] → שבוע 2: [מה לעשות] → שבוע 3-4: [scaling] — כל שלב עם סוג תוכן ספציפי"
}`,
      response_json_schema: { type: 'object' },
    });

    if (!result?.primary_audience) {
      setLastRun(businessProfileId, 'tiktokAudienceAgent');
      await writeAutomationLog('tiktokAudienceAgent', businessProfileId, startTime, 0);
      return res.json({ signals_created: 0, note: 'LLM returned no audience data' });
    }

    // ── 5. Dedup + save MarketSignal ────────────────────────────────────────
    const existing = await prisma.marketSignal.findFirst({
      where: {
        linked_business: businessProfileId,
        category: 'tiktok_audience',
        detected_at: { gte: new Date(Date.now() - 48 * 3600000).toISOString() },
      },
    });

    let created = 0;
    if (!existing) {
      const pa = result.primary_audience;
      await prisma.marketSignal.create({
        data: {
          linked_business:    businessProfileId,
          summary:            `TikTok קהל יעד: ${pa.age_range}, ${pa.gender_skew} | שעות שיא: ${topHours.slice(0, 2).join(', ')}`,
          category:           'tiktok_audience',
          impact_level:       'medium',
          confidence:         70,
          recommended_action: result.growth_strategy_30d || 'עקוב אחר אסטרטגיית TikTok 30 ימים',
          source_description: JSON.stringify({
            action_type:           'tiktok_audience',
            primary_audience:      result.primary_audience,
            secondary_audience:    result.secondary_audience,
            best_posting_windows:  result.best_posting_windows,
            hooks_that_work:       result.hooks_that_work,
            content_to_avoid:      result.content_to_avoid,
            growth_strategy_30d:   result.growth_strategy_30d,
            top_hashtags:          topHashtags,
            top_sounds:            topSounds,
            best_posting_hours_il: topHours,
            videos_analyzed:       videosAnalyzed,
            avg_sector_engagement: `${(avgEng * 100).toFixed(1)}%`,
          }),
          detected_at: new Date().toISOString(),
          is_read:      false,
          is_dismissed: false,
        },
      });
      created++;
    }

    setLastRun(businessProfileId, 'tiktokAudienceAgent');
    await writeAutomationLog('tiktokAudienceAgent', businessProfileId, startTime, created);
    console.log(`tiktokAudienceAgent done: ${created} signals | ${videosAnalyzed} videos analyzed`);

    return res.json({
      signals_created:       created,
      videos_analyzed:       videosAnalyzed,
      avg_engagement_pct:    (avgEng * 100).toFixed(1),
      best_posting_hours_il: topHours,
    });

  } catch (err: any) {
    console.error('[tiktokAudienceAgent] error:', err.message);
    await writeAutomationLog('tiktokAudienceAgent', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
