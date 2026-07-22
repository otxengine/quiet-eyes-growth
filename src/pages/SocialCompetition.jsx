import { useState, useEffect, useRef } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/shared/PageHeader';

const PLATFORM_LABELS = { instagram: 'אינסטגרם', facebook: 'פייסבוק', tiktok: 'טיקטוק' };
const PLATFORM_COLORS = {
  instagram: 'bg-pink-100 text-pink-700',
  facebook:  'bg-blue-100 text-blue-700',
  tiktok:    'bg-gray-100 text-gray-800',
};

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return 'היום';
  if (d === 1) return 'אתמול';
  if (d < 30)  return `לפני ${d} ימים`;
  return `לפני ${Math.floor(d / 30)} חודשים`;
}

function resolveSection(param) {
  if (!param) return null;
  return (param === 'ad-history' || param === 'ads') ? 'ads' : 'feed';
}

function getDefaultSection(posts, ads) {
  if (posts.length > 0) return 'feed';
  if (ads.length > 0)   return 'ads';
  return 'feed';
}

function RivalCard({ competitor, posts, ads, defaultSec }) {
  const [section, setSection] = useState(() => defaultSec || getDefaultSection(posts, ads));

  return (
    <div className="border border-border rounded-xl p-4 space-y-3 bg-card">
      {/* Header: rival name + platform links */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-sm">{competitor.name}</span>
        {competitor.instagram_url && (
          <a href={competitor.instagram_url} target="_blank" rel="noopener noreferrer"
             className="text-xs px-2 py-0.5 rounded-full bg-pink-100 text-pink-700 hover:opacity-80">IG</a>
        )}
        {competitor.facebook_url && (
          <a href={competitor.facebook_url} target="_blank" rel="noopener noreferrer"
             className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 hover:opacity-80">FB</a>
        )}
        {competitor.tiktok_url && (
          <a href={competitor.tiktok_url} target="_blank" rel="noopener noreferrer"
             className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 hover:opacity-80">TT</a>
        )}
      </div>

      {/* Mutually exclusive section switch */}
      <div className="flex gap-2">
        {['feed', 'ads'].map(s => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              section === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {s === 'feed' ? `פיד (${posts.length})` : `מודעות (${ads.length})`}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="max-h-60 overflow-y-auto space-y-2">
        {section === 'feed' ? (
          posts.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">אין פוסטים שנאספו עדיין</p>
          ) : posts.slice(0, 10).map(post => (
            <div key={post.id} className="text-xs border border-border rounded-lg p-2 space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${PLATFORM_COLORS[post.platform] || 'bg-gray-100 text-gray-700'}`}>
                  {PLATFORM_LABELS[post.platform] || post.platform}
                </span>
                <span className="text-muted-foreground">{timeAgo(post.posted_at || post.first_seen_at)}</span>
                {post.likes != null && <span className="text-muted-foreground">❤️ {post.likes}</span>}
                {post.comments_count != null && <span className="text-muted-foreground">💬 {post.comments_count}</span>}
              </div>
              {post.caption && <p className="line-clamp-2">{post.caption}</p>}
              {post.post_url && (
                <a href={post.post_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">צפה בפוסט ↗</a>
              )}
            </div>
          ))
        ) : (
          ads.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">לא זוהו מודעות פעילות</p>
          ) : ads.slice(0, 10).map(ad => (
            <div key={ad.id} className="text-xs border border-border rounded-lg p-2 space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${PLATFORM_COLORS[ad.platform] || 'bg-gray-100 text-gray-700'}`}>
                  {PLATFORM_LABELS[ad.platform] || ad.platform}
                </span>
                {ad.is_active && <span className="bg-green-100 text-green-700 px-1.5 rounded text-[10px]">פעיל</span>}
                <span className="text-muted-foreground">{timeAgo(ad.last_seen_at)}</span>
              </div>
              {ad.title && <p className="font-medium">{ad.title}</p>}
              {ad.body  && <p className="line-clamp-2 text-muted-foreground">{ad.body}</p>}
              {ad.link  && (
                <a href={ad.link} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">צפה במודעה ↗</a>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const FILTER_TABS = [
  { key: 'all',        label: 'כל המתחרים' },
  { key: 'with_posts', label: 'עם פוסטים' },
  { key: 'with_ads',   label: 'עם מודעות' },
];

export default function SocialCompetition() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [refreshingFeed, setRefreshingFeed] = useState(false);
  const [refreshingAds,  setRefreshingAds]  = useState(false);
  const [filter,         setFilter]         = useState('all');
  const [platformFilter, setPlatformFilter] = useState(null);
  const cardRefs = useRef({});

  const focusId      = searchParams.get('competitorId');
  const focusSection = resolveSection(searchParams.get('section'));

  const { data: competitors = [], isLoading: loadingComps } = useQuery({
    queryKey: ['socialCompetitors', bpId],
    queryFn:  () => base44.entities.Competitor.filter({ linked_business: bpId, is_dismissed: false, not_relevant: false }),
    enabled:  !!bpId,
  });

  const { data: allPosts = [], isLoading: loadingPosts } = useQuery({
    queryKey: ['socialPosts', bpId],
    queryFn:  () => base44.entities.CompetitorPost.filter({ linked_business: bpId }, '-posted_at', 300),
    enabled:  !!bpId && competitors.length > 0,
  });

  const { data: allAds = [], isLoading: loadingAds } = useQuery({
    queryKey: ['socialAds', bpId],
    queryFn:  () => base44.entities.CompetitorAdHistory.filter({ linked_business: bpId }, '-last_seen_at', 300),
    enabled:  !!bpId && competitors.length > 0,
  });

  // Deep-link scroll: once data is ready, scroll to the focused card
  useEffect(() => {
    if (!focusId || loadingComps || loadingPosts || loadingAds) return;
    const el = cardRefs.current[focusId];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusId, loadingComps, loadingPosts, loadingAds]);

  const handleRefreshFeed = async () => {
    setRefreshingFeed(true);
    try {
      await base44.functions.invoke('collectCompetitorSocialPosts', { businessProfileId: bpId, force: true }, 120000);
      queryClient.invalidateQueries({ queryKey: ['socialPosts', bpId] });
      toast.success('פיד מתחרים עודכן');
    } catch { toast.error('שגיאה בעדכון הפיד'); }
    setRefreshingFeed(false);
  };

  const handleRefreshAds = async () => {
    setRefreshingAds(true);
    try {
      await base44.functions.invoke('detectCompetitorAds', { businessProfileId: bpId, force: true }, 120000);
      queryClient.invalidateQueries({ queryKey: ['socialAds', bpId] });
      toast.success('מודעות מתחרים עודכנו');
    } catch { toast.error('שגיאה בעדכון המודעות'); }
    setRefreshingAds(false);
  };

  const loading = loadingComps || loadingPosts || loadingAds;

  // Apply filters
  let visible = competitors;
  if (filter === 'with_posts') visible = visible.filter(c => allPosts.some(p => p.competitor_id === c.id));
  if (filter === 'with_ads')   visible = visible.filter(c => allAds.some(a => a.competitor_id === c.id));
  if (platformFilter) {
    visible = visible.filter(c =>
      allPosts.some(p => p.competitor_id === c.id && p.platform === platformFilter) ||
      allAds.some(a   => a.competitor_id === c.id && a.platform === platformFilter)
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <PageHeader title="תחרות סושיאל" />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTER_TABS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              filter === f.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border hover:bg-muted'
            }`}
          >
            {f.label}
          </button>
        ))}

        {/* Platform chips */}
        {['instagram', 'facebook', 'tiktok'].map(p => (
          <button
            key={p}
            onClick={() => setPlatformFilter(platformFilter === p ? null : p)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              platformFilter === p
                ? `${PLATFORM_COLORS[p]} border-transparent`
                : 'border-border hover:bg-muted'
            }`}
          >
            {PLATFORM_LABELS[p]}
          </button>
        ))}

        <div className="flex-1" />

        <button
          onClick={handleRefreshFeed}
          disabled={refreshingFeed}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${refreshingFeed ? 'animate-spin' : ''}`} />
          רענן פיד
        </button>
        <button
          onClick={handleRefreshAds}
          disabled={refreshingAds}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${refreshingAds ? 'animate-spin' : ''}`} />
          רענן מודעות
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : visible.length === 0 ? (
        <p className="text-center text-muted-foreground py-12 text-sm">
          {competitors.length === 0 ? 'לא נמצאו מתחרים' : 'אין מתחרים התואמים את הסינון'}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visible.map(comp => (
            <div key={comp.id} ref={el => { if (el) cardRefs.current[comp.id] = el; }}>
              <RivalCard
                competitor={comp}
                posts={allPosts.filter(p => p.competitor_id === comp.id)}
                ads={allAds.filter(a => a.competitor_id === comp.id)}
                defaultSec={comp.id === focusId ? focusSection : null}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
