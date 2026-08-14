import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { prisma } from '../../db';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { writeAutomationLog } from '../../lib/automationLog';
import { uploadImageFromUrl, isS3Configured } from '../../lib/s3';
import { analyzePostCreative } from '../../lib/analyzePostCreative';

const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000; // 20h
const POSTS_CAP = 15;

const NULL_CHAR = String.fromCharCode(0);

function deepPgSafe(v: any): any {
  if (typeof v === 'string') return v.split(NULL_CHAR).join('');
  if (Array.isArray(v))     return v.map(deepPgSafe);
  if (v && typeof v === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v)) out[k] = deepPgSafe(v[k]);
    return out;
  }
  return v;
}

function pgSafe(s: string | null | undefined): string | null {
  return s == null ? null : s.split(NULL_CHAR).join('');
}

// Hex-encode a string so it arrives at PostgreSQL as pure ASCII.
// Bypasses Prisma's Linux query-engine bug that re-introduces 0x00 bytes
// when encoding certain Unicode characters for the PostgreSQL wire protocol.
// PostgreSQL decodes it back with: convert_from(decode($N, 'hex'), 'UTF8')
function pgHex(s: string | null | undefined): string | null {
  if (s == null) return null;
  return Buffer.from(s.split(NULL_CHAR).join(''), 'utf8').toString('hex');
}

