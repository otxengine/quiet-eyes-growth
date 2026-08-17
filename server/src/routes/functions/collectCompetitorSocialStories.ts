import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { prisma } from '../../db';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { writeAutomationLog } from '../../lib/automationLog';
import { uploadImageFromUrl, isS3Configured } from '../../lib/s3';

// Stories expire ~24h after posting on Instagram, so this needs to run far more
// often than the 20h post scraper to actually catch them before they vanish.
const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const STORIES_ACTOR = 'dLL7b34nRrgN6ZV24'; // datavoyantlab~advanced-instagram-stories-scraper

const NULL_CHAR = String.fromCharCode(0);

function pgSafe(s: string | null | undefined): string | null {
  return s == null ? null : s.split(NULL_CHAR).join('');
}

// Hex-encode a string so it arrives at PostgreSQL as pure ASCII — bypasses
// Prisma's Linux query-engine bug that reintroduces 0x00 bytes for Unicode
// (see collectCompetitorSocialPosts.ts for the same workaround).
function pgHex(s: string | null | undefined): string | null {
  if (s == null) return null;
  return Buffer.from(s.split(NULL_CHAR).join(''), 'utf8').toString('hex');
}

const IG_SKIP = ['p', 'reel', 'reels', 'stories', 'tv', 'explore', 'accounts', 'share', 'intent', 'embed'];

// Inverse of extractSocialLinksFromWebsite.ts's matchInstagram() — that one goes
// href -> canonical profile URL; this goes a stored profile URL -> bare username
// (the actor's input shape), reusing the same regex + skip-list.
export function extractInstagramUsername(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/instagram\.com\/([^/?#]+)/i);
  if (!m) return null;
  const seg = m[1].toLowerCase();
  return seg && !IG_SKIP.includes(seg) ? seg : null;
}

export async function collectCompetitorSocialStories(req: Request, res: Response) {
  const { businessProfileId, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  if (!force && shouldSkipAgent(businessProfileId, 'collectCompetitorSocialStories', MIN_INTERVAL_MS)) {
    return res.json({ upserted: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  try {
    if (!hasApifyKey()) {
      await writeAutomationLog('collectCompetitorSocialStories', businessProfileId, startTime, 0, 'success', 'no_apify_key');
      return res.json({ upserted: 0, skipped: true, reason: 'no_apify_key' });
    }

    const allCompetitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
    });
    const competitors = allCompetitors.filter((c: any) => !c.not_relevant && c.tracking_status === 'approved');

    // username -> competitor, deduped (two competitors sharing a handle is not expected)
    const byUsername = new Map<string, any>();
    const skipped: any[] = [];
    for (const comp of competitors) {
      const username = extractInstagramUsername((comp as any).instagram_url);
      if (username) byUsername.set(username, comp);
      else skipped.push({ competitor: comp.name, platform: 'instagram', status: 'skipped', reason: 'no_url' });
    }

    if (byUsername.size === 0) {
      setLastRun(businessProfileId, 'collectCompetitorSocialStories');
      await writeAutomationLog('collectCompetitorSocialStories', businessProfileId, startTime, 0, 'success', 'no_instagram_urls');
      return res.json({ upserted: 0, competitors: competitors.length, diagnostics: skipped });
    }

    const t0 = Date.now();
    let apifyError: string | null = null;
    const rawItems = await runApifyActor(
      STORIES_ACTOR,
      { usernames: Array.from(byUsername.keys()) },
      90_000,
      200,
      (msg) => { apifyError = msg; },
    );

    let firstItemKeys: string[] = [];
    let upserted = 0;
    let matched = 0;
    const insertErrors: any[] = [];

    for (const rawItem of rawItems) {
      if (firstItemKeys.length === 0) firstItemKeys = Object.keys(rawItem);

      const username = String(rawItem.user?.username || '').toLowerCase();
      const comp = byUsername.get(username);
      if (!comp) continue;
      matched++;

      const externalStoryId = pgSafe(String(rawItem.pk ?? rawItem.id ?? ''));
      if (!externalStoryId) continue;

      const isVideo = rawItem.media_type === 2 || (Array.isArray(rawItem.video_versions) && rawItem.video_versions.length > 0);
      const mediaType = isVideo ? 'video' : 'image';
      const rawMediaUrl = pgSafe(
        (isVideo ? rawItem.video_versions?.[0]?.url : null) ||
        rawItem.image_versions2?.candidates?.[0]?.url ||
        null,
      );
      const mediaUrl = rawMediaUrl && isS3Configured()
        ? (await uploadImageFromUrl(rawMediaUrl, 'competitor-stories') ?? rawMediaUrl)
        : rawMediaUrl;

      const postedAt  = rawItem.taken_at    ? new Date(rawItem.taken_at * 1000).toISOString()    : null;
      const expiresAt = rawItem.expiring_at ? new Date(rawItem.expiring_at * 1000).toISOString() : null;

      try {
        const result: number = await (prisma as any).$executeRawUnsafe(
          `INSERT INTO competitor_stories
             (id, linked_business, competitor_id, platform, external_story_id,
              media_url, media_type, posted_at, expires_at, last_seen_at)
           VALUES (
             $1,
             convert_from(decode($2, 'hex'), 'UTF8'),
             convert_from(decode($3, 'hex'), 'UTF8'),
             'instagram',
             convert_from(decode($4, 'hex'), 'UTF8'),
             NULLIF(convert_from(decode($5, 'hex'), 'UTF8'), ''),
             $6,
             $7::timestamptz,
             $8::timestamptz,
             NOW()
           )
           ON CONFLICT (competitor_id, external_story_id) DO UPDATE SET
             last_seen_at = NOW(),
             media_url = COALESCE(EXCLUDED.media_url, competitor_stories.media_url)`,
          randomUUID(),
          pgHex(businessProfileId) ?? '',
          pgHex(comp.id) ?? '',
          pgHex(externalStoryId) ?? '',
          pgHex(mediaUrl),
          mediaType,
          postedAt,
          expiresAt,
        );
        upserted += result;
      } catch (insertErr: any) {
        const errMsg = (insertErr.message ?? '').trim();
        insertErrors.push({ competitor: comp.name, externalStoryId, code: insertErr.code ?? null, error: errMsg.substring(0, 500) });
      }
    }

    const diagnostics = [
      ...skipped,
      {
        usernames_queried: byUsername.size,
        apify_returned: rawItems.length,
        matched,
        upserted,
        elapsed_ms: Date.now() - t0,
        error: apifyError,
        ...(firstItemKeys.length ? { first_item_keys: firstItemKeys } : {}),
        ...(insertErrors.length ? { insert_errors: insertErrors } : {}),
      },
    ];

    setLastRun(businessProfileId, 'collectCompetitorSocialStories');
    await writeAutomationLog('collectCompetitorSocialStories', businessProfileId, startTime, upserted, 'success');
    return res.json({ upserted, competitors: competitors.length, diagnostics });
  } catch (err: any) {
    await writeAutomationLog('collectCompetitorSocialStories', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
