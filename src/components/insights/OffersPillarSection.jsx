import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useStaleInsight } from '@/hooks/useStaleInsight';
import { OFFER_MECHANIC_LABELS } from '@/lib/offerLabels';
import PillarRefreshBadge from './PillarRefreshBadge';

/**
 * "מבצעי מתחרים" — pooled cross-competitor offers landscape narrative +
 * deterministic stat chips (BusinessProfile.offers_landscape_*). Auto-
 * refreshes in the background when the cached insight is >48h stale, via
 * useStaleInsight + analyzeOffersLandscape.
 */
export default function OffersPillarSection({ businessProfile }) {
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();

  const insight = businessProfile?.offers_landscape_insight;
  const updatedAt = businessProfile?.offers_landscape_insight_at;
  const stats = useMemo(() => {
    try { return businessProfile?.offers_landscape_stats ? JSON.parse(businessProfile.offers_landscape_stats) : null; }
    catch { return null; }
  }, [businessProfile?.offers_landscape_stats]);
  const examples = useMemo(() => {
    try { return businessProfile?.offers_landscape_examples ? JSON.parse(businessProfile.offers_landscape_examples) : []; }
    catch { return []; }
  }, [businessProfile?.offers_landscape_examples]);

  const { refreshing, manualRefresh } = useStaleInsight({
    value: insight,
    updatedAt,
    enabled: !!bpId,
    refresh: (opts) =>
      base44.functions.invoke('analyzeOffersLandscape', { businessProfileId: bpId, force: opts?.force }, 120000),
    // businessProfile arrives via AppLayout's ['businessProfiles', user?.email] query and is
    // handed down through outlet context (no dedicated single-profile query key exists) —
    // invalidating the ['businessProfiles'] prefix refetches it and flows the new fields down.
    onRefreshed: () => queryClient.invalidateQueries({ queryKey: ['businessProfiles'] }),
  });

  if (!insight && !stats) return null;

  const topMechanic = stats?.mechanic_breakdown?.[0];

  return (
    <div className="card-base fade-in-up">
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
        <h3 className="text-[16px] font-bold text-foreground">מבצעי מתחרים</h3>
        <PillarRefreshBadge updatedAt={updatedAt} refreshing={refreshing} onRefresh={manualRefresh} />
      </div>

      <div className="p-5 space-y-3">
        {insight && <p className="text-[13px] leading-relaxed text-foreground">{insight}</p>}

        {examples.length > 0 && (
          <ul className="space-y-1">
            {examples.slice(0, 4).map((ex, i) => (
              <li key={i} className="text-[11px] text-foreground-muted">
                <span className="font-semibold">{ex.competitorName}</span> ({ex.date}): "{ex.offer_details}"
              </li>
            ))}
          </ul>
        )}

        {stats && (
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            {stats.competitors_total > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                🏷️ {stats.competitors_with_active_offer}/{stats.competitors_total} מתחרים עם מבצע פעיל
              </span>
            )}
            {stats.peak_day && (
              <span className="px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                📅 שיא ב{stats.peak_day} ({stats.peak_day_count}/{stats.total_offers})
              </span>
            )}
            {stats.avg_interval_days != null && (
              <span className="px-1.5 py-0.5 rounded-full bg-secondary text-foreground-muted">
                ⏱️ מבצע כל ~{stats.avg_interval_days} ימים
              </span>
            )}
            {topMechanic && (
              <span className="px-1.5 py-0.5 rounded-full bg-secondary text-foreground-muted">
                💰 {OFFER_MECHANIC_LABELS[topMechanic.value] || topMechanic.value} ({topMechanic.count}/{stats.total_offers})
              </span>
            )}
            {stats.urgency_pct > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
                ⚡ {stats.urgency_pct}% עם תחושת דחיפות
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
