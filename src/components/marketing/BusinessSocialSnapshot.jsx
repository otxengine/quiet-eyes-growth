import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  PLATFORM_LABELS, PLATFORM_COLORS, apiFetch, timeAgo,
  PostCard, AdCard, PostDetailModal, AdDetailModal, ProfileHeader, computeOutlierPosts, useAnalyzeTopPerformers,
} from '@/components/competitors/socialShared';

// Single-entity twin of SocialCompetition.jsx's RivalCard — same feed/ads
// sub-tabs and card components, but for the business's own accounts instead
// of a list of competitors, since there's only one "entity" to show here.
export default function BusinessSocialSnapshot({ businessProfile }) {
  const bpId = businessProfile?.id;
  const hasSocialUrl = !!(businessProfile?.instagram_url || businessProfile?.facebook_url || businessProfile?.tiktok_url);

  const [section, setSection] = useState('feed');
  const [selectedPost, setSelectedPost] = useState(null);
  const [selectedAd, setSelectedAd] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const { data: feedData, isLoading: loadingFeed } = useQuery({
    queryKey: ['businessSnapshotFeed', bpId],
    queryFn: () => apiFetch(`/social/snapshot/feed?businessProfileId=${bpId}`),
    enabled: !!bpId && hasSocialUrl,
  });
  const { data: adsData, isLoading: loadingAds } = useQuery({
    queryKey: ['businessSnapshotAdsHistory', bpId],
    queryFn: () => apiFetch(`/social/snapshot/ads/history?businessProfileId=${bpId}`),
    enabled: !!bpId && hasSocialUrl,
  });
  const { data: profileData, isLoading: loadingProfile } = useQuery({
    queryKey: ['businessSnapshotProfile', bpId],
    queryFn: () => apiFetch(`/social/snapshot/profile?businessProfileId=${bpId}`),
    enabled: !!bpId && hasSocialUrl,
  });

  const posts = feedData?.posts ?? [];
  const ads = adsData?.ads ?? [];
  const profiles = profileData?.profiles ?? [];
  const activeAdCount = ads.filter(a => a.is_active).length;
  const outlierPosts = useMemo(() => computeOutlierPosts(posts), [posts]);
  const { analyzing, analyzeNow } = useAnalyzeTopPerformers(outlierPosts, {
    businessProfileId: bpId,
    postType: 'own',
    onDone: () => queryClient.invalidateQueries({ queryKey: ['businessSnapshotFeed', bpId] }),
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    const parts = [];
    try {
      const result = await base44.functions.invoke('collectOwnSocialPosts', { businessProfileId: bpId, force: true }, 180000);
      queryClient.invalidateQueries({ queryKey: ['businessSnapshotFeed', bpId] });
      if (result?.upserted > 0) parts.push(`${result.upserted} פוסטים חדשים`);
    } catch (e) { toast.error(`שגיאה בעדכון הפיד: ${e.message}`); }

    try {
      await base44.functions.invoke('detectOwnAds', { businessProfileId: bpId, force: true }, 120000);
      queryClient.invalidateQueries({ queryKey: ['businessSnapshotAdsHistory', bpId] });
      parts.push('מודעות עודכנו');
    } catch (e) { toast.error(`שגיאה בעדכון המודעות: ${e.message}`); }

    try {
      await base44.functions.invoke('collectOwnSocialProfile', { businessProfileId: bpId, force: true }, 90000);
      queryClient.invalidateQueries({ queryKey: ['businessSnapshotProfile', bpId] });
      parts.push('פרופיל עודכן');
    } catch (e) { toast.error(`שגיאה בעדכון הפרופיל: ${e.message}`); }

    toast.success(parts.length ? `רענון הושלם — ${parts.join(' · ')}` : 'רענון הושלם — אין עדכונים חדשים');
    setRefreshing(false);
  };

  if (!hasSocialUrl) {
    return (
      <div className="border border-border rounded-xl bg-card p-4 text-center space-y-1">
        <p className="text-sm font-semibold text-foreground">תמונת מצב עסקית</p>
        <p className="text-xs text-muted-foreground">חברו את עמודי הסושיאל שלכם בהגדרות כדי לראות כאן פוסטים ומודעות בזמן אמת</p>
      </div>
    );
  }

  const loading = loadingFeed || loadingAds || loadingProfile;

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <div className="flex items-center gap-2 p-3">
        <span className="font-semibold text-sm flex-1">תמונת מצב עסקית</span>
        {posts.length > 0 && <span className="text-[10px] text-muted-foreground">{posts.length} פוסטים</span>}
        {activeAdCount > 0 && <span className="text-[10px] text-orange-600">{activeAdCount} מודעות</span>}
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 border border-border rounded-lg hover:bg-muted disabled:opacity-50"
        >
          {refreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          רענון
        </button>
      </div>

      <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
        {profiles.length > 0 && (
          <div className="space-y-3">
            {profiles.map(profile => (
              <ProfileHeader key={profile.id} profile={profile} />
            ))}
          </div>
        )}

        <div className="flex gap-2">
          {[
            { key: 'feed', label: `פיד (${posts.length})` },
            { key: 'ads', label: `מודעות (${activeAdCount})` },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSection(key)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                section === key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && section === 'feed' && (
          posts.length > 0 ? (
            <>
              {outlierPosts.length > 0 && (
                <>
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex-1">🔥 פוסטים מצטיינים</p>
                    <button
                      onClick={analyzeNow}
                      disabled={analyzing}
                      className="text-[10px] text-primary underline disabled:opacity-50"
                    >
                      {analyzing ? 'מנתח...' : '🔍 נתחו מה גרם להצלחה'}
                    </button>
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                    {outlierPosts.slice(0, 10).map(post => (
                      <PostCard key={post.id} post={post} onSelect={setSelectedPost} />
                    ))}
                  </div>
                </>
              )}
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                {posts.map(post => (
                  <PostCard key={post.id} post={post} onSelect={setSelectedPost} />
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-6">אין עדיין פוסטים — לחצו רענון כדי לסרוק</p>
          )
        )}

        {!loading && section === 'ads' && (
          ads.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                {[...new Set(ads.map(a => a.platform))].map(p => (
                  <span key={p} className={`px-1.5 py-0.5 rounded ${PLATFORM_COLORS[p] || 'bg-gray-100 text-gray-700'}`}>
                    {PLATFORM_LABELS[p] || p}
                  </span>
                ))}
                {ads[0]?.last_seen_at && (
                  <span className="text-muted-foreground mr-auto">עודכן {timeAgo(ads[0].last_seen_at)}</span>
                )}
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                {ads.map(ad => (
                  <AdCard key={ad.id} ad={ad} onSelect={setSelectedAd} />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-6">לא זוהו מודעות פעילות — לחצו רענון כדי לסרוק</p>
          )
        )}
      </div>

      <PostDetailModal post={selectedPost} onClose={() => setSelectedPost(null)} />
      <AdDetailModal ad={selectedAd} onClose={() => setSelectedAd(null)} />
    </div>
  );
}
