import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useStaleInsight } from '@/hooks/useStaleInsight';
import { apiFetch } from '@/components/competitors/socialShared';
import ReviewsInsightsRadar from '@/components/competitors/ReviewsInsightsRadar';
import PillarRefreshBadge from './PillarRefreshBadge';

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

const TREND_META = {
  improving: { icon: TrendingUp, label: 'משתפר', className: 'text-emerald-600' },
  declining: { icon: TrendingDown, label: 'יורד', className: 'text-red-600' },
  stable:    { icon: Minus, label: 'יציב', className: 'text-foreground-muted' },
};

function TrendBadge({ trend }) {
  const meta = TREND_META[trend];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${meta.className}`}>
      <Icon className="w-3.5 h-3.5" /> {meta.label}
    </span>
  );
}

function OwnReviewsBlock({ businessProfile, queryClient }) {
  const bpId = businessProfile?.id;
  const insight = businessProfile?.own_reviews_pillar_insight;
  const updatedAt = businessProfile?.own_reviews_pillar_insight_at;
  const examples = useMemo(
    () => parseJson(businessProfile?.own_reviews_pillar_examples, []),
    [businessProfile?.own_reviews_pillar_examples],
  );

  const { refreshing, manualRefresh } = useStaleInsight({
    value: insight,
    updatedAt,
    enabled: !!bpId,
    refresh: (opts) =>
      base44.functions.invoke('analyzeOwnReviewInsights', { businessProfileId: bpId, force: opts?.force }, 120000),
    onRefreshed: () => queryClient.invalidateQueries({ queryKey: ['businessProfiles'] }),
  });

  // Cheap DB query, no LLM — computed fresh on every load rather than cached
  // on BusinessProfile like `insight` above, so it's never stale.
  const { data: trendData } = useQuery({
    queryKey: ['ownReviewTrend', bpId],
    queryFn: () => apiFetch(`/competitors/reviews/own-trend?businessProfileId=${bpId}`),
    enabled: !!bpId,
  });

  if (!insight && !examples.length) return null;

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-[13px] font-bold text-foreground">הלקוחות שלך</h4>
          <TrendBadge trend={trendData?.trend} />
        </div>
        <PillarRefreshBadge updatedAt={updatedAt} refreshing={refreshing} onRefresh={manualRefresh} />
      </div>
      {insight && <p className="text-[13px] leading-relaxed text-foreground">{insight}</p>}
      {examples.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {examples.slice(0, 4).map((ex, i) => (
            <span
              key={i}
              className={`text-[10px] px-2 py-1 rounded-full border max-w-full truncate ${
                ex.polarity === 'negative'
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}
              title={ex.text}
            >
              {ex.polarity === 'negative' ? '⚠️' : '💚'} {ex.theme}: "{ex.text}"
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CompetitorReviewsBlock({ businessProfile, queryClient, trackedCompetitors }) {
  const bpId = businessProfile?.id;
  const insight = businessProfile?.competitor_reviews_pillar_insight;
  const updatedAt = businessProfile?.competitor_reviews_pillar_insight_at;
  const stats = useMemo(
    () => parseJson(businessProfile?.competitor_reviews_pillar_stats, []),
    [businessProfile?.competitor_reviews_pillar_stats],
  );
  const competitorsTotal = trackedCompetitors.length;

  const { refreshing, manualRefresh } = useStaleInsight({
    value: insight,
    updatedAt,
    enabled: !!bpId,
    refresh: (opts) =>
      base44.functions.invoke('analyzeCompetitorReviewInsightsPooled', { businessProfileId: bpId, force: opts?.force }, 120000),
    onRefreshed: () => queryClient.invalidateQueries({ queryKey: ['businessProfiles'] }),
  });

  if (!insight && !stats.length) return null;

  return (
    <div className="p-5 space-y-3 border-t border-border">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[13px] font-bold text-foreground">לקוחות המתחרים</h4>
        <PillarRefreshBadge updatedAt={updatedAt} refreshing={refreshing} onRefresh={manualRefresh} />
      </div>
      {insight && <p className="text-[13px] leading-relaxed text-foreground">{insight}</p>}
      {stats.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {stats.slice(0, 6).map((t, i) => (
            <span
              key={i}
              className={`text-[10px] px-2 py-1 rounded-full border ${
                t.negative > t.positive
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}
            >
              {t.negative > t.positive ? '⚠️' : '💚'} {t.theme}
              {competitorsTotal > 0 && ` · ${t.competitors_mentioning}/${competitorsTotal} מתחרים`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TopicRadarBlock({ businessProfile, trackedCompetitors }) {
  if (!trackedCompetitors.length) return null;
  return (
    <div className="p-5 border-t border-border">
      <ReviewsInsightsRadar businessProfile={businessProfile} competitors={trackedCompetitors} bare />
    </div>
  );
}

/**
 * "הלקוחות שלך" (own review themes) + "לקוחות המתחרים" (pooled cross-
 * competitor review themes) + a topic-by-topic own-vs-competitors radar —
 * the first two are independently self-hiding blocks, each with its own
 * useStaleInsight-driven auto-refresh; the radar is a live comparison query.
 */
export default function ReviewsPillarSection({ businessProfile }) {
  const queryClient = useQueryClient();
  const bpId = businessProfile?.id;

  // Shared by CompetitorReviewsBlock's "X/Y מתחרים" annotation and the radar
  // block below — same filter analyzeCompetitorReviewInsightsPooled.ts pools over.
  const { data: trackedCompetitors = [] } = useQuery({
    queryKey: ['reviewsPillarCompetitors', bpId],
    queryFn: () => base44.entities.Competitor.filter({ linked_business: bpId, tracking_status: 'approved', not_relevant: false }),
    enabled: !!bpId,
  });

  // OwnReviewsBlock/CompetitorReviewsBlock always mount (not gated on
  // businessProfile data already existing) — each owns a useStaleInsight
  // call that must run to trigger the very first computation for a business
  // with no data yet; a parent-level bailout here would prevent that fetch
  // from ever firing. Each block already self-hides its own JSX via an
  // internal guard once it knows it truly has nothing to show.
  return (
    <div className="card-base fade-in-up">
      <div className="px-5 py-3.5 border-b border-border">
        <h3 className="text-[16px] font-bold text-foreground">ביקורות לקוחות</h3>
      </div>
      <OwnReviewsBlock businessProfile={businessProfile} queryClient={queryClient} />
      <CompetitorReviewsBlock businessProfile={businessProfile} queryClient={queryClient} trackedCompetitors={trackedCompetitors} />
      <TopicRadarBlock businessProfile={businessProfile} trackedCompetitors={trackedCompetitors} />
    </div>
  );
}
