import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useStaleInsight } from '@/hooks/useStaleInsight';
import { OFFER_MECHANIC_LABELS, CHANNEL_LABELS } from '@/lib/offerLabels';
import { API_BASE, PLATFORM_LABELS, PLATFORM_COLORS, fmtCount } from '@/components/competitors/socialShared';
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
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleExpanded = (i) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(i) ? next.delete(i) : next.add(i);
    return next;
  });

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
          <div className="space-y-1.5">
            {examples.slice(0, 4).map((ex, i) => {
              const isOpen = expanded.has(i);
              const thumb = ex.media_url || ex.video_url;
              return (
                <div key={i} className="border border-border/60 rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(i)}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] text-foreground-muted hover:bg-muted/40 transition-colors text-right"
                  >
                    <span className="flex-1 truncate">
                      <span className="font-semibold">{ex.competitorName}</span> ({ex.date}): "{ex.offer_details}"
                    </span>
                    {isOpen ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                  {isOpen && (
                    <div className="border-t border-border/60 p-2.5 space-y-2 bg-muted/20">
                      {thumb && (
                        <img
                          src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(thumb)}`}
                          alt=""
                          className="w-full max-h-56 rounded object-cover"
                          loading="lazy"
                          onError={e => { e.currentTarget.style.display = 'none'; }}
                        />
                      )}
                      <div className="flex items-center gap-2 text-[10px] flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded ${PLATFORM_COLORS[ex.platform] || 'bg-gray-100 text-gray-700'}`}>
                          {PLATFORM_LABELS[ex.platform] || ex.platform}
                        </span>
                        <span className="text-foreground-muted">{ex.type === 'ad' ? 'מודעה ממומנת' : 'פוסט אורגני'}</span>
                        {(ex.likes != null || ex.comments_count != null) && (
                          <span className="text-foreground-muted">
                            {ex.likes != null && `❤️ ${fmtCount(ex.likes)}`}{' '}
                            {ex.comments_count != null && `💬 ${fmtCount(ex.comments_count)}`}
                          </span>
                        )}
                      </div>
                      {ex.type === 'ad' ? (
                        <>
                          {ex.title && <p className="text-[12px] font-semibold text-foreground">{ex.title}</p>}
                          {ex.body && <p className="text-[12px] leading-relaxed text-foreground whitespace-pre-wrap">{ex.body}</p>}
                          {ex.cta && (
                            <span className="inline-block bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 rounded">{ex.cta}</span>
                          )}
                        </>
                      ) : (
                        ex.caption && <p className="text-[12px] leading-relaxed text-foreground whitespace-pre-wrap">{ex.caption}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
            {stats.channel_breakdown?.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-secondary text-foreground-muted">
                📢 {stats.channel_breakdown.map(c => `${CHANNEL_LABELS[c.value] || c.value} ${c.count}/${stats.total_offers}`).join(' · ')}
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
