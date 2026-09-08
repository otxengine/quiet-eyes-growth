// Pure signal-computation for the profile-scraper -> posts-scraper cost-saving hand-off.
// Instagram's profile scrape returns an exact running post_count; Facebook's never does
// (only last_post_at). See collectOwnSocialProfileAndPosts.ts / collectCompetitorSocialProfileAndPosts.ts
// for how the before/after profile snapshot is diffed into these signals, and
// collectOwnSocialPosts.ts / collectCompetitorSocialPosts.ts for how they gate the Apify call.

export type PostsDeltaSignal =
  | { kind: 'skip' }                    // confirmed nothing new — don't call Apify at all
  | { kind: 'clamped'; limit: number }  // Instagram only: exact new-post count, clamped
  | { kind: 'unknown' };                // no reliable signal — use today's default cap logic

// ponytail: steady-state cap is 5; this ceiling bounds a real multi-post day (or a
// missed-day catch-up where the profile scrape was skipped once) without ballooning
// back up toward the 150-post backfill size. Raise if a specific account looks incomplete.
export const INSTAGRAM_DELTA_CEILING = 30;

export function computeInstagramDeltaSignal(
  todayPostCount: number | null,
  priorPostCount: number | null,
): PostsDeltaSignal {
  if (todayPostCount == null || priorPostCount == null) return { kind: 'unknown' };
  const delta = todayPostCount - priorPostCount;
  // Deletions don't rule out new posts also existing (net count can drop while new
  // content was added) — fall back to default behavior rather than risk a silent miss.
  if (delta < 0) return { kind: 'unknown' };
  if (delta === 0) return { kind: 'skip' };
  return { kind: 'clamped', limit: Math.min(delta, INSTAGRAM_DELTA_CEILING) };
}

export function computeFacebookChangedSignal(
  todayLastPostAt: Date | null,
  priorLastPostAt: Date | null,
): PostsDeltaSignal {
  if (todayLastPostAt == null || priorLastPostAt == null) return { kind: 'unknown' };
  // Facebook's actor never returns a count — a change just falls back to the existing
  // default cap logic (unknown), it can't be sized precisely like Instagram's delta.
  return todayLastPostAt.getTime() === priorLastPostAt.getTime() ? { kind: 'skip' } : { kind: 'unknown' };
}
