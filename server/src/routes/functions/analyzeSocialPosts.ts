import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';

const PER_COMP_INTERVAL_MS = 48 * 60 * 60 * 1000; // 48h — matches detectCompetitorAds cadence

interface CompetitorMeta {
  id: string;
  name: string;
  category: string | null;
  content_themes: string | null;
  engagement_level: string | null;
  strongest_channel: string | null;
  social_post_frequency: string | null;
  social_followers_est: string | null;
}

interface PostRow {
  caption: string | null; media_url: string | null; posted_at: Date | null;
  likes: number | null; comments_count: number | null;
  analysis: string | null; has_offer: boolean | null; has_cta: boolean | null;
}

interface AdRow {
  title: string | null; body: string | null; cta: string | null; platform: string; is_active: boolean;
  analysis: string | null; has_offer: boolean | null; has_cta: boolean | null;
}

function parseAnalysis(raw: string | null): any {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Runs the deep content-strategy analysis for one competitor, grounded in the
 * per-post/ad vision analysis (topic/style/hooks/offer/cta) already computed
 * by analyzePostCreative — no duplicate vision calls here. Persists the result
 * onto Competitor.social_deep_analysis(_at).
 */
async function analyzeCompetitorContent(competitor: CompetitorMeta): Promise<any> {
  // Raw SQL to avoid Prisma P2023 on Render (TIMESTAMPTZ OID mismatch)
  const posts = await (prisma as any).$queryRawUnsafe(
    `SELECT caption, media_url, posted_at, likes, comments_count, analysis, has_offer, has_cta
     FROM competitor_posts WHERE competitor_id = $1
     ORDER BY posted_at DESC NULLS LAST LIMIT 20`,
    competitor.id,
  ) as PostRow[];

  const ads = await (prisma as any).$queryRawUnsafe(
    `SELECT title, body, cta, platform, is_active, analysis, has_offer, has_cta
     FROM competitor_ad_history WHERE competitor_id = $1
     ORDER BY last_seen_at DESC NULLS LAST LIMIT 10`,
    competitor.id,
  ) as AdRow[];

  const captionSummary = posts
    .filter(p => p.caption)
    .slice(0, 10)
    .map((p, i) => `Post ${i + 1} (❤️${p.likes ?? '?'} 💬${p.comments_count ?? '?'}): "${p.caption!.substring(0, 200)}"`)
    .join('\n');

  const adSummary = ads.length
    ? ads.map(a => `[${a.platform}${a.is_active ? ' ACTIVE' : ''}] ${a.title || ''} | ${(a.body || '').substring(0, 150)} | CTA: ${a.cta || '—'}`).join('\n')
    : 'No ads found.';

  // Aggregate the structured per-post/ad vision analysis instead of re-deriving it
  const analyzedPosts = posts.map(p => ({ ...p, a: parseAnalysis(p.analysis) })).filter(p => p.a);
  const analyzedAds   = ads.map(a => ({ ...a, a: parseAnalysis(a.analysis) })).filter(a => a.a);
  const allAnalyzed   = [...analyzedPosts.map(p => p.a), ...analyzedAds.map(a => a.a)];

  const styles      = [...new Set(analyzedPosts.map(p => p.a.style).filter(Boolean))];
  const visualHooks = [...new Set(analyzedPosts.flatMap(p => p.a.visual_hooks || []))];
  const textHooks   = [...new Set(allAnalyzed.flatMap(a => a.text_hooks || []))];

  const ctaTotal   = allAnalyzed.length;
  const ctaCount   = allAnalyzed.filter(a => a.has_cta).length;
  const ctaPhrases = [...new Set(allAnalyzed.filter(a => a.cta).map(a => a.cta))];

  const offerItems = [
    ...analyzedPosts.filter(p => p.a.has_offer).map(p =>
      `${p.a.offer_details || p.a.topic} (${p.posted_at ? new Date(p.posted_at).toISOString().slice(0, 10) : '?'})`),
    ...analyzedAds.filter(a => a.a.has_offer).map(a =>
      `${a.a.offer_details || a.a.topic} (ad, ${a.is_active ? 'active' : 'ended'})`),
  ];
  const offerTotal = allAnalyzed.length;
  const offerCount = offerItems.length;

  const visualNote = styles.length || visualHooks.length
    ? `Recurring visual style: ${styles.join(', ') || '—'}. Recurring visual hooks: ${visualHooks.slice(0, 8).join(', ') || '—'}.`
    : 'No analyzed images yet.';
  const hookNote = textHooks.length ? textHooks.slice(0, 10).join(', ') : 'No recurring text hooks detected yet.';
  const ctaNote   = ctaTotal   > 0 ? `${ctaCount}/${ctaTotal} analyzed items have a clear CTA. Phrases used: ${ctaPhrases.slice(0, 6).join(', ') || '—'}.` : 'No analyzed items yet.';
  const promoNote = offerTotal > 0 ? `${offerCount}/${offerTotal} analyzed items are promotions. Examples: ${offerItems.slice(0, 6).join(' | ') || '—'}.` : 'No analyzed items yet.';

  const prompt = `Analyze this competitor's social media strategy and return a JSON OBJECT (NOT an array).

Competitor: "${competitor.name}" (${competitor.category || 'business'})
Known metadata: channel=${competitor.strongest_channel || '?'}, engagement=${competitor.engagement_level || '?'}, frequency=${competitor.social_post_frequency || '?'}, followers=${competitor.social_followers_est || '?'}, themes=${competitor.content_themes || '?'}

Visual analysis (from ${analyzedPosts.length} vision-analyzed posts): ${visualNote}
Recurring text hooks: ${hookNote}
CTA usage: ${ctaNote}
Promotion pattern: ${promoNote}

Recent posts (${posts.length} total):
${captionSummary || 'No captions available.'}

Ads (${ads.length} total):
${adSummary}

Return ONLY this JSON object (start with { end with }):
{"visual_identity":"2-3 sentences on visual style and aesthetic, grounded in the visual analysis above","content_pillars":["topic 1","topic 2","topic 3"],"hook_patterns":"1-2 sentences on which text/visual hooks they rely on to grab attention","cta_strategy":"1-2 sentences on how consistently and how they drive action","promotion_pattern":"1-2 sentences on how often and what kind of promotions they run","caption_patterns":"1-2 sentences on caption style: hashtags, tone","ad_messaging":"1-2 sentences on ad angle and targeting","top_content_insight":"1 sentence on best performing content type","our_opportunity":"1-2 sentences on what they are missing we could exploit"}`;

  const raw = await invokeLLM({ prompt, model: 'sonnet', maxTokens: 900, skipCache: true });

  // Parse: invokeLLM without response_json_schema returns raw text
  let analysis: any = null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    analysis = raw;
  } else if (typeof raw === 'string') {
    try {
      const clean = raw.replace(/```json|```/g, '').trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) analysis = JSON.parse(match[0]);
    } catch { /* leave null */ }
  }
  if (!analysis) throw new Error('LLM returned unexpected format');

  const analyzedAt = new Date().toISOString();
  await prisma.competitor.update({
    where: { id: competitor.id },
    data: { social_deep_analysis: JSON.stringify(analysis), social_deep_analysis_at: analyzedAt },
  });

  return { ...analysis, analyzed_at: analyzedAt, posts_analyzed: posts.length, ads_analyzed: ads.length };
}

