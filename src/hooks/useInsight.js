/**
 * useInsight — fetches an AI insight and caches it in sessionStorage.
 *
 * Cache key = SHA-like hash of the prompt string.
 * TTL = 5 minutes (300 seconds).
 *
 * Usage:
 *   const { insight, loading, error, refresh } = useInsight(prompt);
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheKey(prompt) {
  // Simple deterministic hash for the prompt
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    hash = (Math.imul(31, hash) + prompt.charCodeAt(i)) | 0;
  }
  return `insight_cache_${(hash >>> 0).toString(36)}`;
}

function readCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { value, expiresAt } = JSON.parse(raw);
    if (Date.now() > expiresAt) { sessionStorage.removeItem(key); return null; }
    return value;
  } catch { return null; }
}

function writeCache(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ value, expiresAt: Date.now() + CACHE_TTL_MS }));
  } catch { /* quota exceeded — ignore */ }
}

export function useInsight(prompt, { autoFetch = false } = {}) {
  const [insight, setInsight] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const isMountedRef = useRef(true);

  const key = prompt ? cacheKey(prompt) : null;

  // On mount — load from cache immediately
  useEffect(() => {
    isMountedRef.current = true;
    if (key) {
      const cached = readCache(key);
      if (cached) setInsight(cached);
    }
    return () => { isMountedRef.current = false; };
  }, [key]);

  const fetch_ = useCallback(async (force = false) => {
    if (!prompt) return;
    if (!force && key) {
      const cached = readCache(key);
      if (cached) { setInsight(cached); return; }
    }
    setLoading(true);
    setError(null);
    try {
      const result = await base44.integrations.Core.InvokeLLM({ prompt });
      if (!isMountedRef.current) return;
      setInsight(result);
      if (key) writeCache(key, result);
    } catch (err) {
      if (!isMountedRef.current) return;
      console.error('[useInsight] LLM failed:', err);
      setError('לא ניתן לטעון תובנה — נסה שוב');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [prompt, key]);

  // Auto-fetch if requested and no cache
  useEffect(() => {
    if (autoFetch && key && !insight && !loading) {
      const cached = readCache(key);
      if (!cached) fetch_(false);
    }
  }, [autoFetch, key]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    insight,
    loading,
    error,
    fetch: () => fetch_(false),
    refresh: () => fetch_(true),
  };
}
