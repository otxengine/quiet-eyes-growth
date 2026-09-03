import { prisma } from '../db';

interface RecordFollowerSnapshotArgs {
  linked_business: string;
  competitor_id?: string | null;
  platform: string;
  follower_count: number | null | undefined;
}

/**
 * Writes one MetricsSnapshot row per (entity, platform, day) so follower counts
 * accumulate a real history instead of being overwritten in place like
 * BusinessSocialProfile/CompetitorSocialProfile. Skips silently if there's
 * nothing to record or a snapshot for this entity+platform+day already exists
 * (idempotent under a force-triggered re-scrape within the same day).
 */
export async function recordFollowerSnapshot({
  linked_business,
  competitor_id = null,
  platform,
  follower_count,
}: RecordFollowerSnapshotArgs): Promise<void> {
  if (follower_count == null) return;
  const snapshot_date = new Date().toISOString().slice(0, 10);
  const metric_name = `followers:${platform}`;

  const existing = await prisma.metricsSnapshot.findFirst({
    where: { linked_business, competitor_id, metric_name, snapshot_date },
    select: { id: true },
  });
  if (existing) return;

  await prisma.metricsSnapshot.create({
    data: { linked_business, competitor_id, metric_name, metric_value: follower_count, snapshot_date },
  });
}