const COMPETITOR_SELECT = {
  id: true, name: true, category: true,
  content_themes: true, engagement_level: true,
  strongest_channel: true, social_post_frequency: true,
  social_followers_est: true,
  social_deep_analysis: true, social_deep_analysis_at: true,
} as const;

/** POST /api/functions/analyzeSocialPosts — manual "✨ צור ניתוח AI" button, one competitor. */
export async function analyzeSocialPosts(req: Request, res: Response) {
  const { competitorId, businessProfileId, force } = req.body;
  if (!competitorId || !businessProfileId) {
    return res.status(400).json({ error: 'Missing competitorId or businessProfileId' });
  }

  try {
    const competitor = await prisma.competitor.findFirst({
      where: { id: competitorId, linked_business: businessProfileId },
      select: COMPETITOR_SELECT,
    });
    if (!competitor) return res.status(404).json({ error: 'Competitor not found' });

    if (!force && competitor.social_deep_analysis && competitor.social_deep_analysis_at) {
      const age = Date.now() - new Date(competitor.social_deep_analysis_at).getTime();
      if (age < PER_COMP_INTERVAL_MS) {
        return res.json({ ...JSON.parse(competitor.social_deep_analysis), cached: true, analyzed_at: competitor.social_deep_analysis_at });
      }
    }

    const result = await analyzeCompetitorContent(competitor);
    return res.json(result);
  } catch (err: any) {
    console.error('[analyzeSocialPosts]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

/** Scheduled agent: analyzes every due competitor for a business. Body: { businessProfileId, force? } */
export async function scheduledAnalyzeSocialPosts(req: Request, res: Response) {
  const { businessProfileId, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId, not_relevant: false, tracking_status: 'approved' },
      select: COMPETITOR_SELECT,
    });

    let processed = 0;
    for (const competitor of competitors) {
      const lastAt = competitor.social_deep_analysis_at ? new Date(competitor.social_deep_analysis_at).getTime() : 0;
      if (!force && Date.now() - lastAt < PER_COMP_INTERVAL_MS) continue;
      try {
        await analyzeCompetitorContent(competitor);
        processed++;
      } catch (err: any) {
        console.error('[scheduledAnalyzeSocialPosts] failed for', competitor.name, err.message);
      }
    }

    return res.json({ processed, total: competitors.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
