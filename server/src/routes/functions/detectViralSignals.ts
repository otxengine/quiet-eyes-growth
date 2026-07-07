/**
 * detectViralSignals — detects viral content RIGHT NOW across local (Israel/Hebrew)
 * and global sources, so the business can ride the wave within hours.
 *
 * Data collection:
 *   • Apify TikTok hashtag scraper  — 8 local/Hebrew hashtags  → local viral signals
 *   • Tavily advanced search        — 8 global/English hashtags → global viral signals
 *
 * Hashtags are generated dynamically by Haiku using the business profile,
 * Google Places metadata, and website text (cached 24h per business).
 *
 * Outputs: MarketSignal category="viral_signal" with scope=local|global,
 * content template (ready_to_post_text), and mixed local+global hashtags.
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { tavilyAdvancedSearch, isTavilyRateLimited } from '../../lib/tavily';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { shouldSkipAgent, setLastRun, cacheGet, cacheSet, TTL } from '../../lib/agentCache';
import { loadCheckpoint, saveCheckpoint, filterNewIds } from '../../lib/trendMemory';
import { getPlaceDetails, EMPTY_PLACE } from '../../lib/googlePlaces';

const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

// ── Website text fetcher ─────────────────────────────────────────────────────

async function fetchWebsiteText(url: string | null): Promise<string> {
  if (!url) return '';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuietEyes/1.0)' },
    });
    clearTimeout(timeout);
    const html = await resp.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 400)
      .trim();
  } catch { return ''; }
}

// ── Hashtag generation — Haiku, cached 24h per business ─────────────────────

async function generateHashtags(
  profile: any,
  websiteText: string,
): Promise<{ local: string[]; global: string[] }> {
  const cacheKey = `hashtags_generated:${profile.id}`;
  const cached = cacheGet<{ local: string[]; global: string[] }>(cacheKey);
  if (cached) return cached;

  const placeDetails = profile.google_place_id
    ? await getPlaceDetails(profile.google_place_id)
    : EMPTY_PLACE;

  const PRICE_LABEL: Record<number, string> = { 1: 'budget', 2: 'moderate', 3: 'upscale', 4: 'luxury' };
  const serves = [
    placeDetails.servesWine && 'wine',
    placeDetails.servesBeer && 'beer',
    placeDetails.servesVegetarianFood && 'vegetarian',
  ].filter(Boolean).join(', ');

  const context = [
    `Business: "${profile.name}" — ${profile.category} in ${profile.city}`,
    profile.relevant_services && `Services: ${profile.relevant_services}`,
    profile.description       && `Description: ${profile.description}`,
    profile.target_market     && `Target market: ${profile.target_market}`,
    profile.custom_keywords   && `Keywords: ${profile.custom_keywords}`,
    placeDetails.editorialSummary && `Google summary: "${placeDetails.editorialSummary}"`,
    placeDetails.types.length     && `Google types: ${placeDetails.types.join(', ')}`,
    placeDetails.priceLevel       && `Price level: ${PRICE_LABEL[placeDetails.priceLevel] || placeDetails.priceLevel}`,
    serves                        && `Serves: ${serves}`,
    websiteText                   && `Website: "${websiteText}"`,
  ].filter(Boolean).join('\n');

  const fallback = {
    local:  [`#${profile.category.replace(/\s+/g, '_')}`, '#food_israel', '#israel', '#תלאביב'],
    global: [`#${profile.category.replace(/\s+/g, '')}`,  '#foodie', '#trending', '#viral'],
  };

  try {
    const result = await invokeLLM({
      model: 'haiku',
      maxTokens: 200,
      prompt: `Generate TikTok/Instagram hashtags for this Israeli business.
${context}

Return ONLY valid JSON:
{
  "local": ["#hebrewTag1",...],
  "global": ["#englishTag1",...]
}

Rules:
- local: 8 tags — Hebrew words and Israel-specific (e.g. #ריזוטו #food_israel #תלאביב)
- global: 8 tags — English, internationally searchable (e.g. #italianfood #woodfiredpizza)
- Both: specific to THIS business's exact dishes/style — no generic tags like #food or #restaurant`,
      response_json_schema: { type: 'object' },
    });

    const local  = Array.isArray(result?.local)  && result.local.length  ? result.local.slice(0, 8)  : fallback.local;
    const global = Array.isArray(result?.global) && result.global.length ? result.global.slice(0, 8) : fallback.global;
    const hashtags = { local, global };
    cacheSet(cacheKey, hashtags, TTL.GOOGLE_PLACES); // 24h — business profile data is stable
    return hashtags;
  } catch {
    return fallback;
  }
}

// ── Surrogate sanitizer — prevents Anthropic 400 on TikTok text ─────────────

function sanitize(s: string, maxLen = 150): string {
  if (!s) return '';
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) { out += s[i] + s[i + 1]; i++; }
    } else if (c >= 0xDC00 && c <= 0xDFFF) {
      // lone low surrogate → drop
    } else {
      out += s[i];
    }
  }
  return out.slice(0, maxLen).trim();
}

// ── Main agent ───────────────────────────────────────────────────────────────

export async function detectViralSignals(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  if (shouldSkipAgent(businessProfileId, 'detectViralSignals', MIN_INTERVAL_MS)) {
    return res.json({ signals_created: 0, skipped: true, reason: 'ran_recently' });
  }

  const trendCp = await loadCheckpoint('detectViralSignals', businessProfileId, 'tiktok', 'IL');
  const startTime = new Date().toISOString();

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    const { name, category, city, relevant_services = '', tone_preference = 'friendly', plan_id } = profile as any;

    // AC3: Growth+ gate
    const VIRAL_PLANS = new Set(['growth', 'pro', 'enterprise']);
    if (!VIRAL_PLANS.has(plan_id ?? '')) {
      return res.json({ signals_created: 0, skipped: true, reason: 'plan_not_eligible' });
    }

    // ── Generate dynamic hashtags (Haiku, cached 24h) ────────────────────────
    const websiteText = await fetchWebsiteText((profile as any).website_url);
    const { local: localHashtags, global: globalHashtags } = await generateHashtags(profile, websiteText);

    console.log(`[detectViralSignals] local: ${localHashtags.join(' ')} | global: ${globalHashtags.join(' ')}`);

    // ── Source 1: Apify — local/Hebrew TikTok hashtags ───────────────────────
    let apifyItems: any[] = [];
    if (hasApifyKey()) {
      const apifyCacheKey = `apify_tiktok_hashtags:${localHashtags.slice(0, 3).join(',')}`;
      const cachedApify = cacheGet<any[]>(apifyCacheKey);
      if (cachedApify) {
        apifyItems = cachedApify;
        console.log(`[detectViralSignals] Apify cache hit: ${apifyItems.length} videos`);
      } else {
        try {
          apifyItems = await runApifyActor(
            'clockworks~tiktok-hashtag-scraper',
            {
              hashtags:             localHashtags.slice(0, 8).map((h: string) => h.replace(/^#/, '')),
              resultsPerPage:       20,
              maxItems:             20,
              shouldDownloadVideos: false,
              shouldDownloadCovers: false,
            },
            90_000,
            20,
          );
          if (apifyItems.length > 0) cacheSet(apifyCacheKey, apifyItems, TTL.API_RESULT);
        } catch (e: any) {
          console.warn('[detectViralSignals] Apify failed:', e.message);
        }
      }
      // AC2: dedup regardless of cache vs fresh
      const rawIds = apifyItems.map((v: any) => v.id || v.videoId).filter(Boolean);
      const newIds = filterNewIds(rawIds, trendCp);
      apifyItems = apifyItems.filter((v: any) => newIds.includes(v.id || v.videoId));
      console.log(`[detectViralSignals] after dedup: ${apifyItems.length} NEW local videos`);
    }

    // ── Source 2: Tavily — global/English hashtags (always runs) ────────────
    let tavilyContext = '';
    let tavilyCount = 0;
    if (!isTavilyRateLimited()) {
      const globalQueries = globalHashtags
        .slice(0, 4)
        .map((tag: string) => `TikTok Instagram viral ${tag.replace(/^#/, '')} trending 2025 content format`);
      const rawResults = await Promise.all(globalQueries.map((q: string) => tavilyAdvancedSearch(q, 3)));
      const seen = new Set<string>();
      const unique = rawResults.flat().filter(r => {
        if (!r.url || seen.has(r.url)) return false;
        seen.add(r.url);
        return true;
      });
      tavilyCount = unique.length;
      tavilyContext = unique
        .slice(0, 12)
        .map(r => `[${r.url}]\n${(r.content || r.title || '').slice(0, 200)}`)
        .join('\n---\n');
      console.log(`[detectViralSignals] Tavily global: ${unique.length} results`);
    }

    if (apifyItems.length === 0 && !tavilyContext) {
      await writeAutomationLog('detectViralSignals', businessProfileId, startTime, 0);
      return res.json({ signals_created: 0, results_scanned: 0, note: 'No data sources available' });
    }

    // ── Build LLM context — two labelled sections ────────────────────────────
    let context = '';
    if (apifyItems.length > 0) {
      context += `=== TikTok Local (Israel) — hashtags: ${localHashtags.slice(0, 4).join(' ')} ===\n`;
      context += apifyItems.slice(0, 20).map((v: any) => {
        const plays    = v.playCount    || v.plays    || 0;
        const likes    = v.diggCount   || v.likes    || 0;
        const comments = v.commentCount || v.comments || 0;
        const desc     = sanitize(v.text || v.desc || v.description || '', 150);
        const tags     = (v.hashtags || []).map((h: any) => `#${sanitize(h.name || h, 40)}`).join(' ');
        return `plays:${plays} likes:${likes} comments:${comments} | "${desc}" ${tags}`;
      }).join('\n');
      context += '\n\n';
    }
    if (tavilyContext) {
      context += `=== Global Trends — hashtags: ${globalHashtags.slice(0, 4).join(' ')} ===\n`;
      context += tavilyContext;
    }

    // ── LLM viral analysis ───────────────────────────────────────────────────
    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 1400,
      prompt: `You are a social media virality expert. Analyze viral content from two sources and identify signals for the business.
Return ONLY valid JSON. ALL string values must be in Hebrew EXCEPT evidence_url.

Business: "${name}" — ${category} in ${city}
Services: ${relevant_services || 'not specified'}
Tone: ${tone_preference}

${context.slice(0, 3500)}

CRITICAL RULES:
• Local signals (from TikTok Israel section): must cite actual play/like numbers from the data
• Global signals (from Global Trends section): identify the viral FORMAT or STYLE — suggest how to adapt it locally in Hebrew
• Do NOT invent signals not backed by the data above
• scope "local" = found in Israeli TikTok data, scope "global" = found in global trends

Return ONLY valid JSON:
{"signals":[{
  "title": "שם הסיגנל — עד 6 מילים",
  "description": "מה הולך ויראלי ולמה — עד 12 מילה",
  "scope": "local|global",
  "platform": "tiktok|instagram|youtube|multiple",
  "content_format": "reel|story|short|post|challenge",
  "hashtags": ["#localTag1","#localTag2","#globalTag1","#globalTag2"],
  "velocity": "exploding|fast|steady",
  "window_hours": 24,
  "evidence_url": "specific URL from the data",
  "ready_to_post_text": "טקסט פוסט מוכן בעברית עם אמוג'י — עד 80 מילה",
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
    const existingNames = new Set(existing.map((s: any) => s.summary));

    let created = 0;
    for (const signal of validSignals) {
      const summaryKey = `ויראלי: ${signal.title}`;
      if (existingNames.has(summaryKey)) continue;

      await prisma.marketSignal.create({
        data: {
          linked_business:    businessProfileId,
          summary:            summaryKey,
          impact_level:       signal.velocity === 'exploding' ? 'high' : 'medium',
          category:           'viral_signal',
          recommended_action: `פרסם ${signal.content_format} ב-${signal.platform} תוך ${signal.window_hours} שעות`,
          confidence:         signal.confidence || 70,
          source_urls:        signal.evidence_url || '',
          source_description: JSON.stringify({
            action_type:      'social_post',
            action_label:     `צור תוכן: ${signal.content_format} ב-${signal.platform}`,
            scope:            signal.scope,
            platform:         signal.platform,
            content_format:   signal.content_format,
            hashtags:         signal.hashtags,
            velocity:         signal.velocity,
            window_hours:     signal.window_hours,
            ready_to_post_text: signal.ready_to_post_text,
            visual_direction: signal.visual_direction,
            prefilled_text:   signal.ready_to_post_text,
            is_viral_signal:  true,
            time_minutes:     20,
          }),
          is_read:     false,
          detected_at: new Date().toISOString(),
        },
      });

      existingNames.add(summaryKey);
      created++;
    }

    apifyItems.forEach((v: any) => {
      const id = v.id || v.videoId;
      if (id) trendCp.scannedIds.add(id);
    });
    await saveCheckpoint(trendCp, { signals_created: created, scanned_at: new Date().toISOString() });

    setLastRun(businessProfileId, 'detectViralSignals');
    await writeAutomationLog('detectViralSignals', businessProfileId, startTime, created);

    return res.json({
      signals_created:  created,
      results_scanned:  apifyItems.length + tavilyCount,
      local_signals:    validSignals.filter(s => s.scope === 'local').length,
      global_signals:   validSignals.filter(s => s.scope === 'global').length,
      exploding:        validSignals.filter(s => s.velocity === 'exploding').length,
      platforms:        [...new Set(validSignals.map(s => s.platform))],
    });

  } catch (err: any) {
    console.error('[detectViralSignals] error:', err.message);
    await writeAutomationLog('detectViralSignals', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
