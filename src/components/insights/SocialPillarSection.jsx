import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useStaleInsight } from '@/hooks/useStaleInsight';
import { apiFetch, computeOutlierPosts, usePooledCompetitorOutlierPosts } from '@/components/competitors/socialShared';
import PillarRefreshBadge from './PillarRefreshBadge';

function CompetitorContentBlock({ businessProfile, queryClient }) {
  const bpId = businessProfile?.id;
  const copyInsight = businessProfile?.content_trends_copy_insight;
  const visualInsight = businessProfile?.content_trends_visual_insight;
  const updatedAt = businessProfile?.content_trends_insight_at;
  const copyExamples = useMemo(() => {
    try { return businessProfile?.content_trends_copy_examples ? JSON.parse(businessProfile.content_trends_copy_examples) : []; }
    catch { return []; }
  }, [businessProfile?.content_trends_copy_examples]);

  const { pooledOutlierPosts } = usePooledCompetitorOutlierPosts(bpId);

  const { refreshing, manualRefresh } = useStaleInsight({
    value: copyInsight,
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

  if (!copyInsight && !visualInsight) return null;

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[13px] font-bold text-foreground">מה עובד אצל המתחרים</h4>
        <PillarRefreshBadge updatedAt={updatedAt} refreshing={refreshing} onRefresh={manualRefresh} />
      </div>
      {copyInsight && (
        <div className="space-y-1.5">
          <p className="text-[13px] leading-relaxed text-foreground">{copyInsight}</p>
          {copyExamples.slice(0, 3).length > 0 && (
            <ul className="space-y-1">
              {copyExamples.slice(0, 3).map((ex, i) => (
                <li key={i} className="text-[11px] text-foreground-muted">
                  <span className="font-semibold">{ex.competitorName}:</span> "{ex.text}"
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {visualInsight && (
        <p className="text-[12px] leading-relaxed text-foreground-muted border-t border-border pt-2">🎨 {visualInsight}</p>
      )}
    </div>
  );
}

function OwnContentBlock({ businessProfile, queryClient }) {
  const bpId = businessProfile?.id;
  const insight = businessProfile?.outlier_insight;
  const updatedAt = businessProfile?.outlier_insight_at;

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
    value: insight,
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

  if (!insight) return null;

  return (
    <div className="p-5 space-y-3 border-t border-border">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[13px] font-bold text-foreground">מה עובד אצלך</h4>
        <PillarRefreshBadge updatedAt={updatedAt} refreshing={refreshing} onRefresh={manualRefresh} />
      </div>
      <p className="text-[13px] leading-relaxed text-foreground">{insight}</p>
    </div>
  );
}

/**
 * "מה עובד אצל המתחרים" (pooled cross-competitor content trends) + "מה עובד
 * אצלך" (own outlier posts) — reuses the existing analyzeContentTrends /
 * analyzeTopOwnPosts functions via useStaleInsight for auto-refresh-if-stale.
 */
export default function SocialPillarSection({ businessProfile }) {
  const queryClient = useQueryClient();

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
    </div>
  );
}
