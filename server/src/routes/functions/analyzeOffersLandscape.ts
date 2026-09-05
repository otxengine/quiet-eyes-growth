import { Request, Response } from 'express';
import { prisma } from '../../db';
import { computeOfferStats, OfferAnalysisItem } from '../../lib/offerStats';
import { synthesizeOffersLandscape, OffersLandscapeExample, PooledOfferStats } from '../../lib/synthesizeOffersLandscape';

const PER_COMP_INTERVAL_MS = 48 * 60 * 60 * 1000; // 48h — matches analyzeSocialPosts/detectCompetitorAds cadence
const ACTIVE_OFFER_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // "currently running an offer" post recency window

interface PostRow {
  id: string;
  competitor_id: string;
  platform: string;
  posted_at: Date | null;
  likes: number | null;
  comments_count: number | null;
  caption: string | null;
  media_url: string | null;
  video_url: string | null;
  analysis: string | null;
}

interface AdRow {
  id: string;
  competitor_id: string;
  platform: string;
  is_active: boolean;
  title: string | null;
  body: string | null;
  cta: string | null;
  media_url: string | null;
  video_url: string | null;
  analysis: string | null;
  first_seen_at: Date | null;
}

interface LandscapeItem extends OfferAnalysisItem {
  id: string;
  competitorId: string;
  competitorName: string;
  platform: string;
  media_url: string | null;
  video_url: string | null;
  caption?: string | null; // posts only
  title?: string | null;   // ads only
  body?: string | null;    // ads only
  cta?: string | null;     // ads only
}

