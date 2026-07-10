/**
 * detectViralSignals — Agent that tracks viral content and rising hashtags
 * across TikTok, Instagram, YouTube Shorts, and Israeli social communities.
 *
 * Goal: detect content formats + topics going viral RIGHT NOW in the business's
 * niche — so the business can ride the wave within hours, not days.
 *
 * Outputs:
 *   • MarketSignal with category="viral_signal", source_description includes:
 *     - viral_platform, hashtags, content_format, estimated_views_velocity
 *   • Each signal includes a ready-to-use content template
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { callAIJson } from '../../lib/ai_router';
import { writeAutomationLog } from '../../lib/automationLog';
import { tavilyAdvancedSearch, isTavilyRateLimited } from '../../lib/tavily';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { shouldSkipAgent, setLastRun, cacheGet, cacheSet, TTL } from '../../lib/agentCache';
import { loadCheckpoint, saveCheckpoint, filterNewIds } from '../../lib/trendMemory';
import { sendOwnerWhatsAppNotification } from '../../services/execution/WhatsAppOwnerNotifier';

const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Dynamically generates TikTok hashtags for any business category using AI
async function generateViralHashtags(category: string, services: string): Promise<string[]> {
  try {
    const result = await callAIJson<{ hashtags: string[] }>('classify_sector',
      `Generate 4-6 TikTok hashtags (without the # prefix) for a business in this category.
Category: "${category}"
Services: "${services || 'not specified'}"

Rules:
- Mix Hebrew and English hashtags (both perform well on TikTok Israel)
- Include at least one Israel-specific hashtag (e.g., "food_israel", "fitness_israel")
- Be specific to this business type, not generic
- No spaces in hashtags — use underscores if needed

Return ONLY valid JSON: {"hashtags": ["tag1","tag2","tag3","tag4","tag5"]}`
    );
    const tags = result?.hashtags;
    if (Array.isArray(tags) && tags.length >= 2) return tags.slice(0, 6);
  } catch (e: any) {
    console.warn('[detectViralSignals] AI hashtag generation failed:', e.message);
  }
  // Fallback: derive from category string
  return [category.replace(/\s+/g, '_'), `${category.replace(/\s+/g, '')}_israel`, 'israel'];
}

function buildViralQueries(category: string, city: string): string[] {
  return [
    // TikTok viral content
    `TikTok viral video ${category} Israel this week trending`,
    `TikTok hashtag #${category.replace(/\s/g, '')} Israel viral ${new Date().getFullYear()}`,
    // Instagram Reels
    `Instagram Reels viral ${category} Israel trending now`,
    `Instagram trending hashtag ${category} this week Israel`,
    // YouTube Shorts
    `YouTube Shorts viral ${category} Israel ${new Date().getFullYear()} trending`,
    // Israeli social/news coverage of viral content
    `${category} ${city} ויראלי טיקטוק אינסטגרם ${new Date().getFullYear()}`,
    `${category} ישראל ויראלי רשתות חברתיות השבוע`,
    // Content going viral in niche (Hebrew)
    `פוסט ויראלי ${category} ${city} אינסטגרם טיקטוק`,
    // Cross-platform signals
    `"${category}" Israel social media viral challenge trend`,
  ];
}

export async function detectViralSignals(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  if (shouldSkipAgent(businessProfileId, 'detectViralSignals', MIN_INTERVAL_MS)) {
    return res.json({ signals_created: 0, skipped: true, reason: 'ran_recently' });
  }

  // Load persistent checkpoint (survives server restarts)
  const trendCp = await loadCheckpoint('detectViralSignals', businessProfileId, 'tiktok', 'IL');

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    const { name, category, city, relevant_services = '', tone_preference = 'friendly' } = profile;

    // ── Source 1: Apify TikTok hashtag scraper (real data) ──────────────────
    // Dynamically generate TikTok hashtags from the business category using AI
    const sectorHashtags = await generateViralHashtags(category, relevant_services);
    let apifyItems: any[] = [];

    if (hasApifyKey()) {
      // Reuse cached results from tiktokSectorTrendAgent if run recently (same business + hashtags)
      const apifyCacheKey = `apify_tiktok_hashtags:${businessProfileId}:${sectorHashtags.slice(0, 3).join(',')}`;
      const cachedApify = cacheGet<any[]>(apifyCacheKey);
      if (cachedApify) {
        apifyItems = cachedApify;
        console.log(`[detectViralSignals] Apify cache hit: ${apifyItems.length} videos`);
      } else {
      try {
        apifyItems = await runApifyActor(
          'clockworks~tiktok-hashtag-scraper',
          {
            hashtags:             sectorHashtags.slice(0, 4),
            resultsPerPage:       20,
            maxItems:             20,
            shouldDownloadVideos: false,
            shouldDownloadCovers: false,
          },
          90_000,
          20,
        );
        if (apifyItems.length > 0) cacheSet(apifyCacheKey, apifyItems, TTL.API_RESULT);
        // Filter to only NEW videos not yet processed
        const rawIds = apifyItems.map((v: any) => v.id || v.videoId).filter(Boolean);
        const newIds = filterNewIds(rawIds, trendCp);
        apifyItems = apifyItems.filter((v: any) => newIds.includes(v.id || v.videoId));
        console.log(`[detectViralSignals] Apify TikTok: ${apifyItems.length} NEW videos (${rawIds.length - apifyItems.length} already seen)`);
      } catch (e: any) {
        console.warn('[detectViralSignals] Apify failed:', e.message);
      }
      } // end else (no cache)
    }

    // ── Source 2: Tavily web search fallback (only if Apify returned nothing) ─
    let tavilyContext = '';
    let resultsScanned = apifyItems.length;
    if (apifyItems.length === 0 && !isTavilyRateLimited()) {
      const queries = buildViralQueries(category, city);
      const rawResults = await Promise.all(queries.slice(0, 5).map(q => tavilyAdvancedSearch(q, 4, 7)));
      const allResults = rawResults.flat();
      const seen = new Set<string>();
      const unique = allResults.filter(r => {
        if (!r.url || seen.has(r.url)) return false;
        seen.add(r.url);
        return true;
      });
      resultsScanned = unique.length;
      tavilyContext = unique.slice(0, 15)
        .map(r => `[${r.url}]\n${(r.content || r.title || '').slice(0, 250)}`)
        .join('\n---\n');
      console.log(`[detectViralSignals] Tavily fallback: ${unique.length} results`);
    }

    // Skip entirely if no real data — don't let LLM hallucinate trends
    if (apifyItems.length === 0 && !tavilyContext) {
      await writeAutomationLog('detectViralSignals', businessProfileId, startTime, 0);
      return res.json({ signals_created: 0, results_scanned: 0, note: 'No data sources available (Apify not set, Tavily rate-limited)' });
    }

    // ── Build context for LLM ────────────────────────────────────────────────
    // Strip lone surrogates from TikTok text (prevents Anthropic 400 "no low surrogate")
    const sanitize = (s: string, maxLen = 150): string => {
      if (!s) return '';
      let out = '';
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c >= 0xD800 && c <= 0xDBFF) {
          const next = s.charCodeAt(i + 1);
          if (next >= 0xDC00 && next <= 0xDFFF) { out += s[i] + s[i + 1]; i++; }
          // else lone high surrogate → drop
        } else if (c >= 0xDC00 && c <= 0xDFFF) {
          // lone low surrogate → drop
        } else {
          out += s[i];
        }
      }
      return out.slice(0, maxLen).trim();
    };

    let context = '';
    if (apifyItems.length > 0) {
      // Real TikTok data: include video metrics for grounding
      context = '=== TikTok Data (Apify — real engagement metrics) ===\n' +
        apifyItems.slice(0, 20).map(v => {
          const plays    = v.playCount || v.plays || 0;
          const likes    = v.diggCount || v.likes || 0;
          const comments = v.commentCount || v.comments || 0;
          const desc     = sanitize(v.text || v.desc || v.description || '', 150);
          const hashtags = (v.hashtags || []).map((h: any) => `#${sanitize(h.name || h, 40)}`).join(' ');
          return `plays:${plays} likes:${likes} comments:${comments} | "${desc}" ${hashtags}`;
        }).join('\n');
    } else {
      context = '=== Web Search Results (Tavily — articles about trends) ===\n' + tavilyContext;
    }

    // ── AI viral analysis ────────────────────────────────────────────────────
    const dataSourceLabel = apifyItems.length > 0
      ? `REAL TikTok data from Apify (${apifyItems.length} videos with actual play/like counts)`
      : 'web search results (Tavily — less reliable)';

    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 1200,
      prompt: `You are a social media virality expert. Analyze what is going viral right now and how the business can leverage it.
Return ONLY valid JSON. ALL string values must be in Hebrew.

Business: "${name}" — ${category} in ${city}
Services: ${relevant_services || 'not specified'}
Tone: ${tone_preference}
Data source: ${dataSourceLabel}

${context.slice(0, 3500)}

CRITICAL RULES:
• ONLY report signals backed by specific numbers or URLs from the data above
• If the data shows a video with high plays/likes — cite those exact numbers
• Do NOT invent or extrapolate signals not present in the data
• The platform must be clear (TikTok / Instagram / YouTube)
• The format must be specific (Reel / Story / Short / Post)
• ready_to_post_text — complete text in Hebrew, ready to copy and publish

Return ONLY valid JSON:
{"signals":[{
  "title": "שם הסיגנל הויראלי — עד 6 מילים",
  "description": "מה הולך ויראלי ולמה — עד 12 מילה",
  "platform": "tiktok|instagram|youtube|multiple",
  "content_format": "reel|story|short|post|challenge",
  "hashtags": ["#tag1","#tag2","#tag3"],
  "velocity": "exploding|fast|steady",
  "window_hours": 24,
  "evidence_url": "URL ספציפי מהנתונים",
  "ready_to_post_text": "טקסט פוסט מוכן בעברית עם אמוג'י ו-hashtags — עד 80 מילה",
  "visual_direction": "תיאור קצר מה להצלם — עד 8 מילה",
  "relevance": "high|medium",
  "confidence": 50-95
}]}`,
      response_json_schema: { type: 'object' },
    });

    const rawSignals: any[] = result?.signals || [];
    const validSignals = rawSignals.filter(s => s.title && s.platform && s.evidence_url && s.relevance !== 'low');

    // ── Save signals ─────────────────────────────────────────────────────────
    const existing = await prisma.marketSignal.findMany({
      where: { linked_business: businessProfileId, category: 'viral_signal' },
      select: { summary: true },
    });
    const existingNames = new Set(existing.map(s => s.summary));

    let created = 0;
    for (const signal of validSignals) {
      const summaryKey = `ויראלי: ${signal.title}`;
      if (existingNames.has(summaryKey)) continue;

      const meta = JSON.stringify({
        action_type: 'social_post',
        action_label: `צור תוכן: ${signal.content_format} ב-${signal.platform}`,
        platform: signal.platform,
        content_format: signal.content_format,
        hashtags: signal.hashtags,
        velocity: signal.velocity,
        window_hours: signal.window_hours,
        ready_to_post_text: signal.ready_to_post_text,
        visual_direction: signal.visual_direction,
        prefilled_text: signal.ready_to_post_text,
        is_viral_signal: true,
        time_minutes: 20,
      });

      await prisma.marketSignal.create({
        data: {
          linked_business: businessProfileId,
          summary: summaryKey,
          impact_level: signal.velocity === 'exploding' ? 'high' : 'medium',
          category: 'viral_signal',
          recommended_action: `פרסם ${signal.content_format} ב-${signal.platform} תוך ${signal.window_hours} שעות`,
          confidence: signal.confidence || 70,
          source_urls: signal.evidence_url || '',
          source_description: meta,
          is_read: false,
          detected_at: new Date().toISOString(),
        },
      });

      existingNames.add(summaryKey);
      created++;
    }

    // Save checkpoint: mark all processed IDs/URLs as seen
    apifyItems.forEach((v: any) => {
      const id = v.id || v.videoId;
      if (id) trendCp.scannedIds.add(id);
    });
    await saveCheckpoint(trendCp, { signals_created: created, scanned_at: new Date().toISOString() });

    // Send WhatsApp for the first exploding viral signal (if any)
    const explodingSignal = validSignals.find(s => s.velocity === 'exploding');
    if (explodingSignal && created > 0) {
      sendOwnerWhatsAppNotification({
        businessProfileId,
        actionDescription: `🔥 תוכן ויראלי מתפוצץ ב-${explodingSignal.platform}: ${explodingSignal.title} — חלון ${explodingSignal.window_hours} שעות`,
        agentName: 'זיהוי סיגנלים ויראליים',
      }).catch(() => {});
    }

    setLastRun(businessProfileId, 'detectViralSignals');
    await writeAutomationLog('detectViralSignals', businessProfileId, startTime, created);

    return res.json({
      signals_created: created,
      results_scanned: resultsScanned,
      exploding: validSignals.filter(s => s.velocity === 'exploding').length,
      platforms: [...new Set(validSignals.map(s => s.platform))],
    });

  } catch (err: any) {
    console.error('[detectViralSignals] error:', err.message);
    await writeAutomationLog('detectViralSignals', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
