import { Request, Response } from 'express';
import { prisma } from '../../db';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { writeAutomationLog } from '../../lib/automationLog';
import { uploadImageFromUrl, isS3Configured } from '../../lib/s3';
import { analyzePostCreative } from '../../lib/analyzePostCreative';
import { postContentHash } from '../../lib/postContentHash';

// Own-business twin of collectCompetitorSocialPosts.ts — same Apify actors, same
// dedup/analysis logic, but scrapes the business's own pages into business_posts
// instead of a competitor's pages into competitor_posts. business_posts uses
// TIMESTAMP(3) columns (see server/src/index.ts), so — unlike the competitor
// version — this can use plain typed Prisma calls with no pgHex/raw-SQL workarounds.

const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000; // 20h
// ponytail: steady-state cap sized for the actual delta (a few posts/day), not the backfill.
// If an account posts >5x between two ~20-24h scans, the overflow is silently missed next
// run too (cursor advances past it) — raise this if a specific account looks incomplete.
const POSTS_CAP = 5;       // steady-state cap per platform per run
const BACKFILL_CAP = 150;  // one-time deeper pull on a business's first-ever scrape (no cursor yet)

function normalizeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch {
    return url;
  }
}

async function scrapeAndSave(businessProfileId: string, platform: string, url: string, fullBackfill = false) {
  const existing = await prisma.businessPost.findMany({
    where: { linked_business: businessProfileId, platform },
    select: { id: true, external_post_id: true, post_url: true, content_hash: true, media_url: true, video_url: true, analyzed_at: true, video_analyzed_at: true, posted_at: true },
  });
  const existingById   = new Map(existing.filter(p => p.external_post_id).map(p => [p.external_post_id as string, p]));
  const existingByUrl  = new Map(existing.filter(p => p.post_url).map(p => [normalizeUrl(p.post_url) as string, p]));
  const existingByHash = new Map(existing.filter(p => p.content_hash).map(p => [p.content_hash as string, p]));

  // Cost reduction: only ask Apify for posts newer than what we already have —
  // skipped on the first-ever scrape so the initial backlog still loads.
  // Future-dated posted_at values are ignored so one bad timestamp can't push the
  // cursor past real new posts and silently freeze collection.
  const now = new Date();
  const maxPostedAt = existing.reduce<Date | null>(
    (max, p) => (p.media_url && p.posted_at && p.posted_at <= now && (!max || p.posted_at > max)) ? p.posted_at : max, null,
  );

  const t0 = Date.now();

  async function analyzeAndSave(id: string, mediaUrl: string | null, caption: string | null, videoUrl: string | null, alreadyVideoAnalyzed: boolean) {
    if (!mediaUrl && !videoUrl) return;
    // videoUrl only passed through when this row hasn't been video-analyzed yet —
    // once video_analyzed_at is set, never re-run video analysis (cost control).
    const useVideoUrl = alreadyVideoAnalyzed ? null : videoUrl;
    try {
      const analysis = await analyzePostCreative({ caption, platform, mediaUrl, videoUrl: useVideoUrl });
      if (analysis) {
        await prisma.businessPost.update({
          where: { id },
          data: {
            analysis: JSON.stringify(analysis), analyzed_at: new Date(),
            has_offer: analysis.has_offer, has_cta: analysis.has_cta,
            ...(useVideoUrl && analysis.video_description != null ? { video_analyzed_at: new Date() } : {}),
          },
        });
      }
    } catch (analysisErr: any) {
      console.warn('[collectOwnSocialPosts] creative analysis failed:', analysisErr.message);
    }
  }

  let rawPosts: any[] = [];
  let apifyError: string | null = null;
  const onlyPostsNewerThan = (!fullBackfill && maxPostedAt) ? maxPostedAt.toISOString().slice(0, 10) : null;

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
      resultsLimit: platformCap,
      ...(onlyPostsNewerThan ? { onlyPostsNewerThan } : {}),
    }, 120_000, 160, (msg) => { apifyError = msg; });
  }

  let upserted = 0;

  for (const post of rawPosts) {
    const externalId = post.id || post.shortCode || post.postId || post.videoId || null;
    const postUrl =
      post.url || post.postUrl || post.webVideoUrl
      || (post.shortCode ? `https://www.instagram.com/p/${post.shortCode}/` : null)
      || null;
    const normalizedPostUrl = normalizeUrl(postUrl);
    const caption = (post.caption || post.text || post.message || post.description || '').substring(0, 1000) || null;
    const rawTs = post.timestamp || post.takenAtTimestamp || post.createTime;
    const postedAt = rawTs
      ? new Date(rawTs < 1e12 ? rawTs * 1000 : rawTs)
      : (post.date || post.postDate || post.createTimeISO ? new Date(post.date || post.postDate || post.createTimeISO) : null);
    const contentHash = postContentHash(platform, caption, postedAt ? postedAt.toISOString() : null);

    const rawMediaUrl =
      // Instagram (apify~instagram-scraper)
      post.displayUrl ||
      post.images?.[0]?.url ||
      post.thumbnailSrc ||
      post.thumbnail_src ||
      post.thumbnailUrl ||
      // Facebook (apify~facebook-posts-scraper) — multiple actor output formats
      post.full_picture ||
      post.media?.[0]?.image?.uri ||
      post.media?.[0]?.photo?.imageUri ||
      post.media?.[0]?.thumbnail?.uri ||
      (typeof post.media?.[0]?.thumbnail === 'string' ? post.media[0].thumbnail : null) ||
      post.topImage?.uri ||
      post.topImage?.url ||
      post.image?.uri ||
      post.image?.url ||
      post.imageUrl ||
      post.attachments?.[0]?.media?.image?.src ||
      post.attachments?.[0]?.media?.url ||
      post.attachments?.[0]?.url ||
      post.attachments?.[0]?.imageUrl ||
      null;

    // Raw playable video file — separate from the thumbnail above. videoUrl/webVideoUrl
    // were previously (wrongly) mixed into rawMediaUrl: Instagram's videoUrl is the raw
    // .mp4, not a valid thumbnail image, so it's only ever used here now.
    const rawVideoUrl =
      post.videoUrl ||               // Instagram Reel .mp4
      null;

    const mediaUrl = rawMediaUrl && isS3Configured()
      ? (await uploadImageFromUrl(rawMediaUrl, 'business-posts') ?? rawMediaUrl)
      : rawMediaUrl;

    // Dedup cascade: external_post_id -> normalized post_url -> content_hash.
    const matchedRow =
      (externalId && existingById.get(externalId)) ||
      (normalizedPostUrl && existingByUrl.get(normalizedPostUrl)) ||
      (contentHash && existingByHash.get(contentHash)) ||
      null;

    if (matchedRow) {
      await prisma.businessPost.update({
        where: { id: matchedRow.id },
        data: {
          last_seen_at: new Date(),
          media_url: mediaUrl ?? matchedRow.media_url,
          video_url: rawVideoUrl ?? matchedRow.video_url,
          external_post_id: matchedRow.external_post_id ?? externalId,
          post_url: matchedRow.post_url ?? postUrl,
          content_hash: contentHash ?? matchedRow.content_hash,
        },
      }).catch(() => {});
      if (!matchedRow.analyzed_at || (!matchedRow.video_analyzed_at && (rawVideoUrl || matchedRow.video_url))) {
        await analyzeAndSave(
          matchedRow.id, mediaUrl || matchedRow.media_url, caption,
          rawVideoUrl || matchedRow.video_url, !!matchedRow.video_analyzed_at,
        );
      }
      continue;
    }

    const likes = typeof (post.likesCount ?? post.diggCount ?? post.likes) === 'number' ? (post.likesCount ?? post.diggCount ?? post.likes) : null;
    const comments = typeof (post.commentsCount ?? post.commentCount ?? post.comments) === 'number' ? (post.commentsCount ?? post.commentCount ?? post.comments) : null;

    try {
      const created = await prisma.businessPost.create({
        data: {
          linked_business: businessProfileId,
          platform,
          external_post_id: externalId,
          post_url: postUrl,
          content_hash: contentHash,
          caption,
          media_url: mediaUrl,
          video_url: rawVideoUrl,
          posted_at: postedAt,
          likes,
          comments_count: comments,
        },
      });
      upserted++;
      await analyzeAndSave(created.id, mediaUrl, caption, rawVideoUrl, false);
    } catch (insertErr: any) {
      // P2002 = unique constraint — row already landed via a concurrent run, not a real failure
      if (insertErr.code === 'P2002') continue;
      console.error('[collectOwnSocialPosts] insert failed:', insertErr.message?.substring(0, 300), { platform, externalId });
    }
  }

  return { platform, url, upserted, apify_returned: rawPosts.length, elapsed_ms: Date.now() - t0, error: apifyError };
}