function parseAnalysis(raw: string | null): any {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Picks 2-4 representative real offer examples, most recent first, spread
 * across different competitors where possible (never fabricated — pulled
 * straight from each item's own extracted offer_details/topic). Carries the
 * full underlying post/ad (media, caption/body) too, not just the short
 * extracted phrase, so the frontend can render an expandable "see the full
 * post/ad" view — not just a one-line quote. */
function pickExamples(items: LandscapeItem[], limit = 4): OffersLandscapeExample[] {
  const dated = items
    .map(it => ({ it, date: it.posted_at ?? it.first_seen_at }))
    .filter((x): x is { it: LandscapeItem; date: Date | string } => !!x.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const examples: OffersLandscapeExample[] = [];
  const usedCompetitors = new Set<string>();
  for (const { it, date } of dated) {
    if (examples.length >= limit) break;
    if (usedCompetitors.has(it.competitorName)) continue;
    const details = it.a.offer_details || it.a.topic;
    if (!details) continue;
    examples.push({
      competitorName: it.competitorName,
      offer_details: details,
      date: new Date(date).toISOString().slice(0, 10),
      type: it.type,
      platform: it.platform,
      media_url: it.media_url ?? null,
      video_url: it.video_url ?? null,
      caption: it.caption ?? null,
      title: it.title ?? null,
      body: it.body ?? null,
      cta: it.cta ?? null,
      likes: it.likes ?? null,
      comments_count: it.comments_count ?? null,
    });
    usedCompetitors.add(it.competitorName);
  }
  return examples;
}

/**
 * Computes/refreshes the pooled cross-competitor "Offers Landscape" for a
 * business — what tracked competitors are offering, how, and when — grounded
 * in the same deterministic computeOfferStats() used per-competitor in
 * analyzeSocialPosts.ts, plus a landscape-only "active offer" ratio.
 * Persists onto BusinessProfile.offers_landscape_*.
 */
export async function getOffersLandscapeData(businessProfileId: string, force: boolean) {
  const bp = await prisma.businessProfile.findUnique({
    where: { id: businessProfileId },
    select: {
      offers_landscape_insight: true, offers_landscape_stats: true,
      offers_landscape_examples: true, offers_landscape_insight_at: true,
    },
  });

  if (!force && bp?.offers_landscape_insight_at) {
    const age = Date.now() - new Date(bp.offers_landscape_insight_at).getTime();
    if (age < PER_COMP_INTERVAL_MS) {
      return {
        insight: bp.offers_landscape_insight,
        stats: bp.offers_landscape_stats ? JSON.parse(bp.offers_landscape_stats) : null,
        examples: bp.offers_landscape_examples ? JSON.parse(bp.offers_landscape_examples) : [],
        cached: true,
      };
    }
  }

  // Tracked competitors — same filter as analyzeContentTrends.ts's pooled aggregation.
  const competitors = await prisma.competitor.findMany({
    where: { linked_business: businessProfileId, is_dismissed: false, not_relevant: false, tracking_status: 'approved' },
    select: { id: true, name: true },
  });

  if (competitors.length === 0) {
    return { insight: null, stats: null, examples: [], cached: false };
  }

  const competitorIds = competitors.map(c => c.id);
  const nameById = new Map(competitors.map(c => [c.id, c.name]));

  // Raw SQL to avoid Prisma P2023 on Render (TIMESTAMPTZ OID mismatch) — same
  // pattern as analyzeSocialPosts.ts / analyzeContentTrends.ts.
  const posts = await (prisma as any).$queryRawUnsafe(
    `SELECT id, competitor_id, platform, posted_at, likes, comments_count, caption, media_url, video_url, analysis
     FROM competitor_posts WHERE competitor_id = ANY($1::text[]) AND analysis IS NOT NULL`,
    competitorIds,
  ) as PostRow[];

  const ads = await (prisma as any).$queryRawUnsafe(
    `SELECT id, competitor_id, platform, is_active, title, body, cta, media_url, video_url, analysis, first_seen_at
     FROM competitor_ad_history WHERE competitor_id = ANY($1::text[]) AND analysis IS NOT NULL`,
    competitorIds,
  ) as AdRow[];

  const analyzedPosts = posts.map(p => ({ ...p, a: parseAnalysis(p.analysis) })).filter(p => p.a);
  const analyzedAds   = ads.map(a => ({ ...a, a: parseAnalysis(a.analysis) })).filter(a => a.a);

  const allItems: LandscapeItem[] = [
    ...analyzedPosts.map(p => ({
      type: 'post' as const, id: p.id, competitorId: p.competitor_id, competitorName: nameById.get(p.competitor_id) || '?',
      platform: p.platform, posted_at: p.posted_at, likes: p.likes, comments_count: p.comments_count,
      caption: p.caption, media_url: p.media_url, video_url: p.video_url, a: p.a,
    })),
    ...analyzedAds.map(a => ({
      type: 'ad' as const, id: a.id, competitorId: a.competitor_id, competitorName: nameById.get(a.competitor_id) || '?',
      platform: a.platform, first_seen_at: a.first_seen_at,
      title: a.title, body: a.body, cta: a.cta, media_url: a.media_url, video_url: a.video_url, a: a.a,
    })),
  ];
  // Pooled across ALL competitors, not per-competitor — the differentiator from CompetitorsOffers.jsx.
  const offerItems = allItems.filter(it => it.a.has_offer);

  const stats = computeOfferStats(offerItems, allItems);

  // Landscape-only stat: which competitors currently look like they're running
  // an active offer — either a recent (last 14d) has_offer post, or an is_active ad.
  const now = Date.now();
  const activeCompetitorIds = new Set<string>();
  for (const p of analyzedPosts) {
    if (p.a.has_offer && p.posted_at && now - new Date(p.posted_at).getTime() <= ACTIVE_OFFER_WINDOW_MS) {
      activeCompetitorIds.add(p.competitor_id);
    }
  }
  for (const a of analyzedAds) {
    if (a.a.has_offer && a.is_active) activeCompetitorIds.add(a.competitor_id);
  }

  const lastOfferByCompetitor = new Map<string, { mechanic: string | null; at: string }>();
  for (const it of offerItems as LandscapeItem[]) {
    const dateVal = it.posted_at ?? it.first_seen_at;
    if (!dateVal) continue;
    const iso = new Date(dateVal).toISOString();
    const existing = lastOfferByCompetitor.get(it.competitorId);
    if (!existing || iso > existing.at) {
      lastOfferByCompetitor.set(it.competitorId, { mechanic: it.a.offer_mechanic || null, at: iso });
    }
  }

  const per_competitor = competitors.map(c => {
    const last = lastOfferByCompetitor.get(c.id);
    return {
      competitorId: c.id,
      name: c.name,
      has_active_offer: activeCompetitorIds.has(c.id),
      last_offer_mechanic: last?.mechanic ?? null,
      last_offer_at: last?.at ?? null,
    };
  });

  const finalStats: PooledOfferStats = {
    ...(stats || {
      total_offers: 0, peak_day: null, peak_day_count: 0, avg_interval_days: null,
      mechanic_breakdown: [], value_framing_breakdown: [], audience_intent_breakdown: [],
      redemption_breakdown: [], topic_breakdown: [], channel_breakdown: [],
      urgency_pct: 0, conditions_pct: 0, in_image_pct: 0, performance: null,
    }),
    competitors_total: competitors.length,
    competitors_with_active_offer: activeCompetitorIds.size,
    active_offer_pct: Math.round((activeCompetitorIds.size / competitors.length) * 100),
    per_competitor,
  } as PooledOfferStats & { per_competitor: typeof per_competitor };

  const examples = pickExamples(offerItems as LandscapeItem[]);
  const insight = offerItems.length > 0 ? await synthesizeOffersLandscape(finalStats, examples) : null;

  const analyzedAt = new Date().toISOString();
  await prisma.businessProfile.update({
    where: { id: businessProfileId },
    data: {
      offers_landscape_insight: insight,
      offers_landscape_stats: JSON.stringify(finalStats),
      offers_landscape_examples: JSON.stringify(examples),
      offers_landscape_insight_at: analyzedAt,
    },
  });

  return { insight, stats: finalStats, examples, cached: false };
}

/** POST /api/functions/analyzeOffersLandscape — pooled cross-competitor offer
 * landscape for the Insights page. Body: { businessProfileId, force? } */
export async function analyzeOffersLandscape(req: Request, res: Response) {
  const { businessProfileId, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const result = await getOffersLandscapeData(businessProfileId, !!force);
    return res.json(result);
  } catch (err: any) {
    console.error('[analyzeOffersLandscape]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
