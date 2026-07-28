import { useState, useEffect, useRef } from 'react';
import { useOutletContext, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, RefreshCw, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/shared/PageHeader';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const PLATFORM_LABELS = { instagram: 'אינסטגרם', facebook: 'פייסבוק', tiktok: 'טיקטוק' };
const PLATFORM_COLORS = {
  instagram: 'bg-pink-100 text-pink-700',
  facebook:  'bg-blue-100 text-blue-700',
  tiktok:    'bg-gray-100 text-gray-800',
};

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
async function apiFetch(path) {
  const token = window.__clerk?.session ? await window.__clerk.session.getToken().catch(() => null) : null;
  const headers = token
    ? { Authorization: `Bearer ${token}` }
    : { 'x-dev-user': localStorage.getItem('dev_user_id') || 'dev-user' };
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return 'היום';
  if (d === 1) return 'אתמול';
  if (d < 30)  return `לפני ${d} ימים`;
  return `לפני ${Math.floor(d / 30)} חודשים`;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('he-IL');
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

function AdHistoryModal({ open, onClose, competitorId, competitorName, bpId }) {
  const [sort, setSort] = useState('last_seen');

  const { data, isLoading, error } = useQuery({
    queryKey: ['adHistory', competitorId, sort],
    queryFn:  () => apiFetch(`/competitors/social/ads/history?competitorId=${competitorId}&businessProfileId=${bpId}&sort=${sort}`),
    enabled:  open && !!competitorId && !!bpId,
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border">
          <DialogTitle className="text-sm">היסטוריית מודעות — {competitorName}</DialogTitle>
          <div className="flex gap-1.5 mt-2">
            {[['last_seen', 'נראה לאחרונה'], ['first_seen', 'נראה לראשונה']].map(([k, label]) => (
              <button
                key={k}
                onClick={() => setSort(k)}
                className={`text-xs px-2.5 py-0.5 rounded-full transition-colors ${
                  sort === k ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && (
            <p className="text-xs text-destructive text-center py-4">שגיאה בטעינת ההיסטוריה</p>
          )}
          {!isLoading && !error && data?.ads?.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">אין מודעות בהיסטוריה</p>
          )}
          {data?.ads?.map(ad => (
            <div key={ad.id} className="text-xs border border-border rounded-lg p-2.5 space-y-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${PLATFORM_COLORS[ad.platform] || 'bg-gray-100 text-gray-700'}`}>
                  {PLATFORM_LABELS[ad.platform] || ad.platform}
                </span>
                {ad.is_active
                  ? <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded text-[10px]">פעיל</span>
                  : <span className="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded text-[10px]">לא פעיל</span>
                }
              </div>
              {ad.title && <p className="font-medium line-clamp-1">{ad.title}</p>}
              {ad.body  && <p className="line-clamp-2 text-muted-foreground">{ad.body}</p>}
              {ad.cta   && <p className="text-[10px] font-medium text-primary">📢 {ad.cta}</p>}
              <div className="text-[10px] text-muted-foreground flex gap-3 flex-wrap">
                <span>נראה לראשונה: {fmtDate(ad.first_seen_at)}</span>
                <span>נראה לאחרונה: {fmtDate(ad.last_seen_at)}</span>
              </div>
              {ad.link && (
                <a href={ad.link} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                  צפה במודעה ↗
                </a>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RivalCard({ competitor, posts, ads, defaultSec, bpId, autoOpenHistory, defaultExpanded }) {
  const [expanded,    setExpanded]    = useState(defaultExpanded || false);
  const [section,     setSection]     = useState(() => defaultSec || getDefaultSection(posts, ads));
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (autoOpenHistory) { setExpanded(true); setHistoryOpen(true); }
  }, [autoOpenHistory]);

  const adSamples = (() => {
    try { return JSON.parse(competitor.active_ads_summary || '[]'); } catch { return []; }
  })();
  const hasGoogle = competitor.active_ad_platforms?.includes('google');

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      {/* Clickable header row */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 p-3 hover:bg-muted/50 transition-colors text-right"
      >
        <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        <span className="font-semibold text-sm flex-1">{competitor.name}</span>
        {/* platform badges */}
        {competitor.instagram_url && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-pink-100 text-pink-700">IG</span>
        )}
        {competitor.facebook_url && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">FB</span>
        )}
        {competitor.tiktok_url && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">TT</span>
        )}
        {/* counts summary */}
        {posts.length > 0 && (
          <span className="text-[10px] text-muted-foreground">{posts.length} פוסטים</span>
        )}
        {competitor.active_ad_count > 0 && (
          <span className="text-[10px] text-orange-600">{competitor.active_ad_count} מודעות</span>
        )}
      </button>

      {expanded && (
      <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
        {/* platform links (clickable, now inside expanded area) */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {competitor.instagram_url && (
            <a href={competitor.instagram_url} target="_blank" rel="noopener noreferrer"
               className="px-2 py-0.5 rounded-full bg-pink-100 text-pink-700 hover:opacity-80">Instagram ↗</a>
          )}
          {competitor.facebook_url && (
            <a href={competitor.facebook_url} target="_blank" rel="noopener noreferrer"
               className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 hover:opacity-80">Facebook ↗</a>
          )}
          {competitor.tiktok_url && (
            <a href={competitor.tiktok_url} target="_blank" rel="noopener noreferrer"
               className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 hover:opacity-80">TikTok ↗</a>
          )}
        </div>

        {/* Section switch */}
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
            {s === 'feed' ? `פיד (${posts.length})` : `מודעות (${competitor.active_ad_count || ads.length})`}
          </button>
        ))}
      </div>

      {/* Feed section — horizontal scroll strip */}
      {section === 'feed' && (
        posts.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">אין פוסטים שנאספו עדיין</p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {posts.slice(0, 20).map(post => (
              <a
                key={post.id}
                href={post.post_url || '#'}
                target={post.post_url ? '_blank' : undefined}
                rel="noopener noreferrer"
                className="shrink-0 w-36 rounded-xl border border-border bg-background overflow-hidden hover:shadow-md transition-shadow"
              >
                {/* Image via proxy (bypasses Instagram/Facebook CDN CORS) */}
                {post.media_url ? (
                  <img
                    src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(post.media_url)}`}
                    alt=""
                    className="w-full h-36 object-cover"
                    loading="lazy"
                    onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex'; }}
                  />
                ) : null}
                <div
                  className={`w-full h-36 bg-muted items-center justify-center text-muted-foreground text-xs ${post.media_url ? 'hidden' : 'flex'}`}
                >
                  {PLATFORM_LABELS[post.platform] || post.platform}
                </div>

                {/* Stats + caption */}
                <div className="p-2 space-y-1">
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className={`px-1 py-0.5 rounded ${PLATFORM_COLORS[post.platform] || 'bg-gray-100 text-gray-700'}`}>
                      {PLATFORM_LABELS[post.platform] || post.platform}
                    </span>
                    <span className="mr-auto">{timeAgo(post.posted_at || post.first_seen_at)}</span>
                  </div>
                  {(post.likes != null || post.comments_count != null) && (
                    <div className="flex gap-2 text-[11px]">
                      {post.likes != null && <span>❤️ {post.likes.toLocaleString()}</span>}
                      {post.comments_count != null && <span>💬 {post.comments_count.toLocaleString()}</span>}
                    </div>
                  )}
                  {post.caption && (
                    <p className="text-[11px] line-clamp-2 text-foreground leading-snug">{post.caption}</p>
                  )}
                </div>
              </a>
            ))}
          </div>
        )
      )}

      {/* Ads section — Sonnet intel */}
      {section === 'ads' && (
        <div className="space-y-3">
          {!competitor.ad_intel_updated_at ? (
            <p className="text-xs text-muted-foreground text-center py-6">
              {!competitor.facebook_url ? 'חסר לינק לפייסבוק' : 'לא זוהו מודעות פעילות'}
            </p>
          ) : (
            <>
              {/* Header: active platforms + count + freshness */}
              <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                {competitor.active_ad_platforms?.split(', ').map(p => (
                  <span key={p} className={`px-1.5 py-0.5 rounded ${PLATFORM_COLORS[p] || 'bg-gray-100 text-gray-700'}`}>
                    {PLATFORM_LABELS[p] || p}
                  </span>
                ))}
                {(competitor.active_ad_count > 0) && (
                  <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">{competitor.active_ad_count} מודעות</span>
                )}
                <span className="text-muted-foreground mr-auto">עודכן {timeAgo(competitor.ad_intel_updated_at)}</span>
              </div>

              {/* Promo */}
              {competitor.last_promo_detected && (
                <div className="text-xs bg-yellow-50 border border-yellow-200 rounded-lg p-2 text-yellow-800">
                  🏷️ {competitor.last_promo_detected}
                </div>
              )}

              {/* Deep intel */}
              {(competitor.ad_target_audience || competitor.ad_strategy_summary || competitor.ad_spend_signal) && (
                <div className="space-y-1 text-xs">
                  {competitor.ad_target_audience && (
                    <p><span className="text-muted-foreground">קהל יעד: </span>{competitor.ad_target_audience}</p>
                  )}
                  {competitor.ad_strategy_summary && (
                    <p><span className="text-muted-foreground">אסטרטגיה: </span>{competitor.ad_strategy_summary}</p>
                  )}
                  {competitor.ad_spend_signal && (
                    <p><span className="text-muted-foreground">תקציב: </span>{competitor.ad_spend_signal}</p>
                  )}
                </div>
              )}

              {/* Samples: active_ads_summary (≤5) */}
              {adSamples.length > 0 && (
                <div className="space-y-1.5">
                  {hasGoogle && (
                    <p className="text-[10px] text-orange-500">⚠️ גוגל — נתונים עשויים להיות רועשים</p>
                  )}
                  {adSamples.map((ad, i) => (
                    <div key={i} className="text-xs border border-border rounded p-1.5 space-y-0.5">
                      <span className={`px-1 py-0.5 rounded text-[10px] ${PLATFORM_COLORS[ad.platform] || 'bg-gray-100 text-gray-700'}`}>
                        {PLATFORM_LABELS[ad.platform] || ad.platform}
                      </span>
                      {ad.title && <p className="font-medium line-clamp-1">{ad.title}</p>}
                      {ad.body  && <p className="text-muted-foreground line-clamp-2">{ad.body}</p>}
                    </div>
                  ))}
                </div>
              )}

              {/* ad_gaps CTA */}
              {competitor.ad_gaps && (
                <div className="text-xs bg-green-50 border border-green-200 rounded-lg p-2 space-y-1">
                  <p className="font-medium text-green-800">💡 {competitor.ad_gaps}</p>
                  <Link to="/competitors" className="text-primary underline text-[10px]">ראה במסך מתחרים ↗</Link>
                </div>
              )}

              {/* History — opens modal */}
              <button
                onClick={() => setHistoryOpen(true)}
                className="text-[10px] text-muted-foreground underline"
              >
                ▼ היסטוריית מודעות
              </button>
            </>
          )}
        </div>
      )}
      </div>)}

      <AdHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        competitorId={competitor.id}
        competitorName={competitor.name}
        bpId={bpId}
      />
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
  const sectionParam = searchParams.get('section');
  const focusSection = resolveSection(sectionParam);

  const { data: competitors = [], isLoading: loadingComps } = useQuery({
    queryKey: ['socialCompetitors', bpId],
    queryFn:  () => base44.entities.Competitor.filter({ linked_business: bpId, is_dismissed: false, not_relevant: false }),
    enabled:  !!bpId,
  });

  const compIds = competitors.map(c => c.id);

  const { data: allPosts = [], isLoading: loadingPosts } = useQuery({
    queryKey: ['socialPosts', bpId, compIds],
    queryFn:  () => base44.entities.CompetitorPost.filter({ competitor_id: { in: compIds } }, '-posted_at', 300),
    enabled:  !!bpId && compIds.length > 0,
  });

  const { data: allAds = [], isLoading: loadingAds } = useQuery({
    queryKey: ['socialAds', bpId, compIds],
    queryFn:  () => base44.entities.CompetitorAdHistory.filter({ competitor_id: { in: compIds } }, '-last_seen_at', 300),
    enabled:  !!bpId && compIds.length > 0,
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
      const result = await base44.functions.invoke('collectCompetitorSocialPosts', { businessProfileId: bpId, force: true }, 180000);
      queryClient.invalidateQueries({ queryKey: ['socialPosts', bpId] });
      if (result?.upserted > 0) {
        toast.success(`פיד מתחרים עודכן — ${result.upserted} פוסטים חדשים`);
      } else {
        toast.warning('רענון הסתיים — לא נמצאו פוסטים חדשים (ראה רשת לפרטים)');
        console.info('[refresh-feed] diagnostics:', result?.diagnostics);
      }
    } catch (e) { toast.error(`שגיאה בעדכון הפיד: ${e.message}`); }
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
        <div className="space-y-2">
          {visible.map(comp => (
            <div key={comp.id} ref={el => { if (el) cardRefs.current[comp.id] = el; }}>
              <RivalCard
                competitor={comp}
                posts={allPosts.filter(p => p.competitor_id === comp.id)}
                ads={allAds.filter(a => a.competitor_id === comp.id)}
                defaultSec={comp.id === focusId ? focusSection : null}
                defaultExpanded={comp.id === focusId}
                bpId={bpId}
                autoOpenHistory={comp.id === focusId && sectionParam === 'ad-history'}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
