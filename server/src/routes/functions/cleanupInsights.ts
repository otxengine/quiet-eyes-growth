import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';

/**
 * cleanupInsights — keeps the insights feed lean and relevant.
 *
 * Three operations (run in order):
 *  1. STALE: dismiss alerts that have been sitting untouched beyond their useful life.
 *     Low/medium priority expire faster — they're less time-critical.
 *  2. DEDUP: for each alert_type, if there are multiple active alerts with nearly
 *     identical title prefixes, keep only the newest (highest-priority first).
 *  3. CAP: if total active alerts still exceed MAX_ACTIVE (12), dismiss the lowest
 *     priority + oldest ones until we're within the cap.
 *
 * This runs at the top of runFullScan before any generator fires, so generators
 * always start with a clean slate and have room to add new insights.
 */

// Cap BEFORE generators run — leaves room for up to 4 new alerts from generateProactiveAlerts.
// generateProactiveAlerts has HARD_CAP=10 (skips if ≥10), so setting this to 8 ensures
// the generator always has room to add alerts after cleanup.
// cleanupAndLearn (runs at END of pipeline) then caps the final total at 10.
const MAX_ACTIVE = 8;

const STALE_DAYS: Record<string, number> = {
  low:      3,   // low-priority insights expire faster
  medium:   7,
  high:     14,
  critical: 21,
};

