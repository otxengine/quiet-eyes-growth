import { Request, Response } from 'express';
import { prisma } from '../../db';
import { collectCompetitorSocialProfile } from './collectCompetitorSocialProfile';
import { collectCompetitorSocialPosts } from './collectCompetitorSocialPosts';
import { computeInstagramDeltaSignal, computeFacebookChangedSignal, PostsDeltaSignal } from '../../lib/postsDeltaSignal';

// Competitor twin of collectOwnSocialProfileAndPosts.ts — scheduler-only orchestrator that
// runs the competitor profile scraper for a business's whole competitor list, then diffs
// each (competitor, platform)'s before/after post_count (Instagram) / last_post_at (Facebook)
// to decide whether that competitor+platform needs a posts scrape this cycle, and how many
// posts to ask for (see postsDeltaSignal.ts). collectCompetitorSocialProfile/
// collectCompetitorSocialPosts stay independently callable elsewhere (entities.ts's manual
// "add competitor" flow, /api/functions/:name) with their default (unthrottled) behavior —
// this wrapper never changes what those two functions do, it only chains them.

type ProfileSnapshot = { competitor_id: string; platform: string; post_count: number | null; last_post_at: Date | null; fetched_at: Date };

async function snapshotProfiles(businessProfileId: string): Promise<Record<string, ProfileSnapshot>> {
  const rows = await prisma.competitorSocialProfile.findMany({
    where: { linked_business: businessProfileId },
    select: { competitor_id: true, platform: true, post_count: true, last_post_at: true, fetched_at: true },
  });
  return Object.fromEntries(rows.map(r => [`${r.competitor_id}:${r.platform}`, r]));
}

export async function collectCompetitorSocialProfileAndPosts(req: Request, res: Response) {
  const { businessProfileId, force, fullBackfill } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const before = await snapshotProfiles(businessProfileId);

  await collectCompetitorSocialProfile(req, {
    json: () => {},
    status: () => ({ json: () => {} }),
  } as unknown as Response);

  const after = await snapshotProfiles(businessProfileId);

  const competitorPlatformOverrides: Record<string, Partial<Record<'instagram' | 'facebook', PostsDeltaSignal>>> = {};
  for (const key of Object.keys(after)) {
    const current = after[key];
    const prior = before[key];
    // A profile scrape can be skipped for the day (24h freshness guard) — if fetched_at
    // didn't move, we have no new information, so never trust "unchanged" as a real signal.
    const actuallyRescraped = !prior || current.fetched_at.getTime() !== prior.fetched_at.getTime();
    if (!actuallyRescraped) continue;

    const platform = current.platform as 'instagram' | 'facebook';
    const signal = platform === 'instagram'
      ? computeInstagramDeltaSignal(current.post_count, prior?.post_count ?? null)
      : computeFacebookChangedSignal(current.last_post_at, prior?.last_post_at ?? null);
    if (signal.kind === 'unknown') continue;

    (competitorPlatformOverrides[current.competitor_id] ??= {})[platform] = signal;
  }

  return collectCompetitorSocialPosts(
    { body: { businessProfileId, force, fullBackfill, competitorPlatformOverrides } } as Request,
    res,
  );
}
