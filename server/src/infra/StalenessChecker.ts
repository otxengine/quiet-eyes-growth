/**
 * StalenessChecker — expiration and freshness rules for all data layers.
 *
 * Stale data windows (configurable via ConfigResolver):
 * - raw signals:        48 hours
 * - fused insights:     6 hours
 * - forecasts:          24 hours
 * - recommendations:    72 hours (or recommended_timing window)
 * - opportunities:      expected_window_end (or 7 days)
 *
 * Rules:
 * - stale insights must not trigger execution without refresh
 * - expired recommendations are blocked from dispatch
 * - signals beyond stale window decay confidence
 * - learning memory marks freshness levels
 */

export type FreshnessLevel = 'fresh' | 'aging' | 'stale' | 'expired';

// Default stale windows (hours) — override via ConfigResolver in production
export const DEFAULT_STALE_WINDOWS = {
  signal_hours:         48,
  insight_hours:        6,
  forecast_hours:       24,
  recommendation_hours: 72,
  opportunity_days:     7,
  memory_days_fresh:    7,
  memory_days_aging:    30,
} as const;

// ─── Core staleness functions ─────────────────────────────────────────────────

function ageHours(isoTimestamp: string): number {
  return (Date.now() - new Date(isoTimestamp).getTime()) / 3_600_000;
}

function ageDays(isoTimestamp: string): number {
  return ageHours(isoTimestamp) / 24;
}

// ─── Signal staleness ─────────────────────────────────────────────────────────

export function isSignalStale(
  collectedAt: string,
  staleHours: number = DEFAULT_STALE_WINDOWS.signal_hours,
): boolean {
  return ageHours(collectedAt) > staleHours;
}

export function signalFreshness(
  collectedAt: string,
  staleHours = DEFAULT_STALE_WINDOWS.signal_hours,
): FreshnessLevel {
  const age = ageHours(collectedAt);
  if (age > staleHours)          return 'expired';
  if (age > staleHours * 0.75)   return 'stale';
  if (age > staleHours * 0.50)   return 'aging';
  return 'fresh';
}

/** Confidence decay factor for stale signals (0.0 – 1.0) */
export function signalConfidenceDecay(
  collectedAt: string,
  staleHours = DEFAULT_STALE_WINDOWS.signal_hours,
): number {
  const age   = ageHours(collectedAt);
  const ratio = age / staleHours;        // 0 = fresh, 1 = at stale boundary
  if (ratio <= 0) return 1.0;
  if (ratio >= 1) return 0.2;            // floor: don't zero out entirely
  return Math.max(0.2, 1 - ratio * 0.8);
}

// ─── Insight staleness ────────────────────────────────────────────────────────

export function isInsightStale(
  createdAt: string,
  staleHours = DEFAULT_STALE_WINDOWS.insight_hours,
): boolean {
  return ageHours(createdAt) > staleHours;
}

/**
 * Guard: stale insight must not trigger execution without refresh.
 * Throws if insight is stale.
 */
export function assertInsightFresh(createdAt: string, insightId: string): void {
  if (isInsightStale(createdAt)) {
    throw new Error(
      `Insight ${insightId} is stale (created ${ageHours(createdAt).toFixed(1)}h ago, ` +
      `limit is ${DEFAULT_STALE_WINDOWS.insight_hours}h). Refresh required before execution.`,
    );
  }
}

// ─── Forecast staleness ───────────────────────────────────────────────────────

export function isForecastStale(
  forecastWindowEnd: string,
  staleHours = DEFAULT_STALE_WINDOWS.forecast_hours,
): boolean {
  // A forecast is stale if its window has passed or it's older than staleHours
  const windowPassed = new Date(forecastWindowEnd).getTime() < Date.now();
  return windowPassed;
}

export function isForecastRelevant(
  forecastWindowStart: string,
  forecastWindowEnd: string,
): boolean {
  const now = Date.now();
  const start = new Date(forecastWindowStart).getTime();
  const end   = new Date(forecastWindowEnd).getTime();
  return now >= start && now <= end;
}

// ─── Recommendation staleness ─────────────────────────────────────────────────

export function isRecommendationExpired(
  createdAt: string,
  recommendedTiming: string | null,
  staleHours = DEFAULT_STALE_WINDOWS.recommendation_hours,
): boolean {
  // Expired if the recommended timing window has passed
  if (recommendedTiming && new Date(recommendedTiming).getTime() < Date.now()) {
    return true;
  }
  // Or if older than the stale window
  return ageHours(createdAt) > staleHours;
}

/**
 * Guard: expired recommendation must not be dispatched.
 */
export function assertRecommendationFresh(
  createdAt: string,
  recommendedTiming: string | null,
  recommendationId: string,
): void {
  if (isRecommendationExpired(createdAt, recommendedTiming)) {
    throw new Error(
      `Recommendation ${recommendationId} has expired and cannot be dispatched. ` +
      `Regenerate from a fresh insight.`,
    );
  }
}

// ─── Opportunity staleness ────────────────────────────────────────────────────

export function isOpportunityExpired(
  windowEnd: string | null,
  createdAt: string,
  maxDays = DEFAULT_STALE_WINDOWS.opportunity_days,
): boolean {
  if (windowEnd && new Date(windowEnd).getTime() < Date.now()) return true;
  return ageDays(createdAt) > maxDays;
}

// ─── Memory freshness ─────────────────────────────────────────────────────────

export function memoryFreshness(lastUpdatedAt: string): FreshnessLevel {
  const days = ageDays(lastUpdatedAt);
  if (days <= DEFAULT_STALE_WINDOWS.memory_days_fresh)  return 'fresh';
  if (days <= DEFAULT_STALE_WINDOWS.memory_days_aging)  return 'aging';
  return 'stale';
}

// ─── Batch check ─────────────────────────────────────────────────────────────

export interface PipelineDataFreshness {
  signals_ok:         boolean;
  insight_ok:         boolean;
  recommendations_ok: boolean;
  blocking_issues:    string[];
}

export function checkPipelineFreshness(params: {
  signalCollectedAt:  string | null;
  insightCreatedAt:   string | null;
  recCreatedAt:       string | null;
  recTiming:          string | null;
}): PipelineDataFreshness {
  const issues: string[] = [];

  const signals_ok = params.signalCollectedAt
    ? !isSignalStale(params.signalCollectedAt)
    : false;

  const insight_ok = params.insightCreatedAt
    ? !isInsightStale(params.insightCreatedAt)
    : false;

  const recommendations_ok = params.recCreatedAt
    ? !isRecommendationExpired(params.recCreatedAt, params.recTiming)
    : false;

  if (!signals_ok)         issues.push('signals_stale_or_missing');
  if (!insight_ok)         issues.push('insight_stale_or_missing');
  if (!recommendations_ok) issues.push('recommendation_expired_or_missing');

  return { signals_ok, insight_ok, recommendations_ok, blocking_issues: issues };
}
