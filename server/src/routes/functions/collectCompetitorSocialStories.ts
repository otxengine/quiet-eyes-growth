import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { prisma } from '../../db';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { writeAutomationLog } from '../../lib/automationLog';
import { uploadImageFromUrl, isS3Configured } from '../../lib/s3';
import { analyzePostCreative } from '../../lib/analyzePostCreative';
import { findDonorCandidates } from '../../lib/competitorDonor';

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

    // Cross-business archive backfill — unlike collectCompetitorSocialPosts.ts's donor
    // cache, this isn't primarily a cost optimization: once a story expires on
    // Instagram, Apify can never scrape it again, so cloning another business's
    // already-archived rows for the SAME real-world competitor is the only way a
    // newly-tracking business recovers that history. Runs every scrape (not just
    // once) — cheap (NOT EXISTS anti-join, no Apify cost) and self-converges as more
    // businesses' scrapes add to the shared pool. Not freshness-gated on purpose:
    // old rows are exactly what a fresh Apify call can't get back.
    let donorCloned = 0;
    for (const comp of byUsername.values()) {
      const donors = await findDonorCandidates(comp.id, businessProfileId, {
        googlePlaceId: comp.google_place_id ?? null,
        platform: 'instagram',
        urlValue: comp.instagram_url,
      });
      if (donors.length === 0) continue;
      const cloned = await (prisma as any).$executeRawUnsafe(
        `INSERT INTO competitor_stories
           (id, linked_business, competitor_id, platform, external_story_id,
            media_url, media_type, video_url, posted_at, expires_at, first_seen_at, last_seen_at,
            analysis, analyzed_at, video_analyzed_at, has_offer, has_cta)
         SELECT gen_random_uuid()::text, $1, $2, d.platform, d.external_story_id,
                d.media_url, d.media_type, d.video_url, d.posted_at, d.expires_at, d.first_seen_at, d.last_seen_at,
                d.analysis, d.analyzed_at, d.video_analyzed_at, d.has_offer, d.has_cta
         FROM competitor_stories d
         WHERE d.competitor_id = ANY($3::text[]) AND d.platform = 'instagram'
           AND NOT EXISTS (
             SELECT 1 FROM competitor_stories o
             WHERE o.competitor_id = $2 AND o.external_story_id = d.external_story_id
           )`,
        businessProfileId, comp.id, donors.map(d => d.id),
      ) as number;
      donorCloned += Number(cloned) || 0;
    }

    // Pre-fetch existing rows' analysis state, so a re-scrape of a story we've already
    // seen doesn't re-pay for a vision-LLM call on it — separately tracks video analysis
    // (video_analyzed_at) from general analysis (analyzed_at), since a story analyzed
    // before video support existed still needs its one real video pass.
    const existingRows = await (prisma as any).$queryRawUnsafe(
      `SELECT competitor_id, external_story_id, analyzed_at, video_analyzed_at FROM competitor_stories
       WHERE competitor_id = ANY($1::text[])`,
      competitors.map((c: any) => c.id),
    ) as { competitor_id: string; external_story_id: string; analyzed_at: string | null; video_analyzed_at: string | null }[];
    const existingByKey = new Map(existingRows.map(r => [`${r.competitor_id}:${r.external_story_id}`, r]));

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
    let analyzed = 0;
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
      // media_url is always the cover-frame thumbnail (never the raw video — a
      // vision-only LLM can't digest that); the raw video file goes in video_url.
      const rawMediaUrl = pgSafe(rawItem.image_versions2?.candidates?.[0]?.url || null);
      const rawVideoUrl = pgSafe(isVideo ? (rawItem.video_versions?.[0]?.url || null) : null);
      const mediaUrl = rawMediaUrl && isS3Configured()
        ? (await uploadImageFromUrl(rawMediaUrl, 'competitor-stories') ?? rawMediaUrl)
        : rawMediaUrl;

      const postedAt  = rawItem.taken_at    ? new Date(rawItem.taken_at * 1000).toISOString()    : null;
      const expiresAt = rawItem.expiring_at ? new Date(rawItem.expiring_at * 1000).toISOString() : null;

      try {
        const rows = await (prisma as any).$queryRawUnsafe(
          `INSERT INTO competitor_stories
             (id, linked_business, competitor_id, platform, external_story_id,
              media_url, media_type, video_url, posted_at, expires_at, last_seen_at)
           VALUES (
             $1,
             convert_from(decode($2, 'hex'), 'UTF8'),
             convert_from(decode($3, 'hex'), 'UTF8'),
             'instagram',
             convert_from(decode($4, 'hex'), 'UTF8'),
             NULLIF(convert_from(decode($5, 'hex'), 'UTF8'), ''),
             $6,
             NULLIF(convert_from(decode($9, 'hex'), 'UTF8'), ''),
             $7::timestamptz,
             $8::timestamptz,
             NOW()
           )
           ON CONFLICT (competitor_id, external_story_id) DO UPDATE SET
             last_seen_at = NOW(),
             media_url = COALESCE(EXCLUDED.media_url, competitor_stories.media_url),
             video_url = COALESCE(EXCLUDED.video_url, competitor_stories.video_url)
           RETURNING id`,
          randomUUID(),
          pgHex(businessProfileId) ?? '',
          pgHex(comp.id) ?? '',
          pgHex(externalStoryId) ?? '',
          pgHex(mediaUrl),
          mediaType,
          postedAt,
          expiresAt,
          pgHex(rawVideoUrl) ?? '',
        ) as { id: string }[];
        const rowId = rows[0]?.id;
        if (rowId) upserted++;

        // Best-effort creative analysis (topic/offer/hooks/style/cta, plus real video
        // understanding when this is a video story) — skips stories already fully
        // analyzed on a prior scrape; never blocks the loop.
        const existingRow = existingByKey.get(`${comp.id}:${externalStoryId}`);
        const needsAnalysis = rowId && (mediaUrl || rawVideoUrl) &&
          (!existingRow?.analyzed_at || (rawVideoUrl && !existingRow?.video_analyzed_at));
        if (needsAnalysis) {
          const useVideoUrl = existingRow?.video_analyzed_at ? null : rawVideoUrl;
          try {
            const analysis = await analyzePostCreative({ caption: null, platform: 'instagram', mediaUrl, videoUrl: useVideoUrl });
            if (analysis) {
              await (prisma as any).$executeRawUnsafe(
                `UPDATE competitor_stories SET analysis = convert_from(decode($1, 'hex'), 'UTF8'), analyzed_at = NOW(), has_offer = $2, has_cta = $3
                 ${useVideoUrl && analysis.video_description != null ? ', video_analyzed_at = NOW()' : ''}
                 WHERE id = $4`,
                pgHex(JSON.stringify(analysis)) ?? '',
                analysis.has_offer,
                analysis.has_cta,
                rowId,
              );
              analyzed++;
            }
          } catch (analysisErr: any) {
            console.warn('[collectCompetitorSocialStories] creative analysis failed:', analysisErr.message);
          }
        }
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
        donor_cloned: donorCloned,
        analyzed,
        elapsed_ms: Date.now() - t0,
        error: apifyError,
        ...(firstItemKeys.length ? { first_item_keys: firstItemKeys } : {}),
        ...(insertErrors.length ? { insert_errors: insertErrors } : {}),
      },
    ];

    const totalUpserted = upserted + donorCloned;
    setLastRun(businessProfileId, 'collectCompetitorSocialStories');
    await writeAutomationLog('collectCompetitorSocialStories', businessProfileId, startTime, totalUpserted, 'success');
    return res.json({ upserted: totalUpserted, competitors: competitors.length, diagnostics });
  } catch (err: any) {
    await writeAutomationLog('collectCompetitorSocialStories', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