async function scrapeAndSave(
  comp: any,
  platform: string,
  url: string,
  businessProfileId: string,
): Promise<{ competitor: string; platform: string; url: string; upserted: number; apify_returned: number; media_found: number; media_uploaded: number; first_post_keys?: string[]; first_post_media_sample?: Record<string, any>; elapsed_ms: number; error: string | null; insert_errors?: any[] }> {
  // One-time backfill: delete posts with no media so they get re-inserted with correct field extraction
  await (prisma as any).$executeRawUnsafe(
    `DELETE FROM competitor_posts WHERE competitor_id = $1 AND platform = $2 AND media_url IS NULL`,
    comp.id, platform,
  ).catch(() => {});

  // Raw SQL to avoid P2023 on Render (TIMESTAMPTZ columns in competitor_posts)
  const existing = await (prisma as any).$queryRawUnsafe(
    `SELECT id, external_post_id, post_url, media_url, analyzed_at FROM competitor_posts WHERE competitor_id = $1 AND platform = $2`,
    comp.id, platform,
  ) as { id: string; external_post_id: string | null; post_url: string | null; media_url: string | null; analyzed_at: string | null }[];
  const existingIds  = new Set<string>(existing.map(p => p.external_post_id).filter(Boolean) as string[]);
  const existingUrls = new Set<string>(existing.map(p => p.post_url).filter(Boolean) as string[]);
  const existingById  = new Map(existing.filter(p => p.external_post_id).map(p => [p.external_post_id as string, p]));
  const existingByUrl = new Map(existing.filter(p => p.post_url).map(p => [p.post_url as string, p]));

  // Best-effort creative analysis for a row that was never analyzed — used both
  // for brand-new posts and as a backfill for posts scraped before this feature existed.
  async function analyzeAndSave(id: string, mediaUrl: string | null, caption: string | null) {
    if (!mediaUrl) return;
    try {
      const analysis = await analyzePostCreative({ caption, platform, mediaUrl });
      if (analysis) {
        await (prisma as any).$executeRawUnsafe(
          `UPDATE competitor_posts SET analysis = convert_from(decode($1, 'hex'), 'UTF8'), analyzed_at = NOW(), has_offer = $2, has_cta = $3 WHERE id = $4`,
          pgHex(JSON.stringify(analysis)) ?? '',
          analysis.has_offer,
          analysis.has_cta,
          id,
        );
      }
    } catch (analysisErr: any) {
      console.warn('[collectCompetitorSocialPosts] creative analysis failed:', analysisErr.message);
    }
  }

  let rawPosts: any[] = [];
  let apifyError: string | null = null;
  const t0 = Date.now();

  if (platform === 'instagram') {
    rawPosts = await runApifyActor('apify~instagram-scraper', {
      directUrls: [url],
      resultsType: 'posts',
      resultsLimit: POSTS_CAP,
    }, 90_000, 50, (msg) => { apifyError = msg; });
  } else if (platform === 'facebook') {
    rawPosts = await runApifyActor('apify~facebook-posts-scraper', {
      startUrls: [{ url }],
      maxPosts: 30,
      maxPostComments: 0,
      commentsMode: 'DISABLED',
    }, 120_000, 50, (msg) => { apifyError = msg; });
  } else if (platform === 'tiktok') {
    rawPosts = await runApifyActor('clockworks~tiktok-profile-scraper', {
      profiles: [url],
      resultsPerPage: POSTS_CAP,
    }, 90_000, 50, (msg) => { apifyError = msg; });
  }

  const insertErrors: any[] = [];
  let upserted = 0;
  let mediaFound = 0;
  let mediaUploaded = 0;
  let firstPostKeys: string[] = [];
  let firstPostMediaSample: Record<string, any> | null = null;

  for (const rawPost of rawPosts) {
    const post = deepPgSafe(rawPost);

    // Capture first post's keys + all plausible media fields for diagnostics
    if (firstPostKeys.length === 0) {
      firstPostKeys = Object.keys(post);
      const MEDIA_KEYS = [
        'displayUrl','images','thumbnailSrc','thumbnail_src','videoUrl','thumbnailUrl',
        'full_picture','attachments','media','topImage','picture','postImages',
        'videoMeta','covers','webVideoUrl','url','imageUrl','image_url','image',
      ];
      firstPostMediaSample = {};
      for (const k of MEDIA_KEYS) {
        if (k in post) firstPostMediaSample[k] = typeof post[k] === 'string'
          ? post[k].substring(0, 120)
          : JSON.stringify(post[k])?.substring(0, 120);
      }
    }

    const externalId = pgSafe(post.id || post.shortCode || post.postId || post.videoId || null);
    const postUrl    = pgSafe(
      post.url || post.postUrl || post.webVideoUrl
      || (post.shortCode ? `https://www.instagram.com/p/${post.shortCode}/` : null)
      || null,
    );

    const rawMediaUrl = pgSafe(
      // Instagram (apify~instagram-scraper)
      post.displayUrl ||
      post.images?.[0]?.url ||
      post.thumbnailSrc ||
      post.thumbnail_src ||
      post.videoUrl ||
      post.thumbnailUrl ||
      // Facebook (apify~facebook-posts-scraper) — multiple actor output formats
      post.full_picture ||
      post.media?.[0]?.image?.uri ||       // v3 photo format
      post.media?.[0]?.photo?.imageUri ||  // v2 photo format
      post.media?.[0]?.thumbnail?.uri ||   // video thumbnail (object form)
      (typeof post.media?.[0]?.thumbnail === 'string' ? post.media[0].thumbnail : null) || // video thumbnail (string URL form)
      post.topImage?.uri ||                // top-level image object
      post.topImage?.url ||
      post.image?.uri ||
      post.image?.url ||
      post.imageUrl ||
      post.attachments?.[0]?.media?.image?.src ||
      post.attachments?.[0]?.media?.url ||
      post.attachments?.[0]?.url ||
      post.attachments?.[0]?.imageUrl ||
      // TikTok (clockworks~tiktok-profile-scraper)
      post.videoMeta?.coverUrl ||
      post.covers?.[0] ||
      post.webVideoUrl ||
      null,
    );
    if (rawMediaUrl) mediaFound++;

    // Upload to S3 for permanent storage; fall back to CDN URL if S3 not configured or upload fails
    const mediaUrl    = rawMediaUrl && isS3Configured()
      ? (await uploadImageFromUrl(rawMediaUrl) ?? rawMediaUrl)
      : rawMediaUrl;
    // Only write media_url when we got a fresh S3 URL (avoids no-op updates)
    const upgradedS3  = mediaUrl !== rawMediaUrl ? mediaUrl : null;
    if (upgradedS3) mediaUploaded++;

    if (externalId && existingIds.has(externalId)) {
      const setClause = upgradedS3
        ? `"last_seen_at" = NOW(), "media_url" = $4`
        : `"last_seen_at" = NOW()`;
      await (prisma as any).$executeRawUnsafe(
        `UPDATE competitor_posts SET ${setClause} WHERE competitor_id = $1 AND platform = $2 AND external_post_id = $3`,
        comp.id, platform, externalId, ...(upgradedS3 ? [upgradedS3] : []),
      ).catch(() => {});
      const row = existingById.get(externalId);
      if (row && !row.analyzed_at) {
        const caption = pgSafe((post.caption || post.text || post.message || post.description || '').substring(0, 1000));
        await analyzeAndSave(row.id, upgradedS3 || row.media_url, caption);
      }
      continue;
    }
    if (postUrl && existingUrls.has(postUrl)) {
      const setClause = upgradedS3
        ? `"last_seen_at" = NOW(), "media_url" = $4`
        : `"last_seen_at" = NOW()`;
      await (prisma as any).$executeRawUnsafe(
        `UPDATE competitor_posts SET ${setClause} WHERE competitor_id = $1 AND platform = $2 AND post_url = $3`,
        comp.id, platform, postUrl, ...(upgradedS3 ? [upgradedS3] : []),
      ).catch(() => {});
      const row = existingByUrl.get(postUrl);
      if (row && !row.analyzed_at) {
        const caption = pgSafe((post.caption || post.text || post.message || post.description || '').substring(0, 1000));
        await analyzeAndSave(row.id, upgradedS3 || row.media_url, caption);
      }
      continue;
    }

    const caption = pgSafe((post.caption || post.text || post.message || post.description || '').substring(0, 1000));
    const rawTs    = post.timestamp || post.takenAtTimestamp || post.createTime;
    const postedAt = rawTs
      ? new Date(rawTs < 1e12 ? rawTs * 1000 : rawTs).toISOString()
      : pgSafe(post.date || post.postDate || post.createTimeISO || null);
    const likes    = typeof (post.likesCount    ?? post.diggCount  ?? post.likes)    === 'number' ? (post.likesCount    ?? post.diggCount  ?? post.likes)    : null;
    const comments = typeof (post.commentsCount ?? post.commentCount ?? post.comments) === 'number' ? (post.commentsCount ?? post.commentCount ?? post.comments) : null;

    const newPostId = randomUUID();
    try {
      // Use raw SQL with hex-encoded strings to bypass Prisma query engine's
      // Linux bug that introduces null bytes (error 22021) for Unicode data.
      // All string params become pure-ASCII hex; PostgreSQL decodes them back.
      await (prisma as any).$executeRawUnsafe(
        `INSERT INTO competitor_posts
           (id, linked_business, competitor_id, platform,
            external_post_id, post_url, caption, media_url,
            posted_at, likes, comments_count, last_seen_at)
         VALUES (
           $1,
           convert_from(decode($2, 'hex'), 'UTF8'),
           convert_from(decode($3, 'hex'), 'UTF8'),
           convert_from(decode($4, 'hex'), 'UTF8'),
           NULLIF(convert_from(decode($5, 'hex'), 'UTF8'), ''),
           NULLIF(convert_from(decode($6, 'hex'), 'UTF8'), ''),
           NULLIF(convert_from(decode($7, 'hex'), 'UTF8'), ''),
           NULLIF(convert_from(decode($8, 'hex'), 'UTF8'), ''),
           $9::timestamptz,
           $10::int,
           $11::int,
           $12::timestamptz
         )`,
        newPostId,
        pgHex(businessProfileId) ?? '',
        pgHex(comp.id) ?? '',
        pgHex(platform) ?? '',
        pgHex(externalId),
        pgHex(postUrl),
        pgHex(caption),
        pgHex(mediaUrl),
        postedAt,
        likes,
        comments,
        new Date().toISOString(),
      );
      if (externalId) existingIds.add(externalId);
      if (postUrl)    existingUrls.add(postUrl);
      upserted++;

      // Analyze the creative (topic/offer/hooks/style/cta) — best-effort, never blocks the scrape loop.
      await analyzeAndSave(newPostId, mediaUrl, caption);
    } catch (insertErr: any) {
      const errMsg = (insertErr.message ?? '').trim();
      // 23505 = unique constraint — row already exists, not a real failure
      if (errMsg.includes('23505') || insertErr.code === '23505') continue;
      console.error('[collectCompetitorSocialPosts] insert failed:', errMsg.substring(0, 300), { competitor: comp.name, platform, externalId });
      insertErrors.push({ externalId, postUrl, code: insertErr.code ?? null, error: errMsg.substring(0, 500) });
    }
  }

  return {
    competitor: comp.name, platform, url,
    upserted, apify_returned: rawPosts.length,
    media_found: mediaFound, media_uploaded: mediaUploaded,
    ...(firstPostKeys.length ? { first_post_keys: firstPostKeys } : {}),
    ...(firstPostMediaSample && Object.keys(firstPostMediaSample).length ? { first_post_media_sample: firstPostMediaSample } : {}),
    elapsed_ms: Date.now() - t0,
    error: apifyError,
    ...(insertErrors.length ? { insert_errors: insertErrors } : {}),
  };
}

