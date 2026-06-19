/**
 * insightDedup — prevents dismissed insights from being recreated by agents.
 *
 * When a user dismisses an insight, the DB record gets is_dismissed=true.
 * Without this utility, agents only check is_dismissed=false for dedup,
 * so dismissed records are re-created on the next agent run.
 *
 * Usage in agents:
 *   const dedup = await loadDismissedTitles(businessProfileId, 30);
 *   if (dedup.hasAlert('My Alert Title')) continue;
 *   if (dedup.hasSignal('My Signal Summary')) continue;
 */

import { prisma } from '../db';

export interface InsightDedupSet {
  hasAlert(title: string): boolean;
  hasSignal(summary: string): boolean;
}

const EMPTY_DEDUP: InsightDedupSet = {
  hasAlert: () => false,
  hasSignal: () => false,
};

/**
 * Load titles/summaries of recently dismissed + active alerts and signals.
 * Covers both is_dismissed=true (last `lookbackDays`) and is_dismissed=false (all).
 * Normalise: strip leading emoji, lowercase, trim.
 */
export async function loadDismissedTitles(
  businessProfileId: string,
  lookbackDays = 30,
): Promise<InsightDedupSet> {
  try {
    const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();

    const [alerts, signals] = await Promise.all([
      prisma.proactiveAlert.findMany({
        where: {
          linked_business: businessProfileId,
          OR: [
            { is_dismissed: false },
            { is_dismissed: true, created_date: { gte: new Date(since) } },
          ],
        },
        select: { title: true },
      }),
      prisma.marketSignal.findMany({
        where: {
          linked_business: businessProfileId,
          OR: [
            { is_dismissed: false },
            { is_dismissed: true, created_date: { gte: new Date(since) } },
          ],
        },
        select: { summary: true },
      }),
    ]);

    const norm = (s: string) => s.replace(/^[\p{Emoji}\s]+/u, '').split(' — ')[0].toLowerCase().trim();

    const alertSet = new Set(alerts.map(a => norm(a.title || '')));
    const signalSet = new Set(signals.map(s => norm(s.summary || '')));

    return {
      hasAlert:  (title: string)   => alertSet.has(norm(title)),
      hasSignal: (summary: string) => signalSet.has(norm(summary)),
    };
  } catch {
    return EMPTY_DEDUP;
  }
}
