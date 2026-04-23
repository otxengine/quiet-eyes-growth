import { useState, useEffect } from 'react';

// ── In-memory response cache (cleared on page refresh) ──────────────────────
const _cache = new Map<string, { data: unknown; expires: number }>();

export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = 5 * 60 * 1000,  // 5 minutes default
): Promise<T> {
  const hit = _cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data as T;

  const data = await fetcher();
  _cache.set(key, { data, expires: Date.now() + ttlMs });
  return data;
}

export function clearCache(keyPrefix?: string) {
  if (!keyPrefix) { _cache.clear(); return; }
  for (const k of _cache.keys()) {
    if (k.startsWith(keyPrefix)) _cache.delete(k);
  }
}

// ── useOptimisticData — shows fallback immediately, fills in real data ──────
export function useOptimisticData<T>(
  fetcher: () => Promise<T>,
  fallback: T,
  deps: unknown[] = [],
  timeoutMs = 8000,
): { data: T; loading: boolean; error: string | null; refetch: () => void } {
  const [data,    setData]    = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [tick,    setTick]    = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const timeout = setTimeout(() => {
      if (!cancelled) {
        setLoading(false);
        setError('הטעינה לוקחת זמן — נסה לרענן');
      }
    }, timeoutMs);

    fetcher()
      .then(result => {
        if (!cancelled) { setData(result); setError(null); }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || 'שגיאת טעינה');
      })
      .finally(() => {
        if (!cancelled) { setLoading(false); clearTimeout(timeout); }
      });

    return () => { cancelled = true; clearTimeout(timeout); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, error, refetch: () => setTick(t => t + 1) };
}
