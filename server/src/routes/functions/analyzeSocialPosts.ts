import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { findDonorCandidates, DonorCandidate, DonorPlatform } from '../../lib/competitorDonor';

const PER_COMP_INTERVAL_MS = 48 * 60 * 60 * 1000; // 48h — matches detectCompetitorAds cadence

interface CompetitorMeta {
  id: string;
  linked_business: string;
  name: string;
  category: string | null;
  content_themes: string | null;
  engagement_level: string | null;
  strongest_channel: string | null;
  social_post_frequency: string | null;
  social_followers_est: string | null;
  google_place_id: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  tiktok_url: string | null;
}

// Cross-business cache: another business may already have a fresh deep analysis
// of this exact real-world competitor — clone it instead of calling the LLM again.
// Returns whether a fresh donor was found and applied.
async function tryCloneDeepAnalysisFromDonor(competitor: CompetitorMeta): Promise<boolean> {
  const platforms: DonorPlatform[] = ['instagram', 'facebook', 'tiktok'];
  const byId = new Map<string, DonorCandidate>();
  for (const platform of platforms) {
    const urlValue = competitor[`${platform}_url`] ?? null;
    if (!competitor.google_place_id && !urlValue) continue;
    const found = await findDonorCandidates(competitor.id, competitor.linked_business, {
      googlePlaceId: competitor.google_place_id ?? null, platform, urlValue,
    });
    for (const d of found) byId.set(d.id, d);
  }
  if (byId.size === 0) return false;

  const rows = await (prisma as any).$queryRawUnsafe(
    `SELECT id, social_deep_analysis, social_deep_analysis_at FROM competitors
     WHERE id = ANY($1::text[]) AND social_deep_analysis_at IS NOT NULL
     ORDER BY social_deep_analysis_at DESC LIMIT 1`,
    Array.from(byId.keys()),
  ) as { id: string; social_deep_analysis: string; social_deep_analysis_at: string }[];
  if (rows.length === 0) return false;
  if (Date.now() - new Date(rows[0].social_deep_analysis_at).getTime() >= PER_COMP_INTERVAL_MS) return false;

  await prisma.competitor.update({
    where: { id: competitor.id },
    data: { social_deep_analysis: rows[0].social_deep_analysis, social_deep_analysis_at: new Date().toISOString() },
  });
  const donor = byId.get(rows[0].id)!;
  console.log(`[analyzeSocialPosts] cloned deep analysis for ${competitor.name} from donor ${donor.id} (business ${donor.linked_business}) — skipped LLM`);
  return true;
}

interface PostRow {
  caption: string | null; media_url: string | null; posted_at: Date | null;
  likes: number | null; comments_count: number | null;
  analysis: string | null; has_offer: boolean | null; has_cta: boolean | null;
}

