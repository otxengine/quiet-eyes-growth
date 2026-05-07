/**
 * agentCache — shared in-memory TTL cache for LLM responses and API results.
 *
 * Used to avoid re-computing expensive AI calls for the same input within a
 * configurable time window. Keys are caller-defined strings (e.g. prompt hash,
 * "businessId:agentName:date").
 *
 * TTL defaults:
 *   LLM responses  → 4 hours  (same business context unlikely to change faster)
 *   API results    → 4 hours  (Google Places, Tavily, Apify)
 *   Trend data     → 6 hours
 */

export interface CacheEntry<T = any> {
  value: T;
  expiresAt: number;
}

const _store = new Map<string, CacheEntry>();

export function cacheGet<T = any>(key: string): T | null {
  const entry = _store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function cacheSet<T = any>(key: string, value: T, ttlMs: number): void {
  _store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheDelete(key: string): void {
  _store.delete(key);
}

export function cacheClear(): void {
  _store.clear();
}

export function cacheSize(): number {
  return _store.size;
}

// ─── TTL constants ────────────────────────────────────────────────────────────

export const TTL = {
  LLM_RESPONSE:   4 * 60 * 60 * 1000,  // 4 hours
  API_RESULT:     4 * 60 * 60 * 1000,  // 4 hours
  TREND_DATA:     6 * 60 * 60 * 1000,  // 6 hours
  GOOGLE_PLACES: 24 * 60 * 60 * 1000,  // 24 hours
  SHORT:          30 * 60 * 1000,       // 30 minutes
};

// ─── Simple prompt hasher (no crypto dependency) ──────────────────────────────

export function hashPrompt(prompt: string): string {
  let h = 0;
  for (let i = 0; i < prompt.length; i++) {
    h = Math.imul(31, h) + prompt.charCodeAt(i) | 0;
  }
  return (h >>> 0).toString(36);
}

// ─── Agent last-run tracker (for delta processing) ────────────────────────────

const _lastRun = new Map<string, number>(); // key: "businessId:agentName"

export function getLastRun(businessId: string, agentName: string): number {
  return _lastRun.get(`${businessId}:${agentName}`) ?? 0;
}

export function setLastRun(businessId: string, agentName: string): void {
  _lastRun.set(`${businessId}:${agentName}`, Date.now());
}

export function shouldSkipAgent(
  businessId: string,
  agentName: string,
  minIntervalMs: number,
): boolean {
  const last = getLastRun(businessId, agentName);
  return last > 0 && (Date.now() - last) < minIntervalMs;
}