export async function collectCompetitorSocialPosts(req: Request, res: Response) {
  const { businessProfileId, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  if (!force && shouldSkipAgent(businessProfileId, 'collectCompetitorSocialPosts', MIN_INTERVAL_MS)) {
    return res.json({ upserted: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  try {
    if (!hasApifyKey()) {
      await writeAutomationLog('collectCompetitorSocialPosts', businessProfileId, startTime, 0, 'success', 'no_apify_key');
      return res.json({ upserted: 0, skipped: true, reason: 'no_apify_key' });
    }

    const allCompetitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
    });
    const competitors = allCompetitors.filter((c: any) => !c.not_relevant && c.tracking_status === 'approved');

    // One-time backfill: repair posts missing linked_business
    for (const comp of competitors) {
      await (prisma as any).$executeRawUnsafe(
        `UPDATE competitor_posts SET linked_business = $1 WHERE competitor_id = $2 AND linked_business IS NULL`,
        businessProfileId, comp.id,
      );
    }

    // Build list of (competitor, platform, url) tasks — skip missing URLs immediately
    const tasks: Array<{ comp: any; platform: string; url: string }> = [];
    const skipped: any[] = [];

    for (const comp of competitors) {
      const urls: Record<string, string | null> = {
        instagram: (comp as any).instagram_url,
        facebook:  (comp as any).facebook_url,
        tiktok:    (comp as any).tiktok_url,
      };
      for (const [platform, url] of Object.entries(urls)) {
        if (url) {
          tasks.push({ comp, platform, url });
        } else {
          skipped.push({ competitor: comp.name, platform, status: 'skipped', reason: 'no_url' });
        }
      }
    }

    // Run all Apify scrapes in parallel
    const results = await Promise.allSettled(
      tasks.map(({ comp, platform, url }) =>
        scrapeAndSave(comp, platform, url, businessProfileId),
      ),
    );

    const diagnostics = [
      ...skipped,
      ...results.map((r, i) =>
        r.status === 'fulfilled'
          ? r.value
          : { competitor: tasks[i].comp.name, platform: tasks[i].platform, url: tasks[i].url, error: (r as any).reason?.message },
      ),
    ];

    const totalUpserted = results
      .filter(r => r.status === 'fulfilled')
      .reduce((sum, r) => sum + (r as any).value.upserted, 0);

    setLastRun(businessProfileId, 'collectCompetitorSocialPosts');
    await writeAutomationLog('collectCompetitorSocialPosts', businessProfileId, startTime, totalUpserted, 'success');
    return res.json({ upserted: totalUpserted, competitors: competitors.length, diagnostics });
  } catch (err: any) {
    await writeAutomationLog('collectCompetitorSocialPosts', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