// Priority order for sorting (lower = higher priority)
const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export async function cleanupInsights(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  let dismissed = 0;
  let deduped = 0;
  let capped = 0;

  try {
    // ── Fetch all currently active alerts ─────────────────────────────────────
    const active = await prisma.proactiveAlert.findMany({
      where: { linked_business: businessProfileId, is_dismissed: false, is_acted_on: false },
      orderBy: { created_at: 'asc' }, // oldest first — makes cap removal easier
    });

    const now = Date.now();
    const tooDismissIds: string[] = [];

    // ── 1. STALE: dismiss alerts past their expiry ─────────────────────────────
    for (const alert of active) {
      const staleDays = STALE_DAYS[alert.priority || 'medium'] ?? 10;
      const createdAt = alert.created_at ? new Date(alert.created_at).getTime() : 0;
      const ageInDays = (now - createdAt) / 86400000;
      if (ageInDays >= staleDays) {
        tooDismissIds.push(alert.id);
        dismissed++;
      }
    }

    if (tooDismissIds.length > 0) {
      await prisma.proactiveAlert.updateMany({
        where: { id: { in: tooDismissIds } },
        data:  { is_dismissed: true },
      });
    }

    // Refresh active list after stale dismissal
    const afterStale = active.filter(a => !tooDismissIds.includes(a.id));

    // ── 1b. SPORTS SPECIFICITY: if a specific matchup alert exists ("X נגד Y"),
    //     dismiss all generic sports alerts for the same event type (no "נגד")
    //     e.g., "גמר ליגת האלופות 2026 — בעוד 23 ימים" gets dismissed when
    //     "ארסנל נגד פריז — גמר ליגת האלופות" already exists ──────────────────
    const sportsAlerts = afterStale.filter(a =>
      a.alert_type === 'market_opportunity' && (a.title || '').includes('⚽')
    );
    const specificMatchAlerts = sportsAlerts.filter(a => (a.title || '').includes('נגד'));
    if (specificMatchAlerts.length > 0) {
      const genericSports = sportsAlerts.filter(
        a => !(a.title || '').includes('נגד') && !tooDismissIds.includes(a.id)
      );
      for (const g of genericSports) {
        tooDismissIds.push(g.id);
        dismissed++;
      }
      if (genericSports.length > 0) {
        await prisma.proactiveAlert.updateMany({
          where: { id: { in: genericSports.map(g => g.id) } },
          data: { is_dismissed: true },
        });
      }
    }
    const afterSports = afterStale.filter(a => !tooDismissIds.includes(a.id));

    // ── 2. DEDUP: per alert_type, keep only best version of near-identical titles ──
    const byType: Record<string, typeof afterSports> = {};
    for (const alert of afterSports) {
      const t = alert.alert_type || 'general';
      if (!byType[t]) byType[t] = [];
      byType[t].push(alert);
    }

    const dedupDismissIds: string[] = [];
    for (const alerts of Object.values(byType)) {
      if (alerts.length <= 1) continue;

      // Group by normalized title — strip day-counter suffix ("— בעוד X ימים") and icon prefix
      // so "שבועות — בעוד 13 ימים" and "שבועות — בעוד 14 ימים" collapse to the same group
      const groups: Record<string, typeof alerts> = {};
      for (const a of alerts) {
        const key = (a.title || '')
          .replace(/\s*—?\s*בעוד\s*\d+\s*ימים.*/i, '') // strip "— בעוד X ימים" suffix
          .replace(/^[\s⚽📅🛍🌿🎵🎙️🎪🛒⚽🤝🖼️📍🎤]+/, '') // strip leading icons/whitespace
          .toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 35);
        if (!groups[key]) groups[key] = [];
        groups[key].push(a);
      }

      for (const group of Object.values(groups)) {
        if (group.length <= 1) continue;
        // Sort: highest priority first, then newest first
        group.sort((a, b) => {
          const pd = (PRIORITY_RANK[a.priority || 'medium'] ?? 2) - (PRIORITY_RANK[b.priority || 'medium'] ?? 2);
          if (pd !== 0) return pd;
          return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        });
        // Dismiss all but the first (best)
        for (const dup of group.slice(1)) {
          dedupDismissIds.push(dup.id);
          deduped++;
        }
      }
    }

    if (dedupDismissIds.length > 0) {
      await prisma.proactiveAlert.updateMany({
        where: { id: { in: dedupDismissIds } },
        data:  { is_dismissed: true },
      });
    }

    // ── 3. CAP: enforce MAX_ACTIVE hard limit ──────────────────────────────────
    const afterDedup = afterSports.filter(a => !dedupDismissIds.includes(a.id));
    if (afterDedup.length > MAX_ACTIVE) {
      // Sort: lowest priority first (dismiss these), then oldest first within priority
      const sorted = [...afterDedup].sort((a, b) => {
        const pd = (PRIORITY_RANK[b.priority || 'medium'] ?? 2) - (PRIORITY_RANK[a.priority || 'medium'] ?? 2);
        if (pd !== 0) return pd;
        return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
      });

      const excess = sorted.slice(MAX_ACTIVE);
      const capDismissIds = excess.map(a => a.id);
      capped = capDismissIds.length;

      if (capDismissIds.length > 0) {
        await prisma.proactiveAlert.updateMany({
          where: { id: { in: capDismissIds } },
          data:  { is_dismissed: true },
        });
      }
    }

    // ── 4. SIGNAL TTL: dismiss stale MarketSignals by category ──────────────
    const SIGNAL_TTL_DAYS: Record<string, number> = {
      tiktok_sector_trend:      14,
      tiktok_audience:           14,
      tiktok_post_performance:    7,
      viral_signal:         14,
      early_trend:          21,
      social:               21,
      competitor_move:      30,
      competitor_mention:   30,
      demand_gap:           30,
      opportunity:          30,
      expansion:            45,
      threat:               30,
      event:                 1,  // event signals expire day-of
      local_event:           1,
      weather_event:         3,
    };

    let signalsDismissed = 0;
    try {
      const staleSignalIds: string[] = [];
      for (const [category, ttlDays] of Object.entries(SIGNAL_TTL_DAYS)) {
        const cutoff = new Date(Date.now() - ttlDays * 86400000);
        const stale = await prisma.marketSignal.findMany({
          where: {
            linked_business: businessProfileId,
            category,
            is_dismissed: false,
            detected_at: { lte: cutoff.toISOString() },
          },
          select: { id: true },
        });
        stale.forEach(s => staleSignalIds.push(s.id));
      }
      if (staleSignalIds.length > 0) {
        await prisma.marketSignal.updateMany({
          where: { id: { in: staleSignalIds } },
          data: { is_dismissed: true },
        });
        signalsDismissed = staleSignalIds.length;
        console.log(`[cleanupInsights] dismissed ${signalsDismissed} stale signals`);
      }
    } catch (sigErr: any) {
      console.warn('[cleanupInsights] signal TTL cleanup non-fatal:', sigErr.message);
    }

    const total = dismissed + deduped + capped + signalsDismissed;
    await writeAutomationLog('cleanupInsights', businessProfileId, startTime, total);
    console.log(`[cleanupInsights] dismissed=${dismissed} deduped=${deduped} capped=${capped} signals=${signalsDismissed} total=${total}`);

    return res.json({ dismissed, deduped, capped, signals_dismissed: signalsDismissed, total_cleaned: total });

  } catch (err: any) {
    console.error('[cleanupInsights] error:', err.message);
    await writeAutomationLog('cleanupInsights', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
