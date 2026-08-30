import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { isS3Url, downloadFromS3 } from '../lib/s3';
import { findPlaceId } from '../lib/googlePlaces';
import { enrichCompetitorUrls } from './functions/enrichCompetitorUrls';

const router = Router();

function hasUrl(c: any): boolean {
  return !!(c.instagram_url || c.facebook_url || c.tiktok_url);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/competitors/social/feed
// ?businessProfileId=&competitorId=&platform=
// ─────────────────────────────────────────────────────────────────────────────
router.get('/social/feed', async (req: Request, res: Response) => {
  try {
    const { businessProfileId, competitorId, platform } = req.query as Record<string, string>;
    if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

    if (competitorId) {
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

      // Raw SQL: first_seen_at/last_seen_at are TIMESTAMPTZ (OID 1184) in DB but
      // Prisma's Linux binary expects TIMESTAMP(3) (OID 1114) → P2023 on Render.
      const postParams: any[] = [competitorId];
      const postWhereSql = platform
        ? `"competitor_id" = $1 AND "platform" = $2` + (postParams.push(platform) && '')
        : `"competitor_id" = $1`;
      const posts = await (prisma as any).$queryRawUnsafe(
        `SELECT id, competitor_id, platform, external_post_id, post_url, caption,
                media_url, posted_at, likes, comments_count, first_seen_at, last_seen_at,
                analysis, analyzed_at, has_offer, has_cta
         FROM competitor_posts WHERE ${postWhereSql}
         ORDER BY "posted_at" DESC NULLS LAST LIMIT 50`,
        ...postParams,
      );

      const emptyState = !hasUrl(competitor) ? 'no_url' : posts.length === 0 ? 'no_data' : 'ok';

      return res.json({
        competitor: {
          id: competitor.id,
          name: competitor.name,
          headerChips: {
            content_themes:        competitor.content_themes,
            social_post_frequency: competitor.social_post_frequency,
            strongest_channel:     competitor.strongest_channel,
            social_followers_est:  competitor.social_followers_est,
            engagement_level:      competitor.engagement_level,
          },
        },
        posts,
        emptyState,
      });
    }

    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId, not_relevant: false },
      select: {
        id: true, name: true,
        instagram_url: true, facebook_url: true, tiktok_url: true,
        content_themes: true, social_post_frequency: true,
      },
      orderBy: { name: 'asc' },
    });

    const ids = competitors.map(c => c.id);
    const postCountRows = ids.length
      ? await prisma.competitorPost.groupBy({
          by: ['competitor_id'],
          where: { competitor_id: { in: ids } },
          _count: { id: true },
          _max:   { posted_at: true },
        })
      : [];
    const countMap = Object.fromEntries(postCountRows.map(r => [r.competitor_id, r]));

    return res.json({
      competitors: competitors.map(c => ({
        ...c,
        post_count:   countMap[c.id]?._count.id    ?? 0,
        last_post_at: countMap[c.id]?._max.posted_at ?? null,
        emptyState:   !hasUrl(c) ? 'no_url' : (countMap[c.id]?._count.id ?? 0) === 0 ? 'no_data' : 'ok',
      })),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/competitors/social/ads/current
// ?businessProfileId=&competitorId=
// ─────────────────────────────────────────────────────────────────────────────
router.get('/social/ads/current', async (req: Request, res: Response) => {
  try {
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
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/competitors/social/ads/history
// ?businessProfileId=&competitorId=&sort=last_seen|first_seen&platform=
// ─────────────────────────────────────────────────────────────────────────────
router.get('/social/ads/history', async (req: Request, res: Response) => {
  try {
    const { businessProfileId, competitorId, sort = 'last_seen', platform } = req.query as Record<string, string>;
    if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
    if (!competitorId)      return res.status(400).json({ error: 'Missing competitorId' });

    const competitor = await prisma.competitor.findFirst({
      where: { id: competitorId, linked_business: businessProfileId },
      select: { facebook_url: true, instagram_url: true, tiktok_url: true, ad_intel_updated_at: true },
    });
    if (!competitor) return res.status(404).json({ error: 'Competitor not found' });

    // Raw SQL: first_seen_at/last_seen_at are TIMESTAMPTZ in DB but Prisma's
    // Linux binary expects TIMESTAMP(3) → P2023 on Render.
    const adParams: any[] = [competitorId];
    const platformFilter = platform && platform !== 'tiktok' ? platform : null;
    const adWhereSql = platformFilter
      ? `"competitor_id" = $1 AND "platform" = $2` + (adParams.push(platformFilter) && '')
      : `"competitor_id" = $1 AND "platform" != 'tiktok'`;
    const orderByAd = sort === 'first_seen' ? `"first_seen_at" ASC` : `"last_seen_at" DESC NULLS LAST`;
    const ads = await (prisma as any).$queryRawUnsafe(
      `SELECT id, competitor_id, platform, external_ad_id, content_hash,
              title, body, cta, link, media_url, video_url, page_name, start_date, end_date,
              first_seen_at, last_seen_at, is_active, analysis, analyzed_at, has_offer, has_cta
       FROM competitor_ad_history WHERE ${adWhereSql}
       ORDER BY ${orderByAd}`,
      ...adParams,
    );

    const emptyState = !hasUrl(competitor) ? 'no_url' : ads.length === 0 ? 'no_data' : 'ok';

    return res.json({ ads, emptyState });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/competitors/social/board
// ?businessProfileId=&filter=all|with_posts|with_ads&platform=
// ─────────────────────────────────────────────────────────────────────────────
router.get('/social/board', async (req: Request, res: Response) => {
  try {
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

    const ids = competitors.map(c => c.id);
    const postWhere: any = ids.length ? { competitor_id: { in: ids } } : { competitor_id: 'none' };
    if (platform) postWhere.platform = platform;

    const postCountRows = ids.length
      ? await prisma.competitorPost.groupBy({
          by: ['competitor_id'],
          where: postWhere,
          _count: { id: true },
          _max:   { posted_at: true },
        })
      : [];
    const countMap = Object.fromEntries(postCountRows.map(r => [r.competitor_id, r]));

    let board = competitors.map(c => ({
      ...c,
      post_count:   countMap[c.id]?._count.id    ?? 0,
      last_post_at: countMap[c.id]?._max.posted_at ?? null,
    }));

    if (filter === 'with_posts') board = board.filter(c => c.post_count > 0);
    if (filter === 'with_ads')   board = board.filter(c => c.sponsored_ads_detected && (c.active_ad_count ?? 0) > 0);

    return res.json({ competitors: board });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/competitors/social/leaderboard?businessProfileId=
// Ranks tracked competitors by average post interactions (likes + comments)
// per post over the last 30 days. Competitors with no posts in the window
// are excluded rather than shown at 0 (no data isn't the same as no engagement).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/social/leaderboard', async (req: Request, res: Response) => {
  try {
    const { businessProfileId } = req.query as Record<string, string>;
    if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId, not_relevant: false },
      select: { id: true, name: true },
    });
    const ids = competitors.map(c => c.id);
    const nameById = Object.fromEntries(competitors.map(c => [c.id, c.name]));

    const WINDOW_DAYS = 30;
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Raw SQL: the typed prisma.competitorPost.groupBy() trips the same Prisma/Linux
    // query-engine bug (Postgres 22021 "invalid byte sequence... 0x00") that every
    // other read/write against this table already works around — see the pgHex
    // workaround in collectCompetitorSocialPosts.ts.
    const rows = ids.length
      ? await (prisma as any).$queryRawUnsafe(
          `SELECT competitor_id,
                  COUNT(*)::int AS post_count,
                  COALESCE(SUM(likes), 0)::int AS total_likes,
                  COALESCE(SUM(comments_count), 0)::int AS total_comments
           FROM competitor_posts
           WHERE competitor_id = ANY($1::text[]) AND posted_at::timestamptz >= $2::timestamptz
           GROUP BY competitor_id`,
          ids, since.toISOString(),
        ) as { competitor_id: string; post_count: number; total_likes: number; total_comments: number }[]
      : [];

    const leaderboard = rows
      .map(r => ({
        competitor_id: r.competitor_id,
        competitor_name: nameById[r.competitor_id] ?? 'Unknown',
        post_count: r.post_count,
        avg_interactions: r.post_count > 0 ? Math.round((r.total_likes + r.total_comments) / r.post_count) : 0,
      }))
      .sort((a, b) => b.avg_interactions - a.avg_interactions);

    // Same 30-day engagement metric, computed for the business's own posts so
    // the frontend can show a "you vs competitors" benchmark row/bar.
    const ownRows = await (prisma as any).$queryRawUnsafe(
      `SELECT COUNT(*)::int AS post_count,
              COALESCE(SUM(likes), 0)::int AS total_likes,
              COALESCE(SUM(comments_count), 0)::int AS total_comments
       FROM business_posts
       WHERE linked_business = $1 AND posted_at::timestamptz >= $2::timestamptz`,
      businessProfileId, since.toISOString(),
    ) as { post_count: number; total_likes: number; total_comments: number }[];
    const ownRow = ownRows[0];
    const own = ownRow && ownRow.post_count > 0
      ? { post_count: ownRow.post_count, avg_interactions: Math.round((ownRow.total_likes + ownRow.total_comments) / ownRow.post_count) }
      : null;

    return res.json({ leaderboard, own, window_days: WINDOW_DAYS });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/competitors/proxy-image?url=<encoded>
// Server-side proxy to bypass CORS on Instagram/Facebook/TikTok CDN URLs.
// Whitelisted to known CDN hostnames to prevent SSRF.
// Note: CDN URLs expire after 24-48h (IG/FB) or a few hours (TikTok).
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_CDN_HOSTS = [
  'cdninstagram.com',
  'fbcdn.net',
  'tiktokcdn.com',
  'tiktokv.com',
  'tiktokcdn-us.com',
];

router.get('/proxy-image', async (req: Request, res: Response) => {
  const { url } = req.query as { url?: string };
  if (!url) return res.status(400).json({ error: 'Missing url' });

  let parsed: URL;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'Invalid url' }); }

  // Allow cross-origin loading — helmet sets same-origin globally but images are served to the FE
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // S3/CloudFront URLs: serve with authenticated download
  if (isS3Url(url)) {
    const obj = await downloadFromS3(url);
    if (!obj) return res.status(404).end();
    res.setHeader('Content-Type', obj.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(obj.body);
  }

  const allowed = ALLOWED_CDN_HOSTS.some(h => parsed.hostname.endsWith(h));
  if (!allowed) return res.status(403).json({ error: 'Host not allowed' });

  try {
    const upstream = await fetch(url, { headers: { Referer: parsed.origin } });
    if (!upstream.ok) return res.status(upstream.status).end();
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const buf = await upstream.arrayBuffer();
    return res.end(Buffer.from(buf));
  } catch (e: any) {
    return res.status(502).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/competitors/:id/enrich-urls
// Resolves a google_place_id from name+city if missing, then runs the same
// site-extract -> Places -> SERP -> Tavily fallback chain used for
// auto-discovered competitors. Fill-if-empty only — never touches a URL the
// caller already set (manual_url_fields / non-null values are left alone).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/enrich-urls', async (req: Request, res: Response) => {
  const competitorId = String(req.params.id);
  try {
    const competitor = await prisma.competitor.findUnique({ where: { id: competitorId } });
    if (!competitor) return res.status(404).json({ error: 'Competitor not found' });

    if (!competitor.google_place_id && competitor.linked_business) {
      const profile = await prisma.businessProfile.findUnique({
        where: { id: competitor.linked_business }, select: { city: true },
      });
      const placeId = await findPlaceId(competitor.name, profile?.city || '');
      if (placeId) {
        await prisma.competitor.update({ where: { id: competitorId }, data: { google_place_id: placeId } });
      }
    }

    await enrichCompetitorUrls([competitorId]);
    const updated = await prisma.competitor.findUnique({ where: { id: competitorId } });
    return res.json({ ok: true, competitor: updated });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