interface AdRow {
  title: string | null; body: string | null; cta: string | null; platform: string; is_active: boolean;
  analysis: string | null; has_offer: boolean | null; has_cta: boolean | null; first_seen_at: Date | null;
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
    `SELECT title, body, cta, platform, is_active, analysis, has_offer, has_cta, first_seen_at
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

  // Deterministic offer-breakdown stats — computed in JS from the structured
  // per-item vision analysis (analyzePostCreative's offer_* fields), not guessed by the LLM.
  const DAY_NAMES_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const tally = (items: any[], key: string) => {
    const counts: Record<string, number> = {};
    for (const it of items) {
      const v = it.a[key];
      if (!v) continue;
      counts[v] = (counts[v] || 0) + 1;
    }
    return Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([value, count]) => ({ value, count }));
  };

  const offerAnalyzedPosts = analyzedPosts.filter(p => p.a.has_offer);
  const offerAnalyzedAds   = analyzedAds.filter(a => a.a.has_offer);
  const offerAnalyzedAll   = [...offerAnalyzedPosts, ...offerAnalyzedAds];

  const offerDates = [
    ...offerAnalyzedPosts.filter(p => p.posted_at).map(p => new Date(p.posted_at as Date)),
    ...offerAnalyzedAds.filter(a => a.first_seen_at).map(a => new Date(a.first_seen_at as Date)),
  ].sort((x, y) => x.getTime() - y.getTime());

  let offerStats: any = null;
  if (offerAnalyzedAll.length > 0) {
    let peakDay: string | null = null, peakDayCount = 0, avgIntervalDays: number | null = null;
    if (offerDates.length >= 2) {
      const dayBuckets = new Array(7).fill(0);
      offerDates.forEach(d => dayBuckets[d.getDay()]++);
      const peakDayIdx = dayBuckets.indexOf(Math.max(...dayBuckets));
      peakDay = DAY_NAMES_HE[peakDayIdx];
      peakDayCount = dayBuckets[peakDayIdx];
      const intervals: number[] = [];
      for (let i = 1; i < offerDates.length; i++) intervals.push((offerDates[i].getTime() - offerDates[i - 1].getTime()) / 86400000);
      avgIntervalDays = Math.round(intervals.reduce((s, v) => s + v, 0) / intervals.length);
    }
    const urgencyCount    = offerAnalyzedAll.filter(o => o.a.offer_urgency).length;
    const conditionsCount = offerAnalyzedAll.filter(o => o.a.offer_conditions).length;
    const inImageCount    = offerAnalyzedAll.filter(o => o.a.offer_in_image).length;

    // Performance signal (dimension 9) — only posts carry engagement metrics (ads don't).
    // Compares offer posts vs the competitor's regular posts to see if promotions actually land better.
    const avg = (arr: any[], key: string) => arr.length ? Math.round(arr.reduce((s, x) => s + x[key], 0) / arr.length) : null;
    const nonOfferPosts = analyzedPosts.filter(p => !p.a.has_offer);
    const avgLikesOffer      = avg(offerAnalyzedPosts.filter(p => p.likes != null), 'likes');
    const avgLikesRegular    = avg(nonOfferPosts.filter(p => p.likes != null), 'likes');
    const avgCommentsOffer   = avg(offerAnalyzedPosts.filter(p => p.comments_count != null), 'comments_count');
    const avgCommentsRegular = avg(nonOfferPosts.filter(p => p.comments_count != null), 'comments_count');
    const performance = (avgLikesOffer != null || avgLikesRegular != null) ? {
      avg_likes_offer_posts: avgLikesOffer, avg_likes_regular_posts: avgLikesRegular,
      avg_comments_offer_posts: avgCommentsOffer, avg_comments_regular_posts: avgCommentsRegular,
    } : null;

    offerStats = {
      total_offers: offerAnalyzedAll.length,
      peak_day: peakDay,
      peak_day_count: peakDayCount,
      avg_interval_days: avgIntervalDays,
      mechanic_breakdown: tally(offerAnalyzedAll, 'offer_mechanic'),
      value_framing_breakdown: tally(offerAnalyzedAll, 'offer_value_framing'),
      audience_intent_breakdown: tally(offerAnalyzedAll, 'offer_audience_intent'),
      redemption_breakdown: tally(offerAnalyzedAll, 'offer_redemption').slice(0, 3),
      urgency_pct: Math.round((urgencyCount / offerAnalyzedAll.length) * 100),
      conditions_pct: Math.round((conditionsCount / offerAnalyzedAll.length) * 100),
      in_image_pct: Math.round((inImageCount / offerAnalyzedAll.length) * 100),
      performance,
    };
  }

  const offerStatsNote = offerStats
    ? `${offerStats.total_offers} promotions analyzed. Most common mechanic: ${offerStats.mechanic_breakdown[0]?.value || '—'} (${offerStats.mechanic_breakdown[0]?.count || 0}/${offerStats.total_offers}).`
      + (offerStats.peak_day ? ` Most common day: ${offerStats.peak_day} (${offerStats.peak_day_count}/${offerStats.total_offers}).` : '')
      + (offerStats.avg_interval_days != null ? ` Average interval between promotions: ~${offerStats.avg_interval_days} days.` : '')
      + ` ${offerStats.urgency_pct}% use urgency/scarcity framing. ${offerStats.conditions_pct}% have conditions (min spend/code/exclusions). ${offerStats.in_image_pct}% show the offer directly in the creative image (vs caption-only).`
      + ` Value framing: mostly ${offerStats.value_framing_breakdown[0]?.value || '—'}. Top redemption path: ${offerStats.redemption_breakdown[0]?.value || '—'}. Main audience intent: ${offerStats.audience_intent_breakdown[0]?.value || '—'}.`
      + (offerStats.performance ? ` Performance: offer posts avg ${offerStats.performance.avg_likes_offer_posts ?? '?'} likes / ${offerStats.performance.avg_comments_offer_posts ?? '?'} comments, vs their regular posts avg ${offerStats.performance.avg_likes_regular_posts ?? '?'} likes / ${offerStats.performance.avg_comments_regular_posts ?? '?'} comments.` : '')
    : 'No structured offer breakdown available yet.';

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
Offer breakdown (computed — ground your promotion_pattern and offer_recommendation in these numbers, do not invent different ones): ${offerStatsNote}

Recent posts (${posts.length} total):
${captionSummary || 'No captions available.'}

Ads (${ads.length} total):
${adSummary}

Return ONLY this JSON object (start with { end with }). ALL string values MUST be in Hebrew:
{"visual_identity":"2-3 sentences on visual style and aesthetic, grounded in the visual analysis above","content_pillars":["topic 1","topic 2","topic 3"],"hook_patterns":"1-2 sentences on which text/visual hooks they rely on to grab attention","cta_strategy":"1-2 sentences on how consistently and how they drive action","promotion_pattern":"1-2 sentences on the offer CADENCE and TIMING — which day(s) of week and roughly how often (every N days) — grounded in the offer breakdown stats above","caption_patterns":"1-2 sentences on caption style: hashtags, tone","ad_messaging":"1-2 sentences on ad angle and targeting","offer_recommendation":"1-2 sentences: a concrete, actionable suggestion for OUR business based on their offer mechanic/timing/framing/audience-intent/performance patterns above — e.g. when to run a competing offer, what mechanic or angle to try, or what gap to fill","top_content_insight":"1 sentence on best performing content type","our_opportunity":"1-2 sentences on what they are missing we could exploit"}`;

