/**
 * instagramTrendAgent — Deep Instagram Reels & hashtag trend scanner.
 *
 * Scans Instagram for rising content patterns in the business sector —
 * both in the US (leading indicator) and in Israel.
 *
 * Universal: hashtags are generated dynamically by Claude Haiku from the
 * business profile — no hardcoded sector maps, works for any business type.
 *
 * Sources (priority order):
 *   1. Apify instagram-hashtag-scraper — real engagement metrics (saves, reach, likes)
 *   2. Tavily web search — articles + scraped IG content as fallback
 *
 * Memory: checkpoint stores Apify post IDs + Tavily URLs already seen.
 *   Next run only processes NEW content — zero wasted tokens.
 *
 * Output:
 *   • MarketSignal with category='instagram_trend'
 *   • platform_trend record (global trend store)
 *
 * Schedule: every 24h
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { callAIJson } from '../../lib/ai_router';
import { tavilyAdvancedSearch } from '../../lib/tavily';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { writeAutomationLog } from '../../lib/automationLog';
import { cacheGet, cacheSet, TTL } from '../../lib/agentCache';
import {
  loadCheckpoint, saveCheckpoint, shouldSkipByTime,
  filterNewIds, filterNewUrls,
} from '../../lib/trendMemory';

const MIN_INTERVAL = 20 * 60 * 60 * 1000; // 20h

// ── Hashtag generation (universal — no hardcoded maps) ────────────────────────
// Claude Haiku generates Instagram-appropriate hashtags for any business sector.

async function generateHashtags(
  category: string,
  services: string,
  region: string,
): Promise<string[]> {
  const cacheKey = `ig_hashtags:${category}:${region}`;
  const cached = cacheGet<string[]>(cacheKey);
  if (cached) return cached;

  const country = region === 'US' ? 'United States' : 'Israel';
  const result = await callAIJson<{ hashtags: string[] }>('classify_sector',
    `Generate 8 Instagram hashtags for a business with:
- Category: "${category}"
- Services/products: "${services || category}"
- Country: ${country}

Rules:
• Mix Hebrew + English hashtags (for Israel region, include Hebrew; for US, mostly English)
• Focus on hashtags customers use when looking for this type of business
• Include 2-3 niche service-specific hashtags and 2-3 broader category hashtags
• No # prefix in your response
• Return ONLY valid JSON: {"hashtags": ["tag1", "tag2", ...]}`
  ).catch(() => ({ hashtags: [category.replace(/\s+/g, ''), 'israel', 'smallbusiness'] }));

  const tags = (result.hashtags || []).filter(Boolean).slice(0, 8);
  cacheSet(cacheKey, tags, TTL.API_RESULT); // cache 4h
  return tags;
}

// ── Apify Instagram hashtag scraper ───────────────────────────────────────────

interface IGPost {
  id: string;
  url: string;
  displayUrl: string;  // thumbnail
  caption: string;
  likes: number;
  comments: number;
  saves?: number;
  timestamp: number;
  hashtags: string[];
  locationName?: string;
}

async function apifyInstagramHashtags(
  hashtags: string[],
  maxItems = 20,
): Promise<IGPost[]> {
  if (!hasApifyKey()) return [];

  const cacheKey = `apify_ig_hashtags:${hashtags.slice(0, 3).join(',')}`;
  const cached = cacheGet<IGPost[]>(cacheKey);
  if (cached) { console.log('[instagramTrendAgent] Apify cache hit'); return cached; }

  try {
    const results = await runApifyActor(
      'apify/instagram-hashtag-scraper',
      {
        hashtags:     hashtags.slice(0, 5),
        resultsLimit: maxItems,
      },
      90_000,
      maxItems,
    );

    const posts: IGPost[] = results
      .filter((r: any) => r.id && (r.likesCount || r.likes) > 50)
      .map((r: any) => ({
        id:          r.id,
        url:         r.url || r.shortCode ? `https://instagram.com/p/${r.shortCode}` : '',
        displayUrl:  r.displayUrl || r.thumbnailUrl || r.imageUrl || '',
        caption:     (r.caption || r.alt || '').slice(0, 250),
        likes:       r.likesCount || r.likes || 0,
        comments:    r.commentsCount || r.comments || 0,
        saves:       r.savesCount || 0,
        timestamp:   r.timestamp ? new Date(r.timestamp).getTime() / 1000 : 0,
        hashtags:    (r.hashtags || []).map((h: any) => h.name || h).slice(0, 8),
        locationName: r.locationName || '',
      }));

    if (posts.length > 0) cacheSet(cacheKey, posts, TTL.API_RESULT);
    return posts;
  } catch (err: any) {
    console.warn(`[instagramTrendAgent] Apify failed: ${err.message}`);
    return [];
  }
}

// ── Tavily fallback ───────────────────────────────────────────────────────────

async function tavilyInstagramSearch(
  category: string,
  hashtags: string[],
  country: string,
): Promise<Array<{ url: string; content: string; imageUrl?: string }>> {
  const year = new Date().getFullYear();
  const queries = [
    `Instagram Reels trending ${category} ${country} ${year}`,
    `Instagram hashtag #${hashtags[0]?.replace(/\s+/g, '')} trending ${country} ${year}`,
    `Instagram ${category} ${country} ויראלי מגמה רילס ${year}`,
  ];

  const results = (
    await Promise.all(queries.map(q => tavilyAdvancedSearch(q, 3).catch(() => [])))
  ).flat();

  const seen = new Set<string>();
  return results
    .filter(r => { if (!r.url || seen.has(r.url)) return false; seen.add(r.url); return true; })
    .slice(0, 12)
    .map(r => ({ url: r.url, content: (r.content || r.title || '').slice(0, 300) }));
}

// ── Engagement score ──────────────────────────────────────────────────────────
// Instagram: saves are most predictive of algorithm reach (3x weight vs likes)

function igEngagementScore(post: IGPost): number {
  const total = post.likes + post.comments * 2 + (post.saves || 0) * 3;
  return Math.min(100, Math.round(Math.log10(Math.max(1, total)) * 15));
}

// ── Save platform trend ───────────────────────────────────────────────────────

async function savePlatformTrend(
  name: string,
  region: string,
  evidenceUrls: string[],
  thumbnails: string[],
  sectors: string[],
  businessId: string,
): Promise<string | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO platform_trend
         (id, platform, region, trend_type, trend_name, applicable_sectors,
          stage, evidence_urls, is_us_leading_indicator,
          first_detected_at, last_seen_at, confidence, linked_business, source_agent)
       VALUES (
         gen_random_uuid()::text, 'instagram', $1, 'content_pattern', $2, $3,
         'growing', $4, $5, NOW(), NOW(), 70, $6, 'instagramTrendAgent'
       )
       RETURNING id`,
      region,
      name,
      JSON.stringify(sectors),
      JSON.stringify([...evidenceUrls, ...thumbnails].slice(0, 5)),
      region === 'US',
      businessId,
    );
    return rows?.[0]?.id || null;
  } catch { return null; }
}

// ── Main agent ─────────────────────────────────────────────────────────────────

export async function instagramTrendAgent(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business not found' });

    const { name, category, city, relevant_services = '' } = profile;

    // ── Checkpoint ────────────────────────────────────────────────────────
    const cpIL = await loadCheckpoint('instagramTrendAgent', businessProfileId, 'instagram', 'IL');
    const cpUS = await loadCheckpoint('instagramTrendAgent', businessProfileId, 'instagram', 'US');
    if (shouldSkipByTime(cpIL, MIN_INTERVAL) && shouldSkipByTime(cpUS, MIN_INTERVAL)) {
      return res.json({ signals_created: 0, skipped: true, reason: 'ran_recently' });
    }

    let signalsCreated = 0;

    for (const region of ['IL', 'US'] as const) {
      const cp = region === 'IL' ? cpIL : cpUS;
      if (shouldSkipByTime(cp, MIN_INTERVAL)) continue;

      const country = region === 'IL' ? 'Israel' : 'United States';

      // Generate hashtags dynamically (universal, cached 4h)
      const hashtags = await generateHashtags(category, relevant_services, region);
      console.log(`[instagramTrendAgent] region=${region} hashtags: ${hashtags.slice(0, 4).join(', ')}`);

      // ── Source 1: Apify Instagram scraper ─────────────────────────────
      let igPosts: IGPost[] = [];
      if (hasApifyKey()) {
        const rawPosts = await apifyInstagramHashtags(hashtags, 25);
        const newIds   = filterNewIds(rawPosts.map(p => p.id), cp);
        igPosts = rawPosts
          .filter(p => newIds.includes(p.id))
          .sort((a, b) => igEngagementScore(b) - igEngagementScore(a))
          .slice(0, 15);
        console.log(`[instagramTrendAgent] Apify new posts: ${igPosts.length} of ${rawPosts.length}`);
      }

      // ── Source 2: Tavily fallback ──────────────────────────────────────
      let tavilyResults: Array<{ url: string; content: string }> = [];
      if (igPosts.length === 0) {
        tavilyResults = await tavilyInstagramSearch(category, hashtags, country);
        const newUrls = filterNewUrls(tavilyResults.map(r => r.url), cp);
        tavilyResults = tavilyResults.filter(r => newUrls.includes(r.url));
        console.log(`[instagramTrendAgent] Tavily fallback: ${tavilyResults.length} new results`);
      }

      if (igPosts.length === 0 && tavilyResults.length === 0) {
        await saveCheckpoint(cp, { region, note: 'no_new_content', scanned_at: new Date().toISOString() });
        continue;
      }

      // ── Build AI context ───────────────────────────────────────────────
      let context = '';
      const thumbnails: string[] = [];

      if (igPosts.length > 0) {
        context = '=== Instagram posts (real engagement data from Apify) ===\n' +
          igPosts.map((p, i) => {
            if (p.displayUrl) thumbnails.push(p.displayUrl);
            const score = igEngagementScore(p);
            return `${i + 1}. [score=${score}/100] likes:${p.likes} comments:${p.comments} saves:${p.saves || '?'}\n` +
              `   Caption: "${p.caption.slice(0, 150)}"\n` +
              `   Tags: ${p.hashtags.slice(0, 5).join(' ')} | Location: ${p.locationName || '—'}`;
          }).join('\n\n');
      } else {
        context = '=== Instagram web articles (Tavily) ===\n' +
          tavilyResults.slice(0, 10).map(r => `[${r.url}] ${r.content}`).join('\n---\n');
      }

      // ── AI analysis ───────────────────────────────────────────────────
      const result = await callAIJson<{ trends: any[] }>('page_parsing',
        `You are an Instagram trend analyst for small businesses.
Identify 1-4 rising content patterns and trends on Instagram for this business.

Business: "${name}" — ${category} in ${city}
Country: ${country}
Services: ${relevant_services || 'not specified'}
${region === 'US' ? 'NOTE: US trends — estimate days until they reach Israel (10-45 days).' : ''}

${context.slice(0, 3000)}

Focus on:
• What content FORMAT is getting high saves/engagement (Reels vs Carousels vs Stories)
• What PRODUCTS or SERVICES are being highlighted in trending posts
• What AESTHETIC or VISUAL STYLE is resonating
• What TEXT/CAPTION style is working

Return ONLY valid JSON. ALL string values in Hebrew:
{"trends":[{
  "name": "שם הטרנד — עד 6 מילים",
  "description": "מה עולה ולמה עובד — עד 15 מילה",
  "content_format": "Reels|Carousel|Story|Post",
  "visual_style": "תיאור סגנון ויזואלי — צבעים/פורמט/אווירה",
  "detected_products": ["מוצר/שירות ספציפי שנראה בתוכן"],
  "caption_style": "סגנון הכיתוב שעובד",
  "hashtags_to_use": ["#tag1", "#tag2", "#tag3"],
  "evidence": "ציטוט/URL ספציפי",
  "days_until_israel": 0,
  "action": "מה העסק צריך לצלם עכשיו — ספציפי",
  "urgency": "high|medium",
  "confidence": 60
}]}`
      ).catch(() => ({ trends: [] }));

      const rawTrends: any[] = result?.trends || [];
      const validTrends = rawTrends.filter(t =>
        t.name && t.evidence && (t.confidence || 0) >= 55,
      );

      // Dedup
      const existing = await prisma.marketSignal.findMany({
        where: {
          linked_business: businessProfileId,
          category: 'instagram_trend',
          detected_at: { gte: new Date(Date.now() - 24 * 3600000).toISOString() },
        },
        select: { summary: true },
      });
      const existingNames = new Set(existing.map(s => s.summary));

      for (const trend of validTrends) {
        const prefix = region === 'US' ? '🇺🇸 Instagram US: ' : 'Instagram: ';
        const summaryKey = `${prefix}${trend.name}`;
        if (existingNames.has(summaryKey)) continue;

        const meta = JSON.stringify({
          action_type:             'social_post',
          action_label:            trend.action || trend.name,
          platform:                'instagram',
          region,
          is_us_leading_indicator: region === 'US',
          days_until_israel:       region === 'US' ? (trend.days_until_israel || 14) : 0,
          content_format:          trend.content_format,
          visual_style:            trend.visual_style,
          detected_products:       trend.detected_products || [],
          caption_style:           trend.caption_style,
          hashtags_to_use:         trend.hashtags_to_use || [],
          evidence:                trend.evidence,
          thumbnails:              thumbnails.slice(0, 3),
          source_agent:            'instagramTrendAgent',
        });

        await prisma.marketSignal.create({
          data: {
            linked_business:    businessProfileId,
            summary:            summaryKey,
            impact_level:       trend.urgency === 'high' ? 'high' : 'medium',
            category:           'instagram_trend',
            recommended_action: trend.action || '',
            confidence:         trend.confidence || 65,
            source_urls:        trend.evidence?.startsWith('http') ? trend.evidence : thumbnails[0] || '',
            source_description: meta,
            is_read:            false,
            is_dismissed:       false,
            detected_at:        new Date().toISOString(),
          },
        });

        await savePlatformTrend(
          trend.name, region,
          [trend.evidence].filter(Boolean),
          thumbnails.slice(0, 3),
          [category], businessProfileId,
        );

        existingNames.add(summaryKey);
        signalsCreated++;
      }

      // Update checkpoint with all IDs/URLs processed
      igPosts.forEach(p => cp.scannedIds.add(p.id));
      tavilyResults.forEach(r => cp.scannedUrls.add(r.url));
      await saveCheckpoint(cp, {
        region,
        posts_scanned: igPosts.length + tavilyResults.length,
        trends_saved: signalsCreated,
        scanned_at: new Date().toISOString(),
      });
    }

    await writeAutomationLog('instagramTrendAgent', businessProfileId, startTime, signalsCreated);
    console.log(`[instagramTrendAgent] done: ${signalsCreated} signals`);
    return res.json({ signals_created: signalsCreated });

  } catch (err: any) {
    console.error('[instagramTrendAgent] error:', err.message);
    await writeAutomationLog('instagramTrendAgent', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
