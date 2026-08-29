/**
 * useStaleInsight — auto-refresh-if-stale wrapper around a DB-persisted,
 * long-TTL insight field (e.g. BusinessProfile.offers_landscape_insight +
 * its _at timestamp).
 *
 * Deliberately separate from src/hooks/useInsight.js, which backs a
 * different thing — ephemeral 5-min sessionStorage-cached raw LLM calls,
 * not DB-persisted fields with a 48h freshness window.
 *
 * Renders the cached `value` immediately; if it's stale, silently fires
 * `refresh()` in the background (guarded so it only fires once per
 * `updatedAt`), then calls `onRefreshed(result)` on success so the caller
 * can invalidate/refetch whatever query supplies `value`/`updatedAt` —
 * mirrors the `onDone: () => queryClient.invalidateQueries(...)` convention
 * used by useAnalyzeContentTrends/useAnalyzeTopPerformers in socialShared.jsx.
 *
 * Usage:
 *   const { isStale, refreshing, error, manualRefresh } = useStaleInsight({
 *     value: businessProfile?.offers_landscape_insight,
 *     updatedAt: businessProfile?.offers_landscape_insight_at,
 *     enabled: !!bpId,
 *     refresh: (opts) => base44.functions.invoke('analyzeOffersLandscape', { businessProfileId: bpId, force: opts?.force }),
 *     onRefreshed: () => queryClient.invalidateQueries({ queryKey: ['businessProfiles'] }),
 *   });
 */
import { useState, useEffect, useCallback, useRef } from 'react';

const DEFAULT_TTL_MS = 48 * 60 * 60 * 1000; // 48h

export function useStaleInsight({ value, updatedAt, ttlMs = DEFAULT_TTL_MS, enabled = true, refresh, onRefreshed }) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  // Keyed by `updatedAt` so a background refresh is attempted at most once per
  // cached value — survives StrictMode's double-invoke and re-renders that
  // don't actually change updatedAt.
  const attemptedForRef = useRef(undefined);
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  const isStale = !updatedAt || (Date.now() - new Date(updatedAt).getTime()) >= ttlMs;

  const runRefresh = useCallback(async (opts) => {
    if (!refresh) return;
    setRefreshing(true);
    setError(null);
    try {
      const result = await refresh(opts);
      if (!isMountedRef.current) return result;
      onRefreshed?.(result);
      return result;
    } catch (e) {
      console.warn('[useStaleInsight] refresh failed:', e.message);
      if (isMountedRef.current) setError(e.message || 'רענון נכשל');
    } finally {
      if (isMountedRef.current) setRefreshing(false);
    }
  }, [refresh, onRefreshed]);

  useEffect(() => {
    if (!enabled || !isStale || !refresh) return;
    if (attemptedForRef.current === updatedAt) return;
    attemptedForRef.current = updatedAt;
    runRefresh({ force: false });
    // Deliberately keyed only on [updatedAt, enabled] — runRefresh/isStale are
    // derived from the same inputs (plus refresh/onRefreshed, which are
    // expected to be stable-enough callbacks), so including them would just
    // cause redundant re-triggers of the same updatedAt-guarded effect.
  }, [updatedAt, enabled]);

  const manualRefresh = useCallback(() => runRefresh({ force: true }), [runRefresh]);

  return { isStale, refreshing, error, manualRefresh };
}
