import { Router, Request, Response } from 'express';
import { prisma } from '../db';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function hasUrl(c: any): boolean {
  return !!(c.instagram_url || c.facebook_url || c.tiktok_url);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/competitors/social/feed
// ?businessProfileId=&competitorId=&platform=
//
// Per-rival chronological post feed + header chips.
// emptyState: 'no_url' | 'no_data' | 'ok'
// ─────────────────────────────────────────────────────────────────────────────
router.get('/social/feed', async (req: Request, res: Response) => {
  const { businessProfileId, competitorId, platform } = req.query as Record<string, string>;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  if (competitorId) {
    // Single-rival view
    const competitor = await prisma.competitor.findFirst({
      where: { id: competitorId, linked_business: businessProfileId },
      select: {
        id: true, name: true,
        instagram_url: true, facebook_url: true, tiktok_url: true,
        content_themes: true, social_post_frequency: true,
        strongest_channel: true, social_followers_est: true, engagement_level: true,
      },
    });
    if (!competitor) return res.status(404).json({ error: 'Competitor not found' });

    const postWhere: any = { linked_business: businessProfileId, competitor_id: competitorId };
    if (platform) postWhere.platform = platform;

    const posts = await prisma.competitorPost.findMany({
      where: postWhere,
      orderBy: { posted_at: 'desc' },
      take: 50,
    });

    const emptyState = !hasUrl(competitor) ? 'no_url' : posts.length === 0 ? 'no_data' : 'ok';

    return res.json({
      competitor: {
        id: competitor.id,
        name: competitor.name,
        headerChips: {
          content_themes:       competitor.content_themes,
          social_post_frequency: competitor.social_post_frequency,
          strongest_channel:    competitor.strongest_channel,
          social_followers_est: competitor.social_followers_est,
          engagement_level:     competitor.engagement_level,
        },
      },
      posts,
      emptyState,
    });
  }

  // Board view — all rivals with recent post counts
  const competitors = await prisma.competitor.findMany({
    where: { linked_business: businessProfileId, not_relevant: false },
    select: {
      id: true, name: true,
      instagram_url: true, facebook_url: true, tiktok_url: true,
      content_themes: true, social_post_frequency: true,
    },
    orderBy: { name: 'asc' },
  });

  const postCountRows = await prisma.competitorPost.groupBy({
    by: ['competitor_id'],
    where: { linked_business: businessProfileId },
    _count: { id: true },
    _max:   { posted_at: true },
  });
  const countMap = Object.fromEntries(postCountRows.map(r => [r.competitor_id, r]));

  const board = competitors.map(c => ({
    ...c,
    post_count:    countMap[c.id]?._count.id    ?? 0,
    last_post_at:  countMap[c.id]?._max.posted_at ?? null,
    emptyState:    !hasUrl(c) ? 'no_url' : (countMap[c.id]?._count.id ?? 0) === 0 ? 'no_data' : 'ok',
  }));

  return res.json({ competitors: board });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/competitors/social/ads/current
// ?businessProfileId=&competitorId=
// ─────────────────────────────────────────────────────────────────────────────
router.get('/social/ads/current', async (req: Request, res: Response) => {
  const { businessProfileId, competitorId } = req.query as Record<string, string>;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (!competitorId)      return res.status(400).json({ error: 'Missing competitorId' });

  const competitor = await prisma.competitor.findFirst({
    where: { id: competitorId, linked_business: businessProfileId },
    select: {
      id: true, name: true,
      facebook_url: true, instagram_url: true, tiktok_url: true,
      sponsored_ads_detected:   true,
      sponsored_ads_updated_at: true,
      active_ad_platforms:      true,
      active_ad_count:          true,
      active_ads_summary:       true,
      last_promo_detected:      true,
      last_promo_detected_at:   true,
      ad_target_audience:       true,
      ad_strategy_summary:      true,
      ad_spend_signal:          true,
      ad_gaps:                  true,
      ad_intel_updated_at:      true,
    },
  });
  if (!competitor) return res.status(404).json({ error: 'Competitor not found' });

  const emptyState = !hasUrl(competitor)
    ? 'no_url'
    : !competitor.ad_intel_updated_at
      ? 'no_data'
      : 'ok';

  return res.json({ competitor, emptyState });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/competitors/social/ads/history
// ?businessProfileId=&competitorId=&sort=last_seen|first_seen&platform=
// ─────────────────────────────────────────────────────────────────────────────
router.get('/social/ads/history', async (req: Request, res: Response) => {
  const { businessProfileId, competitorId, sort = 'last_seen', platform } = req.query as Record<string, string>;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (!competitorId)      return res.status(400).json({ error: 'Missing competitorId' });

  const where: any = { linked_business: businessProfileId, competitor_id: competitorId };
  if (platform) where.platform = platform;

  const ads = await prisma.competitorAdHistory.findMany({
    where,
    orderBy: sort === 'first_seen' ? { first_seen_at: 'asc' } : { last_seen_at: 'desc' },
  });

  const competitor = await prisma.competitor.findFirst({
    where: { id: competitorId, linked_business: businessProfileId },
    select: { facebook_url: true, instagram_url: true, tiktok_url: true, ad_intel_updated_at: true },
  });

  const emptyState = !competitor || !hasUrl(competitor)
    ? 'no_url'
    : ads.length === 0
      ? 'no_data'
      : 'ok';

  return res.json({ ads, emptyState });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/competitors/social/board
// ?businessProfileId=&filter=all|with_posts|with_ads&platform=
// ─────────────────────────────────────────────────────────────────────────────
router.get('/social/board', async (req: Request, res: Response) => {
  const { businessProfileId, filter = 'all', platform } = req.query as Record<string, string>;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const competitors = await prisma.competitor.findMany({
    where: { linked_business: businessProfileId, not_relevant: false },
    select: {
      id: true, name: true,
      instagram_url: true, facebook_url: true, tiktok_url: true,
      sponsored_ads_detected: true, active_ad_count: true, ad_intel_updated_at: true,
      content_themes: true, social_post_frequency: true, strongest_channel: true,
    },
    orderBy: { name: 'asc' },
  });

  const postWhere: any = { linked_business: businessProfileId };
  if (platform) postWhere.platform = platform;

  const postCountRows = await prisma.competitorPost.groupBy({
    by: ['competitor_id'],
    where: postWhere,
    _count: { id: true },
    _max:   { posted_at: true },
  });
  const countMap = Object.fromEntries(postCountRows.map(r => [r.competitor_id, r]));

  let board = competitors.map(c => ({
    ...c,
    post_count:   countMap[c.id]?._count.id    ?? 0,
    last_post_at: countMap[c.id]?._max.posted_at ?? null,
  }));

  if (filter === 'with_posts') board = board.filter(c => c.post_count > 0);
  if (filter === 'with_ads')   board = board.filter(c => c.sponsored_ads_detected && (c.active_ad_count ?? 0) > 0);

  return res.json({ competitors: board });
});

export default router;
