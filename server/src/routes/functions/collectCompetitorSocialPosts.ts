import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { prisma } from '../../db';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { writeAutomationLog } from '../../lib/automationLog';
import { uploadImageFromUrl, isS3Configured } from '../../lib/s3';
import { analyzePostCreative } from '../../lib/analyzePostCreative';
import { postContentHash } from '../../lib/postContentHash';
import { findDonorCandidates, DonorPlatform } from '../../lib/competitorDonor';

const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000; // 20h
// ponytail: steady-state cap sized for the actual delta (a few posts/day), not the backfill.
// If an account posts >5x between two ~20-24h scans, the overflow is silently missed next
// run too (cursor advances past it) — raise this if a specific account looks incomplete.
const POSTS_CAP = 5;       // steady-state cap per platform per run
const BACKFILL_CAP = 150;  // one-time deeper pull on a competitor's first-ever scrape (no cursor yet)

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

// Strips tracking query params / trailing slash so the same post scraped twice
// with a slightly different URL string still matches on post_url.
function normalizeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch {
    return url;
  }
}

async function scrapeAndSave(
  comp: any,
  platform: string,
  url: string | null,
  businessProfileId: string,
): Promise<{ competitor: string; platform: string; url: string; upserted: number; apify_returned: number; media_found: number; media_uploaded: number; first_post_keys?: string[]; first_post_media_sample?: Record<string, any>; elapsed_ms: number; error: string | null; insert_errors?: any[] }> {
  // One-time backfill: delete posts with no media so they get re-inserted with correct field extraction
  await (prisma as any).$executeRawUnsafe(
    `DELETE FROM competitor_posts WHERE competitor_id = $1 AND platform = $2 AND media_url IS NULL`,
    comp.id, platform,
  ).catch(() => {});

  // Raw SQL to avoid P2023 on Render (TIMESTAMPTZ columns in competitor_posts)
  const existing = await (prisma as any).$queryRawUnsafe(
    `SELECT id, external_post_id, post_url, content_hash, media_url, video_url, analyzed_at, video_analyzed_at, posted_at FROM competitor_posts WHERE competitor_id = $1 AND platform = $2`,
    comp.id, platform,
  ) as { id: string; external_post_id: string | null; post_url: string | null; content_hash: string | null; media_url: string | null; video_url: string | null; analyzed_at: string | null; video_analyzed_at: string | null; posted_at: string | null }[];
  const existingIds   = new Set<string>(existing.map(p => p.external_post_id).filter(Boolean) as string[]);
  const existingUrls  = new Set<string>(existing.map(p => normalizeUrl(p.post_url)).filter(Boolean) as string[]);
  const existingHashes = new Set<string>(existing.map(p => p.content_hash).filter(Boolean) as string[]);
  const existingById   = new Map(existing.filter(p => p.external_post_id).map(p => [p.external_post_id as string, p]));
  const existingByUrl  = new Map(existing.filter(p => p.post_url).map(p => [normalizeUrl(p.post_url) as string, p]));
  const existingByHash = new Map(existing.filter(p => p.content_hash).map(p => [p.content_hash as string, p]));
  // Cost reduction: only ask Apify for posts newer than what we already have —
  // skipped entirely on a competitor's first-ever scrape so its initial backlog still loads.
  // Only counts rows that already have media_url: a null-media row gets deleted and
  // retried every run (see DELETE above), so excluding it here keeps it within the
  // "newer than" window instead of advancing the cursor past it and losing it forever.
  // Future-dated posted_at values are ignored so one bad timestamp can't push the
  // cursor past real new posts and silently freeze collection.
  const nowIso = new Date().toISOString();
  const maxPostedAt = existing.reduce<string | null>(
    (max, p) => (p.media_url && p.posted_at && p.posted_at <= nowIso && (!max || p.posted_at > max)) ? p.posted_at : max, null,
  );

  const t0 = Date.now();

  // Cross-business cache: another business may already have a fresh scrape of this
  // exact real-world competitor (same google_place_id or same platform URL). Clone
  // its posts (including analysis — this is what saves the vision-LLM cost, not just
  // Apify) instead of paying for another scrape. Runs regardless of `force` — force
  // only bypasses the per-business ran-recently throttle above; a fresh donor is
  // just as valid as a fresh scrape of our own, including for onboarding's initial
  // force:true population, which is exactly when this matters most. Falls through
  // to the normal Apify path below if no fresh donor exists.
  const donors = await findDonorCandidates(comp.id, businessProfileId, {
    googlePlaceId: comp.google_place_id ?? null,
    platform: platform as DonorPlatform,
    urlValue: url,
  });
  if (donors.length > 0) {
    const freshThreshold = new Date(Date.now() - MIN_INTERVAL_MS).toISOString();
    const donorIds = donors.map(d => d.id);
    const freshDonor = await (prisma as any).$queryRawUnsafe(
      `SELECT competitor_id, MAX(last_seen_at) AS freshest
       FROM competitor_posts
       WHERE competitor_id = ANY($1::text[]) AND platform = $2
       GROUP BY competitor_id
       HAVING MAX(last_seen_at::timestamptz) >= $3::timestamptz
       ORDER BY freshest DESC LIMIT 1`,
      donorIds, platform, freshThreshold,
    ) as { competitor_id: string }[];

    if (freshDonor.length > 0) {
      const donorCompetitorId = freshDonor[0].competitor_id;
      // NOT EXISTS anti-join (rather than ON CONFLICT) so this is safe to run
      // regardless of whether this competitor already has some of its own posts —
      // never overwrites/duplicates anything this business already owns.
      const cloned = await (prisma as any).$executeRawUnsafe(
        `INSERT INTO competitor_posts
           (id, linked_business, competitor_id, platform, external_post_id, post_url,
            content_hash, caption, media_url, video_url, posted_at, likes, comments_count,
            first_seen_at, last_seen_at, analysis, analyzed_at, video_analyzed_at, has_offer, has_cta)
         SELECT gen_random_uuid()::text, $1, $2, d.platform, d.external_post_id, d.post_url,
                d.content_hash, d.caption, d.media_url, d.video_url, d.posted_at, d.likes, d.comments_count,
                NOW(), NOW(), d.analysis, d.analyzed_at, d.video_analyzed_at, d.has_offer, d.has_cta
         FROM competitor_posts d
         WHERE d.competitor_id = $3 AND d.platform = $4
           AND NOT EXISTS (
             SELECT 1 FROM competitor_posts o
             WHERE o.competitor_id = $2 AND o.platform = $4
               AND ( (d.external_post_id IS NOT NULL AND o.external_post_id = d.external_post_id)
                  OR (d.content_hash IS NOT NULL AND o.content_hash = d.content_hash) )
           )`,
        businessProfileId, comp.id, donorCompetitorId, platform,
      ) as number;

      const donorBusiness = donors.find(d => d.id === donorCompetitorId)?.linked_business;
      console.log(`[collectCompetitorSocialPosts] cloned ${cloned} posts for ${platform} from donor ${donorCompetitorId} (business ${donorBusiness}) — skipped Apify`);
      return {
        competitor: comp.name, platform, url: url ?? '',
        upserted: Number(cloned) || 0, apify_returned: 0, media_found: 0, media_uploaded: 0,
        elapsed_ms: Date.now() - t0, error: null,
      };
    }
  }

  // No local URL for this platform yet (e.g. onboarding fired this before the
  // slower Tavily/DataForSEO URL-enrichment step finished writing it) and no
  // donor was found via google_place_id either — nothing to scrape. The next
  // normal run (daily cron) will pick this competitor up once its URL exists.
  if (!url) {
    console.log(`[collectCompetitorSocialPosts] ${comp.name} (${platform}): no URL yet and no donor — will retry once URL is enriched`);
    return {
      competitor: comp.name, platform, url: '',
      upserted: 0, apify_returned: 0, media_found: 0, media_uploaded: 0,
      elapsed_ms: Date.now() - t0, error: null,
    };
  }

  // Best-effort creative analysis for a row that was never analyzed — used both
  // for brand-new posts and as a backfill for posts scraped before this feature existed.
  async function analyzeAndSave(id: string, mediaUrl: string | null, caption: string | null, videoUrl: string | null, alreadyVideoAnalyzed: boolean) {
    if (!mediaUrl && !videoUrl) return;
    // videoUrl only passed through when this row hasn't been video-analyzed yet —
    // once video_analyzed_at is set, never re-run video analysis (cost control).
    const useVideoUrl = alreadyVideoAnalyzed ? null : videoUrl;
    try {
      const analysis = await analyzePostCreative({ caption, platform, mediaUrl, videoUrl: useVideoUrl });
      if (analysis) {
        await (prisma as any).$executeRawUnsafe(
          `UPDATE competitor_posts SET analysis = convert_from(decode($1, 'hex'), 'UTF8'), analyzed_at = NOW(), has_offer = $2, has_cta = $3
           ${useVideoUrl && analysis.video_description != null ? ', video_analyzed_at = NOW()' : ''}
           WHERE id = $4`,
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

  // Only set on repeat scrapes (maxPostedAt exists) — a competitor's first-ever
  // scrape still pulls the full capped history with no since-date filter.
  const onlyPostsNewerThan = maxPostedAt ? maxPostedAt.slice(0, 10) : null;

  // First-ever scrape (no cursor yet) pulls a deeper one-time backfill; repeat
  // scrapes stay at the steady-state cap since onlyPostsNewerThan already scopes them.
  const platformCap = onlyPostsNewerThan ? POSTS_CAP : BACKFILL_CAP;

  if (platform === 'instagram') {
    rawPosts = await runApifyActor('apify~instagram-scraper', {
      directUrls: [url],
      resultsType: 'posts',
      resultsLimit: platformCap,
      ...(onlyPostsNewerThan ? { onlyPostsNewerThan } : {}),
    }, 90_000, 160, (msg) => { apifyError = msg; });
  } else if (platform === 'facebook') {
    rawPosts = await runApifyActor('apify~facebook-posts-scraper', {
      startUrls: [{ url }],
      maxPosts: platformCap,
      maxPostComments: 0,
      commentsMode: 'DISABLED',
      ...(onlyPostsNewerThan ? { onlyPostsNewerThan } : {}),
    }, 120_000, 160, (msg) => { apifyError = msg; });
  } else if (platform === 'tiktok') {
    rawPosts = await runApifyActor('clockworks~tiktok-profile-scraper', {
      profiles: [url],
      resultsPerPage: platformCap,
      ...(onlyPostsNewerThan ? { oldestPostDateUnified: onlyPostsNewerThan } : {}),
    }, 90_000, 160, (msg) => { apifyError = msg; });
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
    const normalizedPostUrl = normalizeUrl(postUrl);
    const caption = pgSafe((post.caption || post.text || post.message || post.description || '').substring(0, 1000));
    const rawTs    = post.timestamp || post.takenAtTimestamp || post.createTime;
    const postedAt = rawTs
      ? new Date(rawTs < 1e12 ? rawTs * 1000 : rawTs).toISOString()
      : pgSafe(post.date || post.postDate || post.createTimeISO || null);
    const contentHash = postContentHash(platform, caption, postedAt);

    const rawMediaUrl = pgSafe(
      // Instagram (apify~instagram-scraper)
      post.displayUrl ||
      post.images?.[0]?.url ||
      post.thumbnailSrc ||
      post.thumbnail_src ||
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
      null,
    );
    if (rawMediaUrl) mediaFound++;

    // Raw playable video file — separate from the thumbnail above. videoUrl/webVideoUrl
    // were previously (wrongly) mixed into rawMediaUrl: Instagram's videoUrl is the raw
    // .mp4, and TikTok's webVideoUrl is the HTML watch page, not media at all — neither
    // is a valid thumbnail image, so they're only ever used here now.
    const rawVideoUrl = pgSafe(
      post.videoUrl ||               // Instagram Reel .mp4
      post.videoMeta?.downloadAddr || // TikTok raw video file
      null,
    );

    // Upload to S3 for permanent storage; fall back to CDN URL if S3 not configured or upload fails
    const mediaUrl    = rawMediaUrl && isS3Configured()
      ? (await uploadImageFromUrl(rawMediaUrl) ?? rawMediaUrl)
      : rawMediaUrl;
    // Only write media_url when we got a fresh S3 URL (avoids no-op updates)
    const upgradedS3  = mediaUrl !== rawMediaUrl ? mediaUrl : null;
    if (upgradedS3) mediaUploaded++;

    // Dedup cascade: external_post_id -> normalized post_url -> content_hash.
    // A hash/URL match "heals" a row that was missing external_post_id/post_url on
    // a prior run instead of inserting yet another duplicate for the same post.
    const matchedRow =
      (externalId && existingById.get(externalId)) ||
      (normalizedPostUrl && existingByUrl.get(normalizedPostUrl)) ||
      (contentHash && existingByHash.get(contentHash)) ||
      null;

    if (matchedRow) {
      await (prisma as any).$executeRawUnsafe(
        `UPDATE competitor_posts SET
           last_seen_at = NOW(),
           media_url = COALESCE($2, media_url),
           video_url = COALESCE($6, video_url),
           external_post_id = COALESCE(external_post_id, $3),
           post_url = COALESCE(post_url, $4),
           content_hash = COALESCE($5, content_hash)
         WHERE id = $1`,
        matchedRow.id, upgradedS3, externalId, postUrl, contentHash, rawVideoUrl,
      ).catch(() => {});
      const rowVideoUrl = rawVideoUrl || matchedRow.video_url;
      if (!matchedRow.analyzed_at || (!matchedRow.video_analyzed_at && rowVideoUrl)) {
        await analyzeAndSave(
          matchedRow.id, upgradedS3 || matchedRow.media_url, caption,
          rowVideoUrl, !!matchedRow.video_analyzed_at,
        );
      }
      if (externalId)       existingIds.add(externalId);
      if (normalizedPostUrl) existingUrls.add(normalizedPostUrl);
      if (contentHash)      existingHashes.add(contentHash);
      continue;
    }

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
            external_post_id, post_url, content_hash, caption, media_url,
            posted_at, likes, comments_count, last_seen_at, video_url)
         VALUES (
           $1,
           convert_from(decode($2, 'hex'), 'UTF8'),
           convert_from(decode($3, 'hex'), 'UTF8'),
           convert_from(decode($4, 'hex'), 'UTF8'),
           NULLIF(convert_from(decode($5, 'hex'), 'UTF8'), ''),
           NULLIF(convert_from(decode($6, 'hex'), 'UTF8'), ''),
           $13,
           NULLIF(convert_from(decode($7, 'hex'), 'UTF8'), ''),
           NULLIF(convert_from(decode($8, 'hex'), 'UTF8'), ''),
           $9::timestamptz,
           $10::int,
           $11::int,
           $12::timestamptz,
           NULLIF(convert_from(decode($14, 'hex'), 'UTF8'), '')
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
        contentHash,
        pgHex(rawVideoUrl) ?? '',
      );
      if (externalId)       existingIds.add(externalId);
      if (normalizedPostUrl) existingUrls.add(normalizedPostUrl);
      if (contentHash)      existingHashes.add(contentHash);
      upserted++;

      // Analyze the creative (topic/offer/hooks/style/cta) — best-effort, never blocks the scrape loop.
      await analyzeAndSave(newPostId, mediaUrl, caption, rawVideoUrl, false);
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

    // Build list of (competitor, platform, url) tasks. A missing local URL still
    // gets a task (url: null) when we have a google_place_id to donor-match on —
    // e.g. right after onboarding, URL enrichment may not have finished writing
    // this competitor's URLs yet, but a cross-business donor can still be found
    // by place_id. scrapeAndSave skips the actual Apify call when url is null.
    const tasks: Array<{ comp: any; platform: string; url: string | null }> = [];
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
        } else if ((comp as any).google_place_id) {
          tasks.push({ comp, platform, url: null });
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
