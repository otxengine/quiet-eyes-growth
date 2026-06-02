/**
 * trendMemory.ts — Persistent checkpoint memory for trend-scanning agents.
 *
 * Prevents duplicate scanning across server restarts by persisting:
 *   - When the agent last ran (time-based skip guard, survives restarts)
 *   - Item IDs already processed (e.g. Apify video IDs)
 *   - URLs already fetched/analyzed (Tavily results)
 *
 * Storage: trend_scan_checkpoint table (created by migrate.ts).
 * Gracefully degrades to empty checkpoint if table doesn't exist yet.
 */

import { prisma } from '../db';

export interface TrendCheckpoint {
  _key: string;
  lastScanAt: Date | null;
  scannedIds: Set<string>;   // Apify item IDs, Tavily IDs, etc.
  scannedUrls: Set<string>;  // URLs already processed
  meta: Record<string, any>; // free-form scan summary
}

// ── Key builder ───────────────────────────────────────────────────────────────

function buildKey(
  agentName: string,
  businessId: string | null,
  platform: string,
  region: string,
): string {
  return `${agentName}:${businessId || 'global'}:${platform}:${region}`;
}

// ── Load ──────────────────────────────────────────────────────────────────────

export async function loadCheckpoint(
  agentName: string,
  businessId: string | null,
  platform: string,
  region = 'IL',
): Promise<TrendCheckpoint> {
  const key = buildKey(agentName, businessId, platform, region);
  const empty: TrendCheckpoint = { _key: key, lastScanAt: null, scannedIds: new Set(), scannedUrls: new Set(), meta: {} };

  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM trend_scan_checkpoint WHERE checkpoint_key = $1 LIMIT 1`,
      key,
    );
    if (!rows?.length) return empty;
    const r = rows[0];
    let ids: string[] = [];
    let urls: string[] = [];
    let meta: Record<string, any> = {};
    try { ids  = JSON.parse(r.scanned_item_ids || '[]'); } catch {}
    try { urls = JSON.parse(r.scanned_urls     || '[]'); } catch {}
    try { meta = JSON.parse(r.scan_meta        || '{}'); } catch {}
    return {
      _key: key,
      lastScanAt: r.last_scan_at ? new Date(r.last_scan_at) : null,
      scannedIds:  new Set(ids),
      scannedUrls: new Set(urls),
      meta,
    };
  } catch {
    return empty;
  }
}

// ── Save ──────────────────────────────────────────────────────────────────────
// Caps stored items at 2000 to prevent unbounded growth.

export async function saveCheckpoint(
  checkpoint: TrendCheckpoint,
  summary: Record<string, any> = {},
): Promise<void> {
  const MAX = 2000;
  const idsArr  = [...checkpoint.scannedIds ].slice(-MAX);
  const urlsArr = [...checkpoint.scannedUrls].slice(-MAX);
  const now = new Date().toISOString();

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO trend_scan_checkpoint
         (checkpoint_key, last_scan_at, scanned_item_ids, scanned_urls, scan_meta, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT (checkpoint_key)
       DO UPDATE SET
         last_scan_at      = EXCLUDED.last_scan_at,
         scanned_item_ids  = EXCLUDED.scanned_item_ids,
         scanned_urls      = EXCLUDED.scanned_urls,
         scan_meta         = EXCLUDED.scan_meta,
         updated_at        = EXCLUDED.updated_at`,
      checkpoint._key,
      now,
      JSON.stringify(idsArr),
      JSON.stringify(urlsArr),
      JSON.stringify(summary),
      now,
    );
  } catch (err: any) {
    console.warn(`[trendMemory] saveCheckpoint failed: ${err.message}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true if agent ran recently enough that we should skip this run. */
export function shouldSkipByTime(cp: TrendCheckpoint, intervalMs: number): boolean {
  if (!cp.lastScanAt) return false;
  return Date.now() - cp.lastScanAt.getTime() < intervalMs;
}

/** Filter array of IDs — returns only ones NOT yet seen. */
export function filterNewIds(ids: string[], cp: TrendCheckpoint): string[] {
  return ids.filter(id => !cp.scannedIds.has(id));
}

/** Filter array of URLs — returns only ones NOT yet seen. */
export function filterNewUrls(urls: string[], cp: TrendCheckpoint): string[] {
  return urls.filter(url => !cp.scannedUrls.has(url));
}
