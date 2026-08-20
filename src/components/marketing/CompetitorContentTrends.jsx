import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  apiFetch, computeOutlierPosts, useAnalyzeContentTrends, useAnalyzeBioTrends, useSuggestBioFix, CollapsibleSection,
} from '@/components/competitors/socialShared';

const CONTENT_TRENDS_POOL_CAP = 20; // mirrors MAX_POSTS_PER_CALL in analyzeContentTrends.ts

/**
 * Cross-competitor content-trends report — pools engagement-outlier posts and
 * bios from ALL of a business's tracked competitors and synthesizes copy,
 * visual, and bio patterns, each grounded with real verbatim examples spread
 * across different competitors. Self-contained: fetches its own competitor
 * data, only needs businessProfile. Moved here from SocialCompetition.jsx as
 * its own Marketing-tab section, separate from BusinessSocialSnapshot (which
 * covers the business's OWN posts, not competitors').
 */
export default function CompetitorContentTrends({ businessProfile }) {
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();

  const { data: competitors = [] } = useQuery({
    queryKey: ['socialCompetitors', bpId],
    queryFn:  () => base44.entities.Competitor.filter({ linked_business: bpId, is_dismissed: { not: true }, not_relevant: { not: true } }),
    enabled:  !!bpId,
  });
  const compIds = competitors.map(c => c.id);

  const { data: allPosts = [] } = useQuery({
    queryKey: ['socialPosts', bpId, compIds],
    queryFn:  () => base44.entities.CompetitorPost.filter({ competitor_id: { in: compIds } }, '-posted_at', 300),
    enabled:  !!bpId && compIds.length > 0,
  });

  const { data: allProfiles = [] } = useQuery({
    queryKey: ['socialProfiles', bpId, compIds],
    queryFn:  () => base44.entities.CompetitorSocialProfile.filter({ competitor_id: { in: compIds } }, '-fetched_at', 300),
    enabled:  !!bpId && compIds.length > 0,
  });

  // Own business's bio(s), same source BusinessSocialSnapshot uses — needed as
  // the "before" text for suggestBioFix's rewrite.
  const { data: ownProfileData } = useQuery({
    queryKey: ['businessSnapshotProfile', bpId],
    queryFn:  () => apiFetch(`/social/snapshot/profile?businessProfileId=${bpId}`),
    enabled:  !!bpId,
  });
  const ownProfilesWithBio = (ownProfileData?.profiles ?? []).filter(p => p.bio?.trim());

  // Average weekly posting cadence: per competitor, posts / (span between their
  // first and last tracked post in weeks), then averaged across competitors —
  // avoids skewing toward whichever competitor has the most total posts tracked.
  const avgPostsPerWeek = useMemo(() => {
    const byCompetitor = {};
    for (const p of allPosts) { if (!p.posted_at) continue; (byCompetitor[p.competitor_id] ||= []).push(p); }
    const weeklyRates = Object.values(byCompetitor)
      .filter(posts => posts.length >= 2)
      .map(posts => {
        const times = posts.map(p => new Date(p.posted_at).getTime()).sort((a, b) => a - b);
        const spanWeeks = Math.max((times[times.length - 1] - times[0]) / (7 * 24 * 3600 * 1000), 1);
        return posts.length / spanWeeks;
      });
    if (!weeklyRates.length) return null;
    return weeklyRates.reduce((s, v) => s + v, 0) / weeklyRates.length;
  }, [allPosts]);

  // Pools each competitor's own outlier posts (same detection as SocialCompetition's
  // RivalCard) into one cross-competitor set.
  const pooledOutlierPosts = useMemo(() => {
    const byCompetitor = {};
    for (const p of allPosts) (byCompetitor[p.competitor_id] ||= []).push(p);
    const compNameById = Object.fromEntries(competitors.map(c => [c.id, c.name]));
    return Object.entries(byCompetitor)
      .flatMap(([competitorId, posts]) =>
        computeOutlierPosts(posts).map(p => ({ ...p, competitor_id: competitorId, competitor_name: compNameById[competitorId] })))
      .sort((a, b) => b.engagementMultiple - a.engagementMultiple)
      .slice(0, CONTENT_TRENDS_POOL_CAP);
  }, [allPosts, competitors]);

  const initialCopyExamples = useMemo(() => {
    try { return businessProfile?.content_trends_copy_examples ? JSON.parse(businessProfile.content_trends_copy_examples) : []; }
    catch { return []; }
  }, [businessProfile?.content_trends_copy_examples]);

  const {
    analyzing: analyzingTrends, analyzeNow: analyzeTrendsNow,
    copyInsight: contentTrendsCopyInsight, copyExamples: contentTrendsCopyExamples,
    visualInsight: contentTrendsVisualInsight,
  } = useAnalyzeContentTrends(pooledOutlierPosts, {
    businessProfileId: bpId,
    initialCopyInsight: businessProfile?.content_trends_copy_insight,
    initialCopyExamples,
    initialVisualInsight: businessProfile?.content_trends_visual_insight,
    onDone: () => queryClient.invalidateQueries({ queryKey: ['socialPosts', bpId] }),
  });

  const initialBioExamples = useMemo(() => {
    try { return businessProfile?.content_trends_bio_examples ? JSON.parse(businessProfile.content_trends_bio_examples) : []; }
    catch { return []; }
  }, [businessProfile?.content_trends_bio_examples]);

  const hasProfilesWithBio = allProfiles.some(p => p.bio?.trim());

  const {
    analyzing: analyzingBioTrends, analyzeNow: analyzeBioTrendsNow,
    bioInsight: contentTrendsBioInsight, bioExamples: contentTrendsBioExamples,
  } = useAnalyzeBioTrends(hasProfilesWithBio, {
    businessProfileId: bpId,
    initialBioInsight: businessProfile?.content_trends_bio_insight,
    initialBioExamples,
    onDone: () => queryClient.invalidateQueries({ queryKey: ['socialProfiles', bpId] }),
  });

  const initialBioFixSuggestions = useMemo(() => ownProfilesWithBio
    .filter(p => p.suggested_bio)
    .map(p => ({ platform: p.platform, suggested_bio: p.suggested_bio, rationale: p.suggested_bio_rationale })),
    [ownProfilesWithBio]);

  const canSuggestBioFix = !!contentTrendsBioInsight && ownProfilesWithBio.length > 0;

  const {
    analyzing: analyzingBioFix, analyzeNow: analyzeBioFixNow, suggestions: bioFixSuggestions,
  } = useSuggestBioFix(canSuggestBioFix, {
    businessProfileId: bpId,
    initialSuggestions: initialBioFixSuggestions,
    onDone: () => queryClient.invalidateQueries({ queryKey: ['businessSnapshotProfile', bpId] }),
  });

  if (!pooledOutlierPosts.length && !hasProfilesWithBio && avgPostsPerWeek == null) return null;

  return (
    <CollapsibleSection title="🔎 מחקר סושיאל מתחרים">
      <div className="space-y-3">
        {avgPostsPerWeek != null && (
          <div className="border border-border rounded-xl bg-card p-3 flex items-center gap-2">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex-1">
              📊 ממוצע פוסטים שבועי למתחרה
            </p>
            <p className="text-sm font-bold text-foreground">{avgPostsPerWeek.toFixed(1)}</p>
          </div>
        )}

        {pooledOutlierPosts.length > 0 && (
          <div className="border border-border rounded-xl bg-card p-3 space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex-1">
                🌐 מגמות תוכן בין כל המתחרים ({pooledOutlierPosts.length} פוסטים מצטיינים)
              </p>
              <button
                onClick={analyzeTrendsNow}
                disabled={analyzingTrends}
                className="text-[10px] text-primary underline disabled:opacity-50"
              >
                {analyzingTrends ? 'מנתח...' : '🔍 נתחו מגמות תוכן'}
              </button>
            </div>
            {contentTrendsCopyInsight && (
              <div className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3">
                <p className="text-[10px] font-semibold text-amber-800 dark:text-amber-300 mb-1">📝 מגמות בקופי</p>
                <p className="text-xs leading-relaxed text-amber-950 dark:text-amber-100">{contentTrendsCopyInsight}</p>
                {contentTrendsCopyExamples?.length > 0 && (
                  <ul className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800 space-y-1">
                    {contentTrendsCopyExamples.map((ex, i) => (
                      <li key={i} className="text-[11px] text-amber-900 dark:text-amber-200">
                        <span className="text-amber-600 dark:text-amber-400">{ex.competitorName}:</span> "{ex.text}"
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {contentTrendsVisualInsight && (
              <div className="border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 rounded-lg p-3">
                <p className="text-[10px] font-semibold text-sky-800 dark:text-sky-300 mb-1">🎨 מגמות ויזואליות</p>
                <p className="text-xs leading-relaxed text-sky-950 dark:text-sky-100">{contentTrendsVisualInsight}</p>
              </div>
            )}
          </div>
        )}

        {hasProfilesWithBio && (
          <div className="border border-border rounded-xl bg-card p-3 space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex-1">
                📇 מבנה ביו של מתחרים
              </p>
              <button
                onClick={analyzeBioTrendsNow}
                disabled={analyzingBioTrends}
                className="text-[10px] text-primary underline disabled:opacity-50"
              >
                {analyzingBioTrends ? 'מנתח...' : '🔍 נתחו ביו מתחרים'}
              </button>
            </div>
            {contentTrendsBioInsight && (
              <div className="border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-3">
                <p className="text-xs leading-relaxed text-emerald-950 dark:text-emerald-100">{contentTrendsBioInsight}</p>
                {contentTrendsBioExamples?.length > 0 && (
                  <ul className="mt-2 pt-2 border-t border-emerald-200 dark:border-emerald-800 space-y-1">
                    {contentTrendsBioExamples.map((ex, i) => (
                      <li key={i} className="text-[11px] text-emerald-900 dark:text-emerald-200">
                        <span className="text-emerald-600 dark:text-emerald-400">{ex.competitorName}:</span> "{ex.text}"
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {canSuggestBioFix && (
              <div className="border-t border-border pt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex-1">
                    💡 שיפור לביו שלי
                  </p>
                  <button
                    onClick={analyzeBioFixNow}
                    disabled={analyzingBioFix}
                    className="text-[10px] text-primary underline disabled:opacity-50"
                  >
                    {analyzingBioFix ? 'מנתח...' : '🔍 הצע שיפור לביו שלי'}
                  </button>
                </div>
                {bioFixSuggestions.map((s, i) => (
                  <div key={i} className="border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 rounded-lg p-3 space-y-1.5">
                    <p className="text-[10px] font-semibold text-violet-800 dark:text-violet-300">{s.platform}</p>
                    {s.suggested_bio && (
                      <p className="text-xs leading-relaxed text-violet-950 dark:text-violet-100 whitespace-pre-line">{s.suggested_bio}</p>
                    )}
                    {s.rationale && (
                      <p className="text-[11px] text-violet-700 dark:text-violet-400 border-t border-violet-200 dark:border-violet-800 pt-1.5">{s.rationale}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
