import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useStaleInsight } from '@/hooks/useStaleInsight';
import { apiFetch, computeOutlierPosts, usePooledCompetitorOutlierPosts, fmtCount } from '@/components/competitors/socialShared';
import { ComparisonChart } from '@/components/competitors/SocialInsightsComparison';
import PillarRefreshBadge from './PillarRefreshBadge';

// Mirrors CONTENT_TRENDS_TOPICS in server/src/lib/contentTrendStats.ts — same
// 6 keys, same order, shared by both content blocks below (own + competitors).
const CONTENT_TREND_TOPICS = [
  { key: 'content_themes',         label: '🎯 נושאי תוכן חוזרים' },
  { key: 'hook_patterns',          label: '🪝 דפוסי הוק' },
  { key: 'engagement_drivers',     label: '💬 קריאות לפעולה' },
  { key: 'visual_style',           label: '🎨 סגנון ויזואלי' },
  { key: 'platform_performance',   label: '📱 ביצועי פלטפורמה' },
  { key: 'improvement_opportunity',label: '💡 הזדמנות לשיפור' },
];

function ContentTrendsTopics({ topics }) {
  if (!topics) return null;
  return (
    <div className="space-y-2">
      {CONTENT_TREND_TOPICS.map(({ key, label }) => topics[key] && (
        <div key={key}>
          <p className="text-[11px] font-semibold text-foreground-muted">{label}</p>
          <p className="text-[13px] leading-relaxed text-foreground">{topics[key]}</p>
        </div>
      ))}
    </div>
  );
}

