import { Request, Response } from 'express';
import { prisma } from '../../db';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { writeAutomationLog } from '../../lib/automationLog';

const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000; // 20h
const POSTS_CAP = 15;

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
    const competitors = allCompetitors.filter((c: any) => !c.not_relevant);

    // Repair rows created before linked_business was required (one-time backfill)
    if (competitors.length > 0) {
      await (prisma as any).$executeRawUnsafe(
        `UPDATE competitor_posts SET linked_business = $1 WHERE competitor_id = ANY($2::text[]) AND linked_business IS NULL`,
        businessProfileId,
        competitors.map((c: any) => c.id),
      );
    }

    let totalUpserted = 0;

    for (const comp of competitors) {
      const platforms = [
        { platform: 'instagram', url: (comp as any).instagram_url as string | null },
        { platform: 'facebook',  url: (comp as any).facebook_url  as string | null },
        { platform: 'tiktok',    url: (comp as any).tiktok_url    as string | null },
      ];

      for (const { platform, url } of platforms) {
        if (!url) continue; // AC3: skip platforms with no stored URL

        const existing = await (prisma as any).competitorPost.findMany({
          where: { competitor_id: comp.id, platform },
          select: { external_post_id: true, post_url: true },
        });
        const existingIds  = new Set<string>(existing.map((p: any) => p.external_post_id).filter(Boolean));
        const existingUrls = new Set<string>(existing.map((p: any) => p.post_url).filter(Boolean));

        let posts: any[] = [];

        if (platform === 'instagram') {
          posts = await runApifyActor('apify~instagram-scraper', {
            directUrls: [url],
            resultsType: 'posts',
            resultsLimit: POSTS_CAP,
          }, 90_000, 50);
        } else if (platform === 'facebook') {
          posts = await runApifyActor('apify~facebook-posts-scraper', {
            startUrls: [{ url }],
            maxPosts: POSTS_CAP,
            maxPostComments: 0,
          }, 90_000, 50);
        } else if (platform === 'tiktok') {
          posts = await runApifyActor('clockworks~tiktok-profile-scraper', {
            profiles: [url],
            resultsPerPage: POSTS_CAP,
          }, 90_000, 50);
        }

        for (const post of posts) {
          const externalId = post.id || post.shortCode || post.postId || post.videoId || null;
          const postUrl    = post.url || post.postUrl || post.webVideoUrl
            || (post.shortCode ? `https://www.instagram.com/p/${post.shortCode}/` : null)
            || null;

          // AC6: bump last_seen_at on re-scrape, skip insert
          if (externalId && existingIds.has(externalId)) {
            await (prisma as any).competitorPost.updateMany({
              where: { competitor_id: comp.id, platform, external_post_id: externalId },
              data: { last_seen_at: new Date().toISOString() },
            });
            continue;
          }
          if (postUrl && existingUrls.has(postUrl)) {
            await (prisma as any).competitorPost.updateMany({
              where: { competitor_id: comp.id, platform, post_url: postUrl },
              data: { last_seen_at: new Date().toISOString() },
            });
            continue;
          }

          // AC7: extract fields
          const caption  = (post.caption || post.text || post.message || post.description || '').substring(0, 1000);
          const mediaUrl = post.displayUrl || post.thumbnailUrl || post.videoUrl || post.attachments?.[0]?.url || null;
          const rawTs    = post.timestamp || post.takenAtTimestamp || post.createTime;
          const postedAt = rawTs
            ? new Date(rawTs < 1e12 ? rawTs * 1000 : rawTs).toISOString()
            : (post.date || post.postDate || post.createTimeISO || null);
          const likes    = post.likesCount    ?? post.diggCount  ?? post.likes    ?? null;
          const comments = post.commentsCount ?? post.commentCount ?? post.comments ?? null;

          await (prisma as any).competitorPost.create({
            data: {
              linked_business:  businessProfileId,
              competitor_id:    comp.id,
              platform,
              external_post_id: externalId,
              post_url:         postUrl,
              caption,
              media_url:        mediaUrl,
              posted_at:        postedAt,
              likes,
              comments_count:   comments,
              last_seen_at:     new Date().toISOString(),
            },
          });

          if (externalId) existingIds.add(externalId);
          if (postUrl)    existingUrls.add(postUrl);
          totalUpserted++;
        }
      }
    }

    setLastRun(businessProfileId, 'collectCompetitorSocialPosts');
    await writeAutomationLog('collectCompetitorSocialPosts', businessProfileId, startTime, totalUpserted, 'success');
    return res.json({ upserted: totalUpserted, competitors: competitors.length });
  } catch (err: any) {
    await writeAutomationLog('collectCompetitorSocialPosts', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
