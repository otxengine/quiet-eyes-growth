import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, RefreshCw, BadgeCheck, Phone, Mail, MapPin, Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  PLATFORM_LABELS, PLATFORM_COLORS, API_BASE, apiFetch, timeAgo,
  PostCard, AdCard, PostDetailModal, AdDetailModal,
} from '@/components/competitors/socialShared';

function fmtCount(n) {
  if (n == null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function ProfileCard({ profile }) {
  let highlights = [];
  try { highlights = profile.highlights ? JSON.parse(profile.highlights) : []; } catch { /* ignore malformed */ }

  return (
    <div className="shrink-0 w-64 rounded-xl border border-border bg-background overflow-hidden">
      {profile.cover_photo_url && (
        <img
          src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(profile.cover_photo_url)}`}
          alt=""
          className="w-full h-16 object-cover"
          loading="lazy"
        />
      )}
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          {profile.profile_picture_url ? (
            <img
              src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(profile.profile_picture_url)}`}
              alt=""
              className="w-10 h-10 rounded-full object-cover shrink-0 border border-border"
              loading="lazy"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-muted shrink-0" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${PLATFORM_COLORS[profile.platform] || 'bg-gray-100 text-gray-700'}`}>
                {PLATFORM_LABELS[profile.platform] || profile.platform}
              </span>
              {profile.is_verified && <BadgeCheck className="w-3.5 h-3.5 text-blue-500 shrink-0" />}
            </div>
            {profile.category && <p className="text-[10px] text-muted-foreground truncate">{profile.category}</p>}
          </div>
        </div>

        {(profile.follower_count != null || profile.following_count != null || profile.post_count != null) && (
          <div className="flex gap-3 text-[11px]">
            {profile.follower_count != null && <span><b>{fmtCount(profile.follower_count)}</b> עוקבים</span>}
            {profile.following_count != null && <span><b>{fmtCount(profile.following_count)}</b> נעקבים</span>}
            {profile.post_count != null && <span><b>{fmtCount(profile.post_count)}</b> פוסטים</span>}
          </div>
        )}

        {profile.bio && <p className="text-[11px] leading-relaxed line-clamp-3">{profile.bio}</p>}

        {highlights.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {highlights.slice(0, 8).map((h, idx) => (
              <div key={idx} className="flex flex-col items-center gap-0.5 shrink-0 w-10">
                {h.cover_url ? (
                  <img
                    src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(h.cover_url)}`}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover border border-border"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-muted" />
                )}
                {h.title && <span className="text-[9px] text-muted-foreground truncate w-10 text-center">{h.title}</span>}
              </div>
            ))}
          </div>
        )}

        {(profile.contact_phone || profile.contact_email || profile.contact_address || profile.external_url) && (
          <div className="space-y-0.5 text-[10px] text-muted-foreground border-t border-border pt-1.5">
            {profile.contact_phone && <p className="flex items-center gap-1"><Phone className="w-3 h-3 shrink-0" />{profile.contact_phone}</p>}
            {profile.contact_email && <p className="flex items-center gap-1"><Mail className="w-3 h-3 shrink-0" />{profile.contact_email}</p>}
            {profile.contact_address && <p className="flex items-center gap-1"><MapPin className="w-3 h-3 shrink-0" />{profile.contact_address}</p>}
            {profile.external_url && (
              <a href={profile.external_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                <LinkIcon className="w-3 h-3 shrink-0" />{profile.external_url}
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

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
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {profiles.map(profile => (
              <ProfileCard key={profile.id} profile={profile} />
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
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
              {posts.map(post => (
                <PostCard key={post.id} post={post} onSelect={setSelectedPost} />
              ))}
            </div>
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