function CompetitorContentBlock({ businessProfile, queryClient }) {
  const bpId = businessProfile?.id;
  const updatedAt = businessProfile?.content_trends_insight_at;
  const topics = useMemo(() => {
    try { return businessProfile?.content_trends_topics ? JSON.parse(businessProfile.content_trends_topics) : null; }
    catch { return null; }
  }, [businessProfile?.content_trends_topics]);
  const copyExamples = useMemo(() => {
    try { return businessProfile?.content_trends_copy_examples ? JSON.parse(businessProfile.content_trends_copy_examples) : []; }
    catch { return []; }
  }, [businessProfile?.content_trends_copy_examples]);

  const { pooledOutlierPosts } = usePooledCompetitorOutlierPosts(bpId);

  const { refreshing, manualRefresh } = useStaleInsight({
    value: topics,
    updatedAt,
    enabled: !!bpId && pooledOutlierPosts.length > 0,
    refresh: (opts) =>
      base44.functions.invoke(
        'analyzeContentTrends',
        {
          businessProfileId: bpId,
          posts: pooledOutlierPosts.map(p => ({ id: p.id, competitorId: p.competitor_id, engagementMultiple: p.engagementMultiple })),
          force: opts?.force,
        },
        120000,
      ),
    onRefreshed: () => queryClient.invalidateQueries({ queryKey: ['businessProfiles'] }),
  });

  if (!topics) return null;

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[13px] font-bold text-foreground">מה עובד אצל המתחרים</h4>
        <PillarRefreshBadge updatedAt={updatedAt} refreshing={refreshing} onRefresh={manualRefresh} />
      </div>
      <ContentTrendsTopics topics={topics} />
      {copyExamples.slice(0, 3).length > 0 && (
        <ul className="space-y-1 border-t border-border pt-2">
          {copyExamples.slice(0, 3).map((ex, i) => (
            <li key={i} className="text-[11px] text-foreground-muted">
              <span className="font-semibold">{ex.competitorName}:</span> "{ex.text}"
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OwnContentBlock({ businessProfile, queryClient }) {
  const bpId = businessProfile?.id;
  const updatedAt = businessProfile?.outlier_insight_at;
  const topics = useMemo(() => {
    try { return businessProfile?.outlier_topics ? JSON.parse(businessProfile.outlier_topics) : null; }
    catch { return null; }
  }, [businessProfile?.outlier_topics]);

  // Same "own posts feed" source BusinessSocialSnapshot.jsx uses — unfiltered
  // by platform, since computeOutlierPosts already buckets by platform
  // internally, so pooling across platforms here needs no extra grouping.
  const { data: feedData } = useQuery({
    queryKey: ['businessSnapshotFeed', bpId],
    queryFn: () => apiFetch(`/social/snapshot/feed?businessProfileId=${bpId}`),
    enabled: !!bpId,
  });
  const ownOutlierPosts = useMemo(() => computeOutlierPosts(feedData?.posts ?? []), [feedData?.posts]);

  const { refreshing, manualRefresh } = useStaleInsight({
    value: topics,
    updatedAt,
    enabled: !!bpId && ownOutlierPosts.length > 0,
    refresh: (opts) =>
      base44.functions.invoke(
        'analyzeTopOwnPosts',
        { businessProfileId: bpId, posts: ownOutlierPosts.map(p => ({ id: p.id, engagementMultiple: p.engagementMultiple })), force: opts?.force },
        120000,
      ),
    onRefreshed: () => queryClient.invalidateQueries({ queryKey: ['businessProfiles'] }),
  });

  if (!topics) return null;

  return (
    <div className="p-5 space-y-3 border-t border-border">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[13px] font-bold text-foreground">מה עובד אצלך</h4>
        <PillarRefreshBadge updatedAt={updatedAt} refreshing={refreshing} onRefresh={manualRefresh} />
      </div>
      <ContentTrendsTopics topics={topics} />
    </div>
  );
}

const fmtFollowersGained = (v) => `${v > 0 ? '+' : ''}${fmtCount(v)}`;

function SocialKpiTextRow({ label, ownVal, compVal, fmt }) {
  const ownStr = ownVal == null ? null : fmt(ownVal);
  const compStr = compVal == null ? null : fmt(compVal);
  if (ownStr == null && compStr == null) return null;
  return (
    <div className="flex items-center justify-between gap-3 text-[12px]">
      <span className="text-foreground-muted">{label}</span>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full shrink-0 bg-[#2a78d6]" />
          <span className="font-semibold text-foreground">{ownStr ?? 'אין מספיק נתונים עדיין'}</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full shrink-0 bg-[#eb6834]" />
          <span className="font-semibold text-foreground">{compStr ?? 'אין מספיק נתונים עדיין'}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * "שיעור מעורבות" as a plain own-vs-competitor-avg text row (engagement
 * rate is a 0-100% metric, not sensitive to one outlier the way raw
 * follower counts are, but two isolated bars didn't read well either) —
 * plus "סה״כ עוקבים" and "עוקבים חדשים" as bar charts. The competitor side
 * of "סה״כ עוקבים" is a MEDIAN (see the kpi-comparison route), not a mean,
 * so one chain/franchise competitor's follower count doesn't put both bars
 * on wildly different scales. A live comparison query, not an LLM insight,
 * so unlike the two blocks above it doesn't need useStaleInsight — just
 * gated on having any tracked competitors, same as ReviewsPillarSection's
 * TopicRadarBlock.
 */
function SocialKpiComparisonBlock({ businessProfile, trackedCompetitors }) {
  const bpId = businessProfile?.id;

  const { data } = useQuery({
    queryKey: ['socialKpiComparison', bpId],
    queryFn: () => apiFetch(`/competitors/social/kpi-comparison?businessProfileId=${bpId}`),
    enabled: !!bpId && trackedCompetitors.length > 0,
  });

  if (!trackedCompetitors.length || !data) return null;
  const { own, competitors_avg } = data;

  const toChartData = (ownVal, compVal, compLabel = 'ממוצע מתחרים') => [
    ...(ownVal != null ? [{ id: 'own', name: 'העסק שלי', value: ownVal, isOwn: true }] : []),
    ...(compVal != null ? [{ id: 'avg', name: compLabel, value: compVal, isOwn: false }] : []),
  ];
  const totalFollowersChartData = toChartData(own.followers, competitors_avg.followers, 'חציון מתחרים');
  const followersChartData = toChartData(own.followers_gained_30d, competitors_avg.followers_gained_30d);

  const hasAnything = totalFollowersChartData.length > 0 || followersChartData.length > 0
    || own.engagement_rate_30d != null || competitors_avg.engagement_rate_30d != null;
  if (!hasAnything) return null;

  return (
    <div className="p-5 space-y-3 border-t border-border">
      <h4 className="text-[13px] font-bold text-foreground">העסק שלך מול ממוצע המתחרים</h4>
      <SocialKpiTextRow
        label="שיעור מעורבות (30 יום)"
        ownVal={own.engagement_rate_30d}
        compVal={competitors_avg.engagement_rate_30d}
        fmt={(v) => `${v.toFixed(1)}%`}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {totalFollowersChartData.length > 0 && (
          <ComparisonChart
            title="סה״כ עוקבים"
            subtitle="חציון המתחרים"
            data={totalFollowersChartData}
            dataKey="value"
          />
        )}
        {followersChartData.length > 0 && (
          <ComparisonChart
            title="עוקבים חדשים"
            subtitle="30 הימים האחרונים"
            data={followersChartData}
            dataKey="value"
            valueFormatter={fmtFollowersGained}
          />
        )}
      </div>
    </div>
  );
}

/**
 * "מה עובד אצל המתחרים" (pooled cross-competitor content trends) + "מה עובד
 * אצלך" (own outlier posts) — reuses the existing analyzeContentTrends /
 * analyzeTopOwnPosts functions via useStaleInsight for auto-refresh-if-stale
 * — plus a live own-vs-competitor-avg KPI comparison block.
 */
export default function SocialPillarSection({ businessProfile }) {
  const queryClient = useQueryClient();
  const bpId = businessProfile?.id;

  // Same "tracked competitor" definition ReviewsPillarSection uses, so
  // counts/comparisons stay consistent across Insights pillars.
  const { data: trackedCompetitors = [] } = useQuery({
    queryKey: ['socialPillarCompetitors', bpId],
    queryFn: () => base44.entities.Competitor.filter({ linked_business: bpId, tracking_status: 'approved', not_relevant: false }),
    enabled: !!bpId,
  });

  // CompetitorContentBlock/OwnContentBlock always mount (not gated on
  // businessProfile data already existing) — each owns a useStaleInsight
  // call that must run to trigger the very first computation for a business
  // with no data yet; a parent-level bailout here would prevent that fetch
  // from ever firing. Each block already self-hides its own JSX via an
  // internal guard once it knows it truly has nothing to show.
  return (
    <div className="card-base fade-in-up">
      <div className="px-5 py-3.5 border-b border-border">
        <h3 className="text-[16px] font-bold text-foreground">סושיאל</h3>
      </div>
      <CompetitorContentBlock businessProfile={businessProfile} queryClient={queryClient} />
      <OwnContentBlock businessProfile={businessProfile} queryClient={queryClient} />
      <SocialKpiComparisonBlock businessProfile={businessProfile} trackedCompetitors={trackedCompetitors} />
    </div>
  );
}
