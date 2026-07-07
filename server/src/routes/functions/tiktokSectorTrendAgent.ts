/**
 * tiktokSectorTrendAgent — מזהה טרנדים עולים ב-TikTok ספציפית לסקטור של העסק.
 *
 * ההבדל מה-agents הקיימים:
 *   • analyzeTikTokContent   → מנתח את הסרטונים של העסק עצמו
 *   • detectViralSignals     → מזהה תוכן ויראלי כללי בכל הפלטפורמות
 *   • detectEarlyTrends      → טרנדים כלליים לפני שהם מגיעים לפיק
 *   • tiktokSectorTrendAgent → תבניות תוכן עולות ספציפית לסקטור:
 *       "Before/After של ניקוי פנים מקבל 5x engagement השבוע"
 *       "בתי קפה שמראים את תהליך הכנת הלאטה — 2M+ views ממוצע"
 *
 * מקורות נתונים (לפי סדר עדיפות):
 *   1. Apify TikTok Scraper — hashtag + keyword scraping עם engagement metrics אמיתיים
 *   2. Tavily — גיבוי כשאין Apify, חיפוש תוכן TikTok ספציפי לסקטור
 *
 * פלט לכל טרנד:
 *   • שם תבנית התוכן בעברית
 *   • למה זה עובד בסקטור הזה ספציפית
 *   • ראיה: סרטון/hashtag ספציפי עם מספרים
 *   • script מוכן: hook (3 שניות) + גוף (20-30 שניות) + CTA
 *   • hashtags + שעת פרסום אופטימלית
 *   • חלון הזדמנויות בשעות
 *
 * שמירה: MarketSignal עם category="tiktok_sector_trend"
 * Delta guard: מינימום 8 שעות בין ריצות
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { tavilyAdvancedSearch } from '../../lib/tavily';
import { cacheGet, cacheSet, TTL } from '../../lib/agentCache';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { loadBusinessContext, formatContextForPrompt } from '../../lib/businessContext';
import { loadCheckpoint, saveCheckpoint, shouldSkipByTime, filterNewIds } from '../../lib/trendMemory';

const MIN_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8 שעות

// ─── Sector knowledge (Hebrew → TikTok hashtag sets) ─────────────────────────

const SECTOR_HASHTAGS: Record<string, string[]> = {
  // מסעדות
  'מסעדה':        ['מסעדה', 'אוכל', 'food_israel', 'restaurant_israel', 'שף', 'מנה_חדשה'],
  'סושי':         ['סושי', 'sushi_israel', 'sushi', 'אוכל_יפני', 'מסעדה', 'food_israel'],
  'בר סושי':      ['סושי', 'sushi_israel', 'sushi', 'אוכל_יפני', 'מסעדה', 'food_israel'],
  'סושי בר':      ['סושי', 'sushi_israel', 'sushi', 'אוכל_יפני', 'מסעדה', 'food_israel'],
  'יפני':         ['אוכל_יפני', 'סושי', 'sushi', 'ramen_israel', 'מסעדה'],
  'פיצה':         ['פיצה', 'pizza_israel', 'pizza', 'אוכל', 'food_israel'],
  'המבורגר':      ['המבורגר', 'burger_israel', 'burger', 'אוכל', 'food_israel'],
  'שווארמה':      ['שווארמה', 'shawarma_israel', 'אוכל_רחוב', 'food_israel'],
  'קינוחים':      ['קינוחים', 'dessert_israel', 'עוגות', 'גלידה', 'אוכל'],
  'בר':           ['בר', 'bar_israel', 'קוקטייל', 'נאיטלייף', 'ירושלים'],
  // קפה ומאפייה
  'קפה':          ['קפה', 'cafe_israel', 'לאטה', 'coffee', 'בית_קפה', 'קפה_ישראל'],
  'מאפייה':       ['מאפייה', 'לחם', 'bakery_israel', 'עוגה', 'בצק', 'אפייה'],
  'פטיסרי':       ['פטיסרי', 'עוגות', 'bakery_israel', 'קינוחים', 'אפייה'],
  // כושר ובריאות
  'כושר':         ['כושר', 'fitness_israel', 'אימון', 'gym_israel', 'ספורט', 'workout', 'בריאות'],
  'חדר כושר':     ['כושר', 'fitness_israel', 'אימון', 'gym_israel', 'workout'],
  'יוגה':         ['יוגה', 'yoga_israel', 'מדיטציה', 'wellness', 'בריאות'],
  'פילאטיס':      ['פילאטיס', 'pilates_israel', 'כושר', 'fitness_israel'],
  // יופי וטיפוח
  'יופי':         ['יופי', 'beauty_israel', 'מספרה', 'טיפוח', 'מניקור', 'פדיקור', 'איפור', 'skincare'],
  'מספרה':        ['מספרה', 'haircut_israel', 'שיער', 'beauty_israel', 'איפור'],
  'קוסמטיקה':     ['קוסמטיקה', 'beauty_israel', 'skincare', 'טיפוח', 'פנים'],
  'ציפורניים':    ['מניקור', 'פדיקור', 'nails_israel', 'beauty_israel', 'ציפורניים'],
  // ספא ורווחה
  'ספא':          ['ספא', 'spa_israel', 'עיסוי', 'טיפולי_פנים', 'relax', 'wellness'],
  // קניות
  'חנות':         ['עסק_קטן_ישראל', 'חנות', 'קניות', 'מוצרים', 'shopping_israel'],
  'אופנה':        ['אופנה', 'fashion_israel', 'בגדים', 'shopping_israel', 'סטייל'],
  // בריאות
  'שיניים':       ['שיניים', 'dental_israel', 'חיוך', 'רופא_שיניים'],
  'רפואה':        ['בריאות', 'health_israel', 'רפואה', 'wellness'],
  // חינוך
  'חינוך':        ['חינוך', 'לימודים', 'מורה', 'students_israel', 'קורס'],
  // נדל"ן
  'נדלן':         ['נדלן', 'דירה', 'real_estate_israel', 'בית', 'השקעות'],
  "נדל\"ן":       ['נדלן', 'דירה', 'real_estate_israel', 'בית', 'השקעות'],
  // יין ואלכוהול
  'יין':          ['יין', 'wine_israel', 'יקב', 'בר_יין', 'winery', 'sommelier_israel'],
  'בר יין':       ['יין', 'wine_israel', 'בר_יין', 'winery', 'יקב', 'kosher_wine'],
  'בית יין':      ['יין', 'wine_israel', 'בר_יין', 'winery', 'יקב', 'kosher_wine'],
  'יקב':          ['יקב', 'winery', 'יין', 'wine_israel', 'kosher_wine'],
  'בירה':         ['בירה', 'beer_israel', 'craft_beer_israel', 'ברוארי', 'brewery_israel'],
  'ברוארי':       ['ברוארי', 'brewery_israel', 'craft_beer_israel', 'בירה', 'beer_israel'],
  // אירועים וקייטרינג
  'קייטרינג':     ['קייטרינג', 'catering_israel', 'אירוע', 'event_food', 'אוכל'],
  'אירועים':      ['אירוע', 'event_israel', 'חתונה', 'wedding_israel', 'קייטרינג'],
  // מוזיקה, פסטיבלים ואירועי לילה
  'מוזיקה':       ['מוזיקה', 'music_israel', 'dj_israel', 'festival_israel', 'rave_israel', 'edm', 'techno_israel'],
  'dj':           ['dj_israel', 'edm', 'rave_israel', 'festival_music', 'techno', 'music_israel'],
  'פסטיבל':       ['festival_israel', 'dj_israel', 'edm', 'rave_israel', 'music_israel', 'nightlife'],
  'מועדון':       ['nightlife_israel', 'clubbing', 'dj_israel', 'edm', 'rave_israel', 'party_israel'],
  'הפקה':         ['event_israel', 'festival_israel', 'מוזיקה', 'dj_israel', 'nightlife_israel'],
  // תוספי תזונה וספורט
  'תוספי תזונה':  ['supplements_israel', 'protein_israel', 'preworkout', 'creatine', 'כושר', 'gym_israel'],
  'תזונת ספורט':  ['sports_nutrition', 'protein_israel', 'supplements_israel', 'כושר', 'preworkout'],
  'חלבון':        ['protein_israel', 'supplements_israel', 'whey', 'כושר', 'gym_israel'],
  'קריאטין':      ['creatine', 'supplements_israel', 'protein_israel', 'preworkout', 'כושר'],
  // מזון פרימיום ויבוא
  'מזון פרימיום': ['premium_food', 'wagyu_israel', 'chef_israel', 'מסעדת_שף', 'fine_dining_israel'],
  'בשר פרימיום':  ['wagyu_israel', 'premium_meat', 'שף', 'chef_israel', 'fine_dining_israel'],
  'יבוא מזון':    ['premium_food', 'gourmet_israel', 'chef_israel', 'מסעדת_שף', 'food_import'],
  'טרופל':        ['truffle_israel', 'פטריות_טרופל', 'chef_israel', 'fine_dining_israel', 'gourmet'],
  // פיננסים ומסחר
  'מסחר':         ['trading_il', 'stocks_israel', 'forex_israel', 'crypto_il', 'השקעות'],
  'השקעות':       ['השקעות', 'stocks_israel', 'trading_il', 'finance_israel', 'investment_israel'],
  'קריפטו':       ['crypto_il', 'bitcoin_israel', 'trading_il', 'defi_israel', 'web3_israel'],
  'תעופה':        ['aviation_israel', 'private_jet', 'business_aviation', 'flight', 'luxury_travel'],
  'מטוסים':       ['aviation_israel', 'private_jet', 'business_aviation', 'luxury_travel', 'vip_travel'],
};

// Fuzzy match: if category doesn't match exactly, try prefix/keyword match
function resolveHashtags(category: string, services = ''): string[] {
  // First: check relevant_services for a more specific match (e.g. "יין" beats "בר" → wine hashtags)
  if (services) {
    const serviceLower = services.toLowerCase();
    for (const [key, tags] of Object.entries(SECTOR_HASHTAGS)) {
      if (key.length > 2 && serviceLower.includes(key.toLowerCase())) return tags;
    }
  }
  if (SECTOR_HASHTAGS[category]) return SECTOR_HASHTAGS[category];
  // Try case-insensitive substring match on category
  const lower = category.toLowerCase();
  for (const [key, tags] of Object.entries(SECTOR_HASHTAGS)) {
    if (lower.includes(key) || key.includes(lower)) return tags;
  }
  // Generic food fallback — only if category explicitly mentions food/cooking (not generic "בר")
  const foodKeywords = ['אוכל', 'מנה', 'מסעדה', 'שף', 'בישול', 'קינוח'];
  if (foodKeywords.some(k => lower.includes(k) || category.includes(k))) {
    return ['אוכל', 'food_israel', 'מסעדה', 'restaurant_israel', 'שף'];
  }
  // Final fallback
  return [category, 'israel', 'עסק_קטן_ישראל'];
}

const CAT_EN: Record<string, string> = {
  'מסעדה': 'restaurant', 'קפה': 'cafe', 'מאפייה': 'bakery',
  'כושר': 'fitness gym', 'יופי': 'beauty salon', 'ספא': 'spa',
  'חנות': 'local shop', 'שיניים': 'dental clinic', 'חינוך': 'education', 'נדלן': 'real estate',
};

// ─── Content pattern types (for LLM context) ─────────────────────────────────

const CONTENT_PATTERNS = [
  'Before/After transformation',
  'Day in my life at [business]',
  'Behind the scenes / making-of',
  'Customer reaction / testimonial',
  'Tutorial / how-to',
  'Trending sound + category',
  'Challenge adaptation',
  'Staff / team personality',
  'Product/Service showcase with text overlay',
  'Comparison: us vs competitors',
  'Q&A / myth-busting',
  'Time-lapse of process',
  'Humor / relatable situation',
];

// ─── Apify: TikTok hashtag scraper (with 4h cache) ──────────────────────────

async function apifyTikTokHashtags(hashtags: string[], maxItems = 30): Promise<any[]> {
  if (!hasApifyKey()) return [];

  const cacheKey = `apify_tiktok_hashtags:${hashtags.slice(0, 3).join(',')}`;
  const cached = cacheGet<any[]>(cacheKey);
  if (cached) { console.log('[tiktokSectorTrendAgent] Apify cache hit'); return cached; }

  const results = await runApifyActor(
    'clockworks~tiktok-hashtag-scraper',
    {
      hashtags:              hashtags.slice(0, 5), // max 5 hashtags per run
      resultsPerPage:        maxItems,
      maxItems,
      shouldDownloadVideos:  false,
      shouldDownloadCovers:  false,
    },
    90_000,
    maxItems,
  );

  if (results.length > 0) cacheSet(cacheKey, results, TTL.API_RESULT);
  return results;
}

// ─── Strip lone surrogate code units (causes JSON 400 from Anthropic) ────────
// TikTok descriptions often contain Japanese/emoji with broken UTF-16 surrogates.
function sanitizeText(text: string, maxLen = 200): string {
  if (!text) return '';
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {          // high surrogate
      const next = text.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {  // valid pair → keep both
        out += text[i] + text[i + 1];
        i++;
      }
      // else lone high surrogate → drop
    } else if (c >= 0xDC00 && c <= 0xDFFF) {
      // lone low surrogate → drop
    } else {
      out += text[i];
    }
  }
  return out.slice(0, maxLen).trim();
}

// ─── Compute pattern resonance score per video ───────────────────────────────
//
// Hashtag scraper returns top/popular videos (not necessarily recent).
// Instead of velocity (good for real-time), we use "pattern_score":
//   → measures how much RESONANCE a content pattern has in the sector
//   → log10(plays) × engagement_rate × 100
//   → Rewards: high reach AND high engagement (likes+comments / plays)
//   → A video with 225K plays + 8.3% engagement scores higher than
//      a video with 1M plays + 0.5% engagement
//
// This tells us: "content patterns that actually connect with this audience"

interface VideoMetrics {
  id: string;
  description: string;
  createTime: number;
  plays: number;
  likes: number;
  comments: number;
  shares: number;
  music: string;
  hashtags: string[];
  url: string;
  // computed
  days_old: number;
  plays_per_day: number;
  engagement_rate: number;
  pattern_score: number; // 0-100, resonance = reach × engagement
}

function computeMetrics(raw: any): VideoMetrics | null {
  try {
    const createTime = raw.createTime || raw.createTimestamp || 0;
    const now = Math.floor(Date.now() / 1000);
    const days_old = Math.max(0.5, (now - createTime) / 86400);

    const plays    = raw.stats?.playCount    ?? raw.playCount    ?? 0;
    const likes    = raw.stats?.diggCount    ?? raw.diggCount    ?? raw.stats?.likeCount ?? 0;
    const comments = raw.stats?.commentCount ?? raw.commentCount ?? 0;
    const shares   = raw.stats?.shareCount   ?? raw.shareCount   ?? 0;

    if (plays < 5000) return null; // ignore tiny videos

    const plays_per_day   = plays / days_old;
    const engagement_rate = plays > 0 ? (likes + comments) / plays : 0;

    // pattern_score: log10(plays) × engagement_rate × 100
    // Range: log10(5K)=3.7 × 0.01 × 100 = 3.7 (low) to log10(10M)=7 × 0.15 × 100 = 105 (capped at 100)
    const pattern_score = Math.min(100, Math.round(Math.log10(plays) * engagement_rate * 100));

    const hashtags: string[] = (raw.hashtags || []).map((h: any) => sanitizeText(h.name || h, 50)).filter(Boolean);
    const music = sanitizeText(raw.music?.title || raw.musicMeta?.musicName || '', 100);
    const url = raw.webVideoUrl || raw.shareUrl ||
      `https://tiktok.com/@${raw.authorMeta?.name || 'unknown'}/video/${raw.id}`;

    return {
      id: raw.id || '',
      description: sanitizeText(raw.text || raw.desc || '', 200),
      createTime,
      plays,
      likes,
      comments,
      shares,
      music,
      hashtags,
      url,
      days_old:        Math.round(days_old * 10) / 10,
      plays_per_day:   Math.round(plays_per_day),
      engagement_rate: Math.round(engagement_rate * 1000) / 1000,
      pattern_score,
    };
  } catch { return null; }
}

// ─── Build Tavily queries — profile-aware ────────────────────────────────────

function buildSectorQueries(
  category: string,
  city: string,
  services: string,
  catEn: string,
  customKeywords: string,
): string[] {
  const year = new Date().getFullYear();
  const serviceTerms = (services || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);
  const customTerms  = (customKeywords || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 2);

  return [
    // Hebrew — sector-specific patterns
    `TikTok ${category} ישראל שבוע שעבר ויראלי תוכן ${year}`,
    `${category} טיקטוק מה עובד ישראל מגמה ${year}`,
    // English — sector patterns
    `TikTok trending content format ${catEn} Israel ${year} views`,
    `TikTok ${catEn} Israel viral video format this week`,
    // Service-specific queries (most targeted — based on this business's actual services)
    ...serviceTerms.map(s => `TikTok "${s}" Israel trending ${year} views`),
    // Custom keyword queries (business-specific terms)
    ...customTerms.map(k => `TikTok ${k} Israel content viral`),
    // City-local
    `TikTok ${catEn} ${city} Israel going viral`,
    // Content pattern research
    `best performing TikTok content type ${catEn} small business Israel`,
  ];
}

// ─── Extract trending sounds from sector videos ───────────────────────────────

interface SoundMetrics {
  title: string;
  usage_count: number;
  avg_pattern_score: number;
}

function extractTopSounds(videos: VideoMetrics[]): SoundMetrics[] {
  const soundMap = new Map<string, { total_score: number; count: number }>();
  for (const v of videos) {
    const title = v.music?.trim();
    if (!title || title === '—' || title.length < 3) continue;
    const existing = soundMap.get(title) || { total_score: 0, count: 0 };
    soundMap.set(title, { total_score: existing.total_score + v.pattern_score, count: existing.count + 1 });
  }
  return Array.from(soundMap.entries())
    .map(([title, { total_score, count }]) => ({
      title,
      usage_count: count,
      avg_pattern_score: Math.round(total_score / count),
    }))
    .filter(s => s.usage_count >= 2) // only sounds appearing in 2+ videos
    .sort((a, b) => b.avg_pattern_score - a.avg_pattern_score)
    .slice(0, 5);
}

// ─── Format video data for LLM prompt ────────────────────────────────────────

function formatVideoBlock(videos: VideoMetrics[]): string {
  if (videos.length === 0) return '';
  return videos
    .slice(0, 15)
    .map((v, i) =>
      `${i + 1}. [resonance=${v.pattern_score}/100] "${sanitizeText(v.description, 100)}"\n` +
      `   📊 ${v.plays.toLocaleString()} צפיות | eng ${(v.engagement_rate * 100).toFixed(1)}% | ${v.plays_per_day.toLocaleString()} views/day\n` +
      `   🎵 ${v.music || '—'} | #tags: ${v.hashtags.slice(0, 4).join(' ')} | 🔗 ${v.url}`
    )
    .join('\n\n');
}

// ─── Main agent ───────────────────────────────────────────────────────────────

export async function tiktokSectorTrendAgent(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  // Persistent checkpoint — remembers video IDs across server restarts
  const trendCp = await loadCheckpoint('tiktokSectorTrendAgent', businessProfileId, 'tiktok', 'IL');

  // ── Delta guard: 8h minimum (bypassed with force:true) ───────────────────
  if (!req.body.force && shouldSkipByTime(trendCp, MIN_INTERVAL_MS)) {
    return res.json({ trends_created: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const {
      name,
      category,
      city,
      relevant_services   = '',
      tone_preference     = 'friendly',
      description         = '',
      target_market       = '',
      custom_keywords     = '',
    } = profile;

    const tiktokUrl: string | null     = (profile as any).tiktok_url    || null;
    const tiktokEnabled: boolean       = (profile as any).channels_tiktok_enabled ?? true;

    // Load business memory (rejection patterns + preferences)
    const bizCtx = await loadBusinessContext(businessProfileId);
    const memoryBlock = formatContextForPrompt(bizCtx, 'tiktokSectorTrendAgent');
    const rejectedPatterns: string[] = bizCtx?.rejectedPatterns || [];

    const catEn = CAT_EN[category] || category;
    const sectorHashtags = resolveHashtags(category, relevant_services);
    console.log(`[tiktokSectorTrendAgent] category="${category}" → hashtags: ${sectorHashtags.slice(0, 4).join(', ')}`);

    // ── 1. Apify A: sector hashtag scraping (trend detection) ─────────────
    let videoMetrics: VideoMetrics[] = [];
    let dataSource = 'tavily';

    if (hasApifyKey()) {
      console.log(`[tiktokSectorTrendAgent] Running Apify for hashtags: ${sectorHashtags.slice(0, 3).join(', ')}`);
      const rawVideos = await apifyTikTokHashtags(sectorHashtags, 40);

      // Filter to only NEW videos not yet processed by this agent
      const rawIds = rawVideos.map((v: any) => v.id).filter(Boolean);
      const newIds = filterNewIds(rawIds, trendCp);
      const newRawVideos = rawVideos.filter((v: any) => newIds.includes(v.id));

      videoMetrics = newRawVideos
        .map(computeMetrics)
        .filter((v): v is VideoMetrics => v !== null)
        .filter(v => v.plays > 5000)
        .filter(v => v.pattern_score > 2)
        .sort((a, b) => b.pattern_score - a.pattern_score);

      if (videoMetrics.length > 0) {
        dataSource = 'apify_hashtag';
        console.log(`[tiktokSectorTrendAgent] Apify: ${videoMetrics.length} videos with velocity data`);
      }
    }

    // ── 1b. Apify B: own TikTok profile (non-blocking — only for LLM context) ──
    let ownVideosCtx = '';
    if (hasApifyKey() && tiktokUrl) {
      const username = (tiktokUrl.match(/@([\w.]+)/) || [])[1];
      if (username) {
        const ownVideos = await Promise.race([
          runApifyActor('clockworks~tiktok-profile-scraper', { profiles: [username], resultsPerPage: 10 }, 90_000, 10),
          new Promise<any[]>(r => setTimeout(() => r([]), 45_000)), // 45s soft timeout — don't block LLM
        ]);
        if (ownVideos.length > 0) {
          ownVideosCtx = `\n=== תוכן TikTok קיים של העסק (@${username}) ===\n` +
            ownVideos.slice(0, 6).map((v: any, i: number) => {
              const plays = v.stats?.playCount ?? v.playCount ?? 0;
              const likes = v.stats?.diggCount ?? v.diggCount ?? 0;
              const eng   = plays > 0 ? ((likes / plays) * 100).toFixed(1) : '0';
              const desc  = sanitizeText(v.text || v.desc || '', 80);
              return `${i + 1}. "${desc}" — ${plays.toLocaleString()} צפיות, ${eng}% eng`;
            }).join('\n') +
            '\n(אל תמליץ על תוכן דומה למה שכבר נעשה)';
        }
      }
    }

    // ── 1c. Extract trending sounds from sector videos ────────────────────
    const topSounds = extractTopSounds(videoMetrics);
    const soundBlock = topSounds.length > 0
      ? `\n=== SOUNDS פופולריים בסקטור ===\n${topSounds.map((s, i) =>
          `${i + 1}. "${s.title}" — ${s.usage_count} סרטונים, avg resonance ${s.avg_pattern_score}/100`
        ).join('\n')}`
      : '';

    // ── 2. Tavily — profile-aware queries ─────────────────────────────────
    const tavilyQueries = buildSectorQueries(category, city, relevant_services, catEn, custom_keywords);
    const tavilyResults = (
      await Promise.all(tavilyQueries.slice(0, 6).map(q => tavilyAdvancedSearch(q, 3)))
    ).flat();

    const seenUrls = new Set<string>();
    const uniqueTavily = tavilyResults.filter(r => {
      if (!r.url || seenUrls.has(r.url)) return false;
      seenUrls.add(r.url);
      return true;
    }).slice(0, 12);

    const tavilyContext = uniqueTavily
      .map(r => `[${r.url}]\n${sanitizeText(r.title || '', 100)} — ${sanitizeText(r.content || '', 200)}`)
      .join('\n---\n');

    if (dataSource === 'tavily') dataSource = uniqueTavily.length > 0 ? 'tavily' : 'none';

    // ── 3. Build profile-aware AI prompt ──────────────────────────────────
    const toneMap: Record<string, string> = {
      casual:       'קליל, מצחיק, עם אנרגיה — מתאים לדמוגרפיה צעירה',
      warm:         'חם, אנושי, אמיתי — storytelling',
      professional: 'מקצועי אך נגיש — בונה אמון',
      friendly:     'ידידותי ואנרגטי',
    };
    const toneInstruction = toneMap[tone_preference] || 'ידידותי ואנרגטי';

    // Profile-specific context for LLM
    const profileCtx = [
      description  ? `תיאור העסק: ${description}` : '',
      target_market ? `קהל יעד: ${target_market}` : '',
      relevant_services ? `שירותים/מוצרים עיקריים: ${relevant_services}` : '',
      custom_keywords   ? `מילות מפתח של העסק: ${custom_keywords}` : '',
      tiktokEnabled ? '' : '⚠️ TikTok לא מוגדר כערוץ פעיל — תן המלצות לאופן הפעלה',
    ].filter(Boolean).join('\n');

    const videoBlock = formatVideoBlock(videoMetrics);
    const hasRealData = videoBlock.length > 0;

    const prompt = `You are an expert TikTok analyst for small Israeli businesses in the "${category}" sector.
Task: find 2-4 **rising content patterns** that fit this specific business exactly.

=== Business Profile ===
Name: "${name}" | Category: ${category} | City: ${city}
${profileCtx}
Preferred tone: ${toneInstruction}
${memoryBlock}
CRITICAL — SERVICES LOCK: ONLY generate trends for these exact services this business offers: "${relevant_services || category}".
Do NOT generate trends for services/products this business does NOT sell. If you see sushi trends but the business sells wine — skip them.
${rejectedPatterns.length > 0 ? `NEVER generate trends related to: ${rejectedPatterns.slice(0, 6).join(', ')} (user rejected these before)` : ''}

${ownVideosCtx}

${hasRealData ? `=== Real ENGAGEMENT data from TikTok (sector videos) ===\n${videoBlock}` : ''}
${soundBlock}

${tavilyContext ? `=== TikTok sector content (web research) ===\n${tavilyContext.slice(0, 2500)}` : ''}

=== TikTok content patterns to consider ===
${CONTENT_PATTERNS.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Rules:
• Every script must be tailored specifically to "${name}" — not a generic template
• Incorporate the specific services: ${relevant_services || category}
• Script must be ready to film — what exactly to say/show, not abstract
• opportunity_window_hours — how many hours remain to ride the wave before it goes mainstream

Return ONLY valid JSON. ALL string values must be in Hebrew:
{"trends": [{
  "pattern_name": "content pattern name — up to 5 words",
  "why_it_works_in_sector": "specific explanation for this sector and business — not generic",
  "service_spotlight": "which specific service/product of the business to feature in this video",
  "evidence": {
    "source": "apify_video|tavily_url|observed_pattern",
    "detail": "specific quote/URL/numbers proving the trend",
    "avg_plays_per_day": 0,
    "engagement_rate_pct": 0.0
  },
  "content_script": {
    "hook_3sec": "exact first sentence — what to say/show in the first 3 seconds",
    "body_20sec": "exactly what to show/say in the body — short steps",
    "cta": "what to say in the last 5 seconds",
    "visual_direction": "exactly what to film — short scene description",
    "music_suggestion": "music type / if a specific sound — name it"
  },
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "recommended_sound": "specific sound name/music type recommended for this pattern",
  "best_posting_time": "optimal time and day of week",
  "opportunity_window_hours": 48,
  "velocity": "exploding|fast_rising|steady_rising",
  "estimated_reach_multiplier": 2.5,
  "confidence": 65
}],
"sector_sounds": [{"title": "sound name", "why_use_it": "why to use it in this sector"}]}`;

    const result = await invokeLLM({
      prompt,
      response_json_schema: { type: 'object' },
      model: 'sonnet',
      maxTokens: 1200,
      skipCache: true, // always fresh analysis
    });

    const rawTrends: any[] = result?.trends || [];

    // Filter: only trends with real evidence + confidence + relevant to this business's services
    const serviceKeywords = (relevant_services || category)
      .toLowerCase().split(/[,\s]+/).filter((k: string) => k.length > 2);

    const validTrends = rawTrends.filter(t => {
      if (!t.pattern_name || !t.content_script?.hook_3sec || !t.evidence?.detail) return false;
      if ((t.confidence || 0) < 55) return false;
      // Skip if service_spotlight matches a rejected pattern
      const spotlightText = ((t.service_spotlight || '') + ' ' + (t.pattern_name || '')).toLowerCase();
      if (rejectedPatterns.some((p: string) => p && spotlightText.includes(p.toLowerCase()))) return false;
      // Require trend to be relevant to at least one of the business's actual services
      if (serviceKeywords.length > 0) {
        const trendText = (spotlightText + ' ' + (t.why_it_works_in_sector || '').toLowerCase());
        if (!serviceKeywords.some((k: string) => trendText.includes(k))) return false;
      }
      return true;
    });

    // ── 4. Dedup against existing signals ─────────────────────────────────
    const existing = await prisma.marketSignal.findMany({
      where: {
        linked_business: businessProfileId,
        category: 'tiktok_sector_trend',
        detected_at: { gte: new Date(Date.now() - 48 * 3600000).toISOString() }, // 48h dedup window
      },
      select: { summary: true },
    });
    const existingNames = new Set(existing.map(s => s.summary));

    // ── 5. Save signals ────────────────────────────────────────────────────
    let created = 0;
    for (const trend of validTrends) {
      const summaryKey = `TikTok סקטור: ${trend.pattern_name}`;
      if (existingNames.has(summaryKey)) continue;

      const velocityImpact: Record<string, string> = {
        exploding: 'high',
        fast_rising: 'high',
        steady_rising: 'medium',
      };

      const meta = JSON.stringify({
        action_type:     'tiktok_content',
        action_label:    `צלם עכשיו: ${trend.pattern_name}`,
        pattern_name:    trend.pattern_name,
        service_spotlight: trend.service_spotlight,
        why_it_works:    trend.why_it_works_in_sector,
        evidence:        trend.evidence,
        content_script:  trend.content_script,
        hashtags:        trend.hashtags,
        recommended_sound:           trend.recommended_sound,
        sector_top_sounds:           topSounds,
        best_posting_time:           trend.best_posting_time,
        opportunity_window_hours:    trend.opportunity_window_hours,
        velocity:                    trend.velocity,
        estimated_reach_multiplier:  trend.estimated_reach_multiplier,
        data_source:                 dataSource,
        is_tiktok_sector_trend:      true,
        time_minutes:                30, // estimated filming time
        prefilled_text: [
          trend.content_script.hook_3sec,
          trend.content_script.body_20sec,
          trend.content_script.cta,
          (trend.hashtags || []).join(' '),
        ].filter(Boolean).join('\n\n'),
      });

      await prisma.marketSignal.create({
        data: {
          linked_business:    businessProfileId,
          summary:            summaryKey,
          impact_level:       velocityImpact[trend.velocity] || 'medium',
          category:           'tiktok_sector_trend',
          recommended_action: `${trend.content_script?.hook_3sec || ''} | פרסם ${trend.best_posting_time || 'היום'} | חלון: ${trend.opportunity_window_hours || 48}ש'`,
          confidence:         trend.confidence || 70,
          source_urls:        trend.evidence?.detail?.startsWith('http') ? trend.evidence.detail : '',
          source_description: meta,
          is_read:            false,
          is_dismissed:       false,
          detected_at:        new Date().toISOString(),
        },
      });

      existingNames.add(summaryKey);
      created++;
    }

    // ── 6. ProactiveAlert for "exploding" trends ──────────────────────────
    const explodingTrend = validTrends.find(t => t.velocity === 'exploding');
    if (explodingTrend) {
      const existingAlert = await prisma.proactiveAlert.findFirst({
        where: {
          linked_business: businessProfileId,
          alert_type: 'tiktok_opportunity',
          created_date: { gte: new Date(Date.now() - 24 * 3600000).toISOString() },
        },
      });

      if (!existingAlert) {
        await prisma.proactiveAlert.create({
          data: {
            linked_business:  businessProfileId,
            title:            `🔥 TikTok: ${explodingTrend.pattern_name} — חלון ${explodingTrend.opportunity_window_hours}ש'`,
            description:      explodingTrend.why_it_works_in_sector,
            alert_type:       'tiktok_opportunity',
            priority:         'high',
            is_dismissed:     false,
            is_acted_on:      false,
            suggested_action: JSON.stringify({
              hook:       explodingTrend.content_script?.hook_3sec,
              body:       explodingTrend.content_script?.body_20sec,
              cta:        explodingTrend.content_script?.cta,
              visual:     explodingTrend.content_script?.visual_direction,
              music:      explodingTrend.content_script?.music_suggestion,
              hashtags:   explodingTrend.hashtags,
              post_at:    explodingTrend.best_posting_time,
              window_h:   explodingTrend.opportunity_window_hours,
              evidence:   explodingTrend.evidence?.detail,
              reach_mult: explodingTrend.estimated_reach_multiplier,
            }),
            created_at: new Date().toISOString(),
          },
        });
      }
    }

    // Save checkpoint: persist all processed video IDs
    videoMetrics.forEach(v => trendCp.scannedIds.add(v.id));
    await saveCheckpoint(trendCp, { trends_created: created, scanned_at: new Date().toISOString() });

    await writeAutomationLog('tiktokSectorTrendAgent', businessProfileId, startTime, created);

    return res.json({
      trends_created:     created,
      data_source:        dataSource,
      videos_analyzed:    videoMetrics.length,
      tavily_results:     uniqueTavily.length,
      exploding_count:    validTrends.filter(t => t.velocity === 'exploding').length,
      fast_rising_count:  validTrends.filter(t => t.velocity === 'fast_rising').length,
    });

  } catch (err: any) {
    console.error('[tiktokSectorTrendAgent] error:', err.message);
    await writeAutomationLog('tiktokSectorTrendAgent', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
