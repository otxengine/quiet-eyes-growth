import { Request, Response } from 'express';
import { prisma } from '../../db';
import { postContentHash } from '../../lib/postContentHash';

const TIME_BUDGET_MS = 150_000; // stay under the frontend's 180s call timeout

interface PostRow {
  id: string;
  external_post_id: string | null;
  post_url: string | null;
  content_hash: string | null;
  caption: string | null;
  media_url: string | null;
  posted_at: string | null;
  likes: number | null;
  comments_count: number | null;
  first_seen_at: string;
  last_seen_at: string;
  analysis: string | null;
  analyzed_at: string | null;
  has_offer: boolean | null;
  has_cta: boolean | null;
}

/**
 * dedupeCompetitorPosts — one-off cleanup for duplicate competitor_posts rows
 * created before the content_hash dedup fix existed (see collectCompetitorSocialPosts.ts).
 * Groups existing rows per (competitor_id, platform) by the same content_hash the
 * live scraper now uses, merges each duplicate group into one survivor row, and
 * backfills content_hash on every row so future scrapes match reliably.
 *
 * Body: { businessProfileId, dryRun? }
 * dryRun: true reports what WOULD be merged/deleted without touching data.
 * Safe to re-run — idempotent once the backlog is clean (no groups > 1 left).
 */
export async function dedupeCompetitorPosts(req: Request, res: Response) {
  const { businessProfileId, dryRun } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const started = Date.now();
  const timeLeft = () => TIME_BUDGET_MS - (Date.now() - started);

  try {
    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
      select: { id: true, name: true },
    });

    const perCompetitor: any[] = [];
    let groupsMerged = 0;
    let rowsDeleted = 0;
    let hashesBackfilled = 0;
    let ranOutOfTime = false;

    outer:
    for (const comp of competitors) {
      for (const platform of ['instagram', 'facebook', 'tiktok']) {
        if (timeLeft() <= 0) { ranOutOfTime = true; break outer; }

        const posts = await (prisma as any).$queryRawUnsafe(
          `SELECT id, external_post_id, post_url, content_hash, caption, media_url, posted_at,
                  likes, comments_count, first_seen_at, last_seen_at, analysis, analyzed_at, has_offer, has_cta
           FROM competitor_posts WHERE competitor_id = $1 AND platform = $2`,
          comp.id, platform,
        ) as PostRow[];
        if (posts.length === 0) continue;

        const groups = new Map<string, PostRow[]>();
        for (const p of posts) {
          const hash = postContentHash(platform, p.caption, p.posted_at);
          if (!hash) continue; // caption-less — not reliable to group, leave as-is
          if (!groups.has(hash)) groups.set(hash, []);
          groups.get(hash)!.push(p);
        }

        let compMerged = 0, compDeleted = 0, compBackfilled = 0;

        for (const [hash, rows] of groups) {
          if (rows.length === 1) {
            const row = rows[0];
            if (row.content_hash !== hash) {
              compBackfilled++;
              if (!dryRun) {
                await (prisma as any).$executeRawUnsafe(
                  `UPDATE competitor_posts SET content_hash = $1 WHERE id = $2`, hash, row.id,
                ).catch(() => {});
              }
            }
            continue;
          }

          // Survivor: prefer a row that already has external_post_id, tie-break by earliest first_seen_at.
          const sorted = [...rows].sort((a, b) => {
            if (!!a.external_post_id !== !!b.external_post_id) return a.external_post_id ? -1 : 1;
            return a.first_seen_at < b.first_seen_at ? -1 : 1;
          });
          const survivor = sorted[0];
          const dupes = sorted.slice(1);

          const pick = <K extends keyof PostRow>(key: K): PostRow[K] =>
            survivor[key] ?? dupes.find(d => d[key] != null)?.[key] ?? survivor[key];
          const maxLastSeen = rows.reduce((max, r) => (r.last_seen_at > max ? r.last_seen_at : max), survivor.last_seen_at);

          compMerged++;
          compDeleted += dupes.length;
          if (!dryRun) {
            await (prisma as any).$executeRawUnsafe(
              `UPDATE competitor_posts SET
                 content_hash = $1, last_seen_at = $2::timestamptz,
                 external_post_id = $3, post_url = $4, media_url = $5,
                 analysis = $6, analyzed_at = $7::timestamptz, has_offer = $8, has_cta = $9
               WHERE id = $10`,
              hash, maxLastSeen,
              pick('external_post_id'), pick('post_url'), pick('media_url'),
              pick('analysis'), pick('analyzed_at'), pick('has_offer'), pick('has_cta'),
              survivor.id,
            ).catch(() => {});
            await (prisma as any).$executeRawUnsafe(
              `DELETE FROM competitor_posts WHERE id = ANY($1::text[])`,
              dupes.map(d => d.id),
            ).catch(() => {});
          }
        }

        if (compMerged || compDeleted || compBackfilled) {
          perCompetitor.push({ competitor: comp.name, platform, groups_merged: compMerged, rows_deleted: compDeleted, hashes_backfilled: compBackfilled });
        }
        groupsMerged += compMerged;
        rowsDeleted += compDeleted;
        hashesBackfilled += compBackfilled;
      }
    }

    return res.json({
      dry_run: !!dryRun,
      groups_merged: groupsMerged,
      rows_deleted: rowsDeleted,
      hashes_backfilled: hashesBackfilled,
      ran_out_of_time: ranOutOfTime,
      per_competitor: perCompetitor,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