  const raw = await invokeLLM({ prompt, model: 'sonnet', maxTokens: 1100, skipCache: true });

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

  const finalAnalysis = { ...analysis, offer_stats: offerStats };
  const analyzedAt = new Date().toISOString();
  await prisma.competitor.update({
    where: { id: competitor.id },
    data: { social_deep_analysis: JSON.stringify(finalAnalysis), social_deep_analysis_at: analyzedAt },
  });

  return { ...finalAnalysis, analyzed_at: analyzedAt, posts_analyzed: posts.length, ads_analyzed: ads.length };
}

const COMPETITOR_SELECT = {
  id: true, linked_business: true, name: true, category: true,
  content_themes: true, engagement_level: true,
  strongest_channel: true, social_post_frequency: true,
  social_followers_est: true,
  social_deep_analysis: true, social_deep_analysis_at: true,
  google_place_id: true, instagram_url: true, facebook_url: true, tiktok_url: true,
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

    if (!force && await tryCloneDeepAnalysisFromDonor(competitor)) {
      const fresh = await prisma.competitor.findUnique({
        where: { id: competitor.id },
        select: { social_deep_analysis: true, social_deep_analysis_at: true },
      });
      return res.json({ ...JSON.parse(fresh!.social_deep_analysis!), cloned: true, analyzed_at: fresh!.social_deep_analysis_at });
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
        // Runs regardless of force — see note in analyzeSocialPosts above.
        if (await tryCloneDeepAnalysisFromDonor(competitor)) {
          processed++;
          continue;
        }
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