export async function collectOwnSocialPosts(req: Request, res: Response) {
  const { businessProfileId, force, fullBackfill } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  if (!force && shouldSkipAgent(businessProfileId, 'collectOwnSocialPosts', MIN_INTERVAL_MS)) {
    return res.json({ upserted: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  try {
    if (!hasApifyKey()) {
      await writeAutomationLog('collectOwnSocialPosts', businessProfileId, startTime, 0, 'success', 'no_apify_key');
      return res.json({ upserted: 0, skipped: true, reason: 'no_apify_key' });
    }

    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business not found' });

    const urls: Record<string, string | null> = {
      instagram: profile.instagram_url,
      facebook: profile.facebook_url,
    };
    const tasks = Object.entries(urls).filter(([, url]) => !!url) as [string, string][];

    const results = await Promise.allSettled(
      tasks.map(([platform, url]) => scrapeAndSave(businessProfileId, platform, url, platform === 'facebook' && !!fullBackfill)),
    );

    const diagnostics = results.map((r, i) =>
      r.status === 'fulfilled' ? r.value : { platform: tasks[i][0], url: tasks[i][1], error: (r as any).reason?.message },
    );
    const totalUpserted = results
      .filter(r => r.status === 'fulfilled')
      .reduce((sum, r) => sum + (r as any).value.upserted, 0);

    setLastRun(businessProfileId, 'collectOwnSocialPosts');
    await writeAutomationLog('collectOwnSocialPosts', businessProfileId, startTime, totalUpserted, 'success');
    return res.json({ upserted: totalUpserted, diagnostics });
  } catch (err: any) {
    await writeAutomationLog('collectOwnSocialPosts', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
