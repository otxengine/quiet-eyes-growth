import { Request, Response } from 'express';
import { prisma } from '../../db';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { writeAutomationLog } from '../../lib/automationLog';

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

async function scrapeAndSave(
  comp: any,
  platform: string,
  url: string,
  businessProfileId: string,
): Promise<{ competitor: string; platform: string; url: string; upserted: number; apify_returned: number; elapsed_ms: number; error: string | null; insert_errors?: any[] }> {
  const existing = await (prisma as any).competitorPost.findMany({
    where: { competitor_id: comp.id, platform },
    select: { external_post_id: true, post_url: true },
  });
  const existingIds  = new Set<string>(existing.map((p: any) => p.external_post_id).filter(Boolean));
  const existingUrls = new Set<string>(existing.map((p: any) => p.post_url).filter(Boolean));

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
      maxPosts: POSTS_CAP,
      maxPostComments: 0,
    }, 90_000, 50, (msg) => { apifyError = msg; });
  } else if (platform === 'tiktok') {
    rawPosts = await runApifyActor('clockworks~tiktok-profile-scraper', {
      profiles: [url],
      resultsPerPage: POSTS_CAP,
    }, 90_000, 50, (msg) => { apifyError = msg; });
  }

  const insertErrors: any[] = [];
  let upserted = 0;

  for (const rawPost of rawPosts) {
    const post = deepPgSafe(rawPost);

    const externalId = pgSafe(post.id || post.shortCode || post.postId || post.videoId || null);
    const postUrl    = pgSafe(
      post.url || post.postUrl || post.webVideoUrl
      || (post.shortCode ? `https://www.instagram.com/p/${post.shortCode}/` : null)
      || null,
    );

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

    const caption  = pgSafe((post.caption || post.text || post.message || post.description || '').substring(0, 1000));
    const mediaUrl = pgSafe(post.displayUrl || post.thumbnailUrl || post.videoUrl || post.attachments?.[0]?.url || null);
    const rawTs    = post.timestamp || post.takenAtTimestamp || post.createTime;
    const postedAt = rawTs
      ? new Date(rawTs < 1e12 ? rawTs * 1000 : rawTs).toISOString()
      : pgSafe(post.date || post.postDate || post.createTimeISO || null);
    const likes    = post.likesCount    ?? post.diggCount  ?? post.likes    ?? null;
    const comments = post.commentsCount ?? post.commentCount ?? post.comments ?? null;

    // Apply pgSafe to every string field — belt-and-suspenders for fields that bypass deepPgSafe
    const safeData = {
      linked_business:  pgSafe(businessProfileId) as string,
      competitor_id:    pgSafe(comp.id) as string,
      platform:         pgSafe(platform) as string,
      external_post_id: externalId,
      post_url:         postUrl,
      caption,
      media_url:        mediaUrl,
      posted_at:        postedAt,
      likes,
      comments_count:   comments,
      last_seen_at:     new Date().toISOString(),
    };

    try {
      await (prisma as any).competitorPost.create({ data: safeData });
      if (externalId) existingIds.add(externalId);
      if (postUrl)    existingUrls.add(postUrl);
      upserted++;
    } catch (insertErr: any) {
      // Identify which field still has a null byte for diagnostics
      const nullFields: string[] = [];
      for (const [k, v] of Object.entries(safeData)) {
        if (typeof v === 'string' && v.includes(NULL_CHAR)) nullFields.push(k);
      }
      console.error('[collectCompetitorSocialPosts] insert failed:', insertErr.message, { competitor: comp.name, platform, externalId, nullFields });
      insertErrors.push({ externalId, postUrl, error: insertErr.message.split('\n')[0], nullFields });
    }
  }

  return {
    competitor: comp.name, platform, url,
    upserted, apify_returned: rawPosts.length,
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
    const competitors = allCompetitors.filter((c: any) => !c.not_relevant);

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
