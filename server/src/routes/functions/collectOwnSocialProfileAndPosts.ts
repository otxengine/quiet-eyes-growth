import { Request, Response } from 'express';
import { prisma } from '../../db';
import { collectOwnSocialProfile } from './collectOwnSocialProfile';
import { collectOwnSocialPosts } from './collectOwnSocialPosts';
import { computeInstagramDeltaSignal, computeFacebookChangedSignal, PostsDeltaSignal } from '../../lib/postsDeltaSignal';

// Scheduler-only orchestrator: runs the profile scraper, then diffs its before/after
// post_count (Instagram) / last_post_at (Facebook) to decide whether the posts scraper
// needs to run at all this cycle, and how many posts to ask for (see postsDeltaSignal.ts).
// collectOwnSocialProfile/collectOwnSocialPosts stay independently callable elsewhere
// (entities.ts, /api/functions/:name) with their default (unthrottled) behavior — this
// wrapper never changes what those two functions do, it only chains them.

type ProfileSnapshot = { platform: string; post_count: number | null; last_post_at: Date | null; fetched_at: Date };

async function snapshotProfiles(businessProfileId: string): Promise<Record<string, ProfileSnapshot>> {
  const rows = await prisma.businessSocialProfile.findMany({
    where: { linked_business: businessProfileId },
    select: { platform: true, post_count: true, last_post_at: true, fetched_at: true },
  });
  return Object.fromEntries(rows.map(r => [r.platform, r]));
}

export async function collectOwnSocialProfileAndPosts(req: Request, res: Response) {
  const { businessProfileId, force, fullBackfill } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const before = await snapshotProfiles(businessProfileId);

  await collectOwnSocialProfile(req, {
    json: () => {},
    status: () => ({ json: () => {} }),
  } as unknown as Response);

  const after = await snapshotProfiles(businessProfileId);

  const platformCapOverrides: Partial<Record<'instagram' | 'facebook', PostsDeltaSignal>> = {};
  for (const platform of Object.keys(after) as ('instagram' | 'facebook')[]) {
    const prior = before[platform];
    const current = after[platform];
    // A profile scrape can be skipped for the day (24h freshness guard) — if fetched_at
    // didn't move, we have no new information, so never trust "unchanged" as a real signal.
    const actuallyRescraped = !prior || current.fetched_at.getTime() !== prior.fetched_at.getTime();
    if (!actuallyRescraped) continue;

    const signal = platform === 'instagram'
      ? computeInstagramDeltaSignal(current.post_count, prior?.post_count ?? null)
      : computeFacebookChangedSignal(current.last_post_at, prior?.last_post_at ?? null);
    if (signal.kind !== 'unknown') platformCapOverrides[platform] = signal;
  }

  return collectOwnSocialPosts(
    { body: { businessProfileId, force, fullBackfill, platformCapOverrides } } as Request,
    res,
  );
}
