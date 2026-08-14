import { useState, useEffect, useRef } from 'react';
import { useOutletContext, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, RefreshCw, ChevronDown, ExternalLink, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/shared/PageHeader';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  PLATFORM_LABELS, PLATFORM_COLORS, API_BASE, apiFetch, timeAgo,
  PostDetailModal, AdDetailModal,
} from '@/components/competitors/socialShared';

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
  const [selectedAd, setSelectedAd] = useState(null);

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

        <div className="overflow-y-auto flex-1 p-4 space-y-3">
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
            <AdCard key={ad.id} ad={ad} onSelect={setSelectedAd} />
          ))}
        </div>
      </DialogContent>
      <AdDetailModal ad={selectedAd} onClose={() => setSelectedAd(null)} />
    </Dialog>
  );
}

function AdCard({ ad, onSelect }) {
  const thumb = ad.media_url || ad.video_url || null;

  return (
    <div
      onClick={() => onSelect?.(ad)}
      className="shrink-0 w-36 rounded-xl border border-border bg-background overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
    >
      {thumb ? (
        <img
          src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(thumb)}`}
          alt=""
          className="w-full h-36 object-cover"
          loading="lazy"
          onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex'; }}
        />
      ) : null}
      <div className={`w-full h-36 bg-muted items-center justify-center text-muted-foreground text-xs ${thumb ? 'hidden' : 'flex'}`}>
        {ad.is_active ? '📣 מודעה' : PLATFORM_LABELS[ad.platform] || ad.platform}
      </div>

      <div className="p-2 space-y-1">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className={`px-1 py-0.5 rounded ${PLATFORM_COLORS[ad.platform] || 'bg-gray-100 text-gray-700'}`}>
            {PLATFORM_LABELS[ad.platform] || ad.platform}
          </span>
          {ad.is_active
            ? <span className="bg-green-100 text-green-700 px-1 py-0.5 rounded mr-auto">פעיל</span>
            : <span className="mr-auto">{timeAgo(ad.last_seen_at)}</span>
          }
          {ad.link && (
            <a
              href={ad.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        {ad.cta && <p className="text-[11px] font-medium text-primary">{ad.cta}</p>}
        {(ad.title || ad.body) && (
          <p className="text-[11px] line-clamp-2 text-foreground leading-snug">{ad.title || ad.body}</p>
        )}
      </div>
    </div>
  );
}

function AnalysisTab({ competitor, posts, bpId }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  // Client-computed metrics
  const withLikes    = posts.filter(p => p.likes != null);
  const withComments = posts.filter(p => p.comments_count != null);
  const withMedia    = posts.filter(p => p.media_url);
  const avgLikes    = withLikes.length    ? Math.round(withLikes.reduce((s, p) => s + p.likes, 0) / withLikes.length) : null;
  const avgComments = withComments.length ? Math.round(withComments.reduce((s, p) => s + p.comments_count, 0) / withComments.length) : null;
  const mediaRatio  = posts.length ? Math.round((withMedia.length / posts.length) * 100) : null;

  let postsPerWeek = null;
  const datedPosts = posts.filter(p => p.posted_at);
  if (datedPosts.length >= 2) {
    const ts = datedPosts.map(p => new Date(p.posted_at).getTime()).sort((a, b) => a - b);
    const spanWeeks = (ts[ts.length - 1] - ts[0]) / (7 * 24 * 60 * 60 * 1000);
    if (spanWeeks > 0) postsPerWeek = (datedPosts.length / spanWeeks).toFixed(1);
  }

  const platformCounts = posts.reduce((acc, p) => { acc[p.platform] = (acc[p.platform] || 0) + 1; return acc; }, {});
  const themes = competitor.content_themes ? competitor.content_themes.split(',').map(t => t.trim()).filter(Boolean) : [];
  const spendIcon = { low: '🟢', medium: '🟡', high: '🔴' }[competitor.ad_spend_signal] || '';

  const handleGenerate = async () => {
    setLoading(true); setError(null);
    try {
      const result = await base44.functions.invoke(
        'analyzeSocialPosts',
        { competitorId: competitor.id, businessProfileId: bpId },
        60000,
      );
      setAnalysis(result?.data || result);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const noData = posts.length === 0 && !competitor.content_themes && !competitor.ad_strategy_summary;

  return (
    <div className="space-y-4">
      {/* Metrics strip */}
      {posts.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {avgLikes != null && (
              <div className="bg-muted/50 rounded-lg p-2 text-center">
                <p className="text-[10px] text-muted-foreground">ממוצע לייקים</p>
                <p className="font-semibold text-sm">❤️ {avgLikes.toLocaleString()}</p>
              </div>
            )}
            {avgComments != null && (
              <div className="bg-muted/50 rounded-lg p-2 text-center">
                <p className="text-[10px] text-muted-foreground">ממוצע תגובות</p>
                <p className="font-semibold text-sm">💬 {avgComments.toLocaleString()}</p>
              </div>
            )}
            {postsPerWeek != null && (
              <div className="bg-muted/50 rounded-lg p-2 text-center">
                <p className="text-[10px] text-muted-foreground">פוסטים/שבוע</p>
                <p className="font-semibold text-sm">📅 {postsPerWeek}</p>
              </div>
            )}
            {mediaRatio != null && (
              <div className="bg-muted/50 rounded-lg p-2 text-center">
                <p className="text-[10px] text-muted-foreground">עם תמונה</p>
                <p className="font-semibold text-sm">🖼️ {mediaRatio}%</p>
              </div>
            )}
          </div>
          {Object.keys(platformCounts).length > 0 && (
            <div className="flex gap-2 flex-wrap text-[11px]">
              {Object.entries(platformCounts).map(([platform, count]) => (
                <span key={platform} className={`px-2 py-0.5 rounded-full ${PLATFORM_COLORS[platform] || 'bg-gray-100 text-gray-700'}`}>
                  {PLATFORM_LABELS[platform] || platform}: {count}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {/* Strategy snapshot */}
      {(themes.length > 0 || competitor.engagement_level || competitor.social_post_frequency) && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">אסטרטגיית תוכן</p>
          {themes.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {themes.map(t => (
                <span key={t} className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[11px] border border-blue-200">{t}</span>
              ))}
            </div>
          )}
          <div className="flex gap-3 flex-wrap text-xs text-muted-foreground">
            {competitor.engagement_level    && <span>מעורבות: <strong className="text-foreground">{competitor.engagement_level}</strong></span>}
            {competitor.social_post_frequency && <span>תדירות: <strong className="text-foreground">{competitor.social_post_frequency}</strong></span>}
            {competitor.social_followers_est  && <span>עוקבים: <strong className="text-foreground">{competitor.social_followers_est}</strong></span>}
          </div>
        </div>
      )}

      {/* Ad intel snapshot */}
      {(competitor.ad_strategy_summary || competitor.ad_target_audience || competitor.ad_spend_signal || competitor.ad_gaps) && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">אינטל מודעות</p>
          <div className="space-y-1 text-xs">
            {competitor.ad_strategy_summary && <p><span className="text-muted-foreground">אסטרטגיה: </span>{competitor.ad_strategy_summary}</p>}
            {competitor.ad_target_audience  && <p><span className="text-muted-foreground">קהל: </span>{competitor.ad_target_audience}</p>}
            {competitor.ad_spend_signal     && <p><span className="text-muted-foreground">תקציב: </span>{spendIcon} {competitor.ad_spend_signal}</p>}
            {competitor.ad_gaps && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-2 text-green-800">💡 {competitor.ad_gaps}</div>
            )}
          </div>
        </div>
      )}

      {/* AI Deep Analysis */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">ניתוח AI עמוק</p>
        {!analysis && !loading && (
          <button
            onClick={handleGenerate}
            className="w-full py-2 text-xs border border-dashed border-border rounded-lg hover:bg-muted/50 text-muted-foreground transition-colors"
          >
            ✨ צור ניתוח AI ({posts.length} פוסטים, {competitor.active_ad_count || 0} מודעות)
          </button>
        )}
        {loading && (
          <div className="flex items-center gap-2 py-3 justify-center text-xs text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> מנתח פוסטים ותמונות...
          </div>
        )}
        {error && <p className="text-xs text-destructive text-center py-2">{error}</p>}
        {analysis && (
          <div className="space-y-2">
            {[
              { key: 'visual_identity',     label: '🎨 זהות ויזואלית' },
              { key: 'content_pillars',     label: '📌 נושאי תוכן' },
              { key: 'caption_patterns',    label: '✍️ סגנון כיתוב' },
              { key: 'ad_messaging',        label: '📣 מסרים במודעות' },
              { key: 'top_content_insight', label: '🏆 תוכן מוביל' },
              { key: 'our_opportunity',     label: '💡 ההזדמנות שלנו' },
            ].map(({ key, label }) => {
              const val = analysis[key];
              if (!val) return null;
              return (
                <div key={key} className="bg-muted/40 rounded-lg p-2.5 space-y-0.5">
                  <p className="text-[10px] font-semibold text-muted-foreground">{label}</p>
                  <p className="text-xs leading-relaxed">{Array.isArray(val) ? val.join(' • ') : val}</p>
                </div>
              );
            })}
            <button onClick={handleGenerate} className="text-[10px] text-muted-foreground underline">רענן ניתוח</button>
          </div>
        )}
      </div>

      {noData && (
        <p className="text-xs text-muted-foreground text-center py-6">אין מספיק נתונים — נסה לרענן את הפיד</p>
      )}
    </div>
  );
}

function RivalCard({ competitor, posts, ads, defaultSec, bpId, autoOpenHistory, defaultExpanded }) {
  const [expanded,    setExpanded]    = useState(defaultExpanded || false);
  const [section,     setSection]     = useState(() => defaultSec || getDefaultSection(posts, ads));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [selectedAd,   setSelectedAd]   = useState(null);

  useEffect(() => {
    if (autoOpenHistory) { setExpanded(true); setHistoryOpen(true); }
  }, [autoOpenHistory]);

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
        {competitor.instagram_url && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-pink-100 text-pink-700">IG</span>
        )}
        {competitor.facebook_url && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">FB</span>
        )}
        {competitor.tiktok_url && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">TT</span>
        )}
        {posts.length > 0 && (
          <span className="text-[10px] text-muted-foreground">{posts.length} פוסטים</span>
        )}
        {competitor.active_ad_count > 0 && (
          <span className="text-[10px] text-orange-600">{competitor.active_ad_count} מודעות</span>
        )}
      </button>

      {expanded && (
      <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
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

        <div className="flex gap-2">
          {[
            { key: 'feed', label: `פיד (${posts.length})` },
            { key: 'ads',  label: `מודעות (${competitor.active_ad_count || ads.length})` },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSection(key)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                section === key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Feed section — analysis at top, posts below */}
        {section === 'feed' && (
          <div className="space-y-4">
            <AnalysisTab competitor={competitor} posts={posts} bpId={bpId} />

            {posts.length > 0 && (
              <>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">פוסטים אחרונים</p>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                  {posts.slice(0, 20).map(post => (
                    <div
                      key={post.id}
                      onClick={() => setSelectedPost(post)}
                      className="shrink-0 w-36 rounded-xl border border-border bg-background overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
                    >
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

                      <div className="p-2 space-y-1">
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <span className={`px-1 py-0.5 rounded ${PLATFORM_COLORS[post.platform] || 'bg-gray-100 text-gray-700'}`}>
                            {PLATFORM_LABELS[post.platform] || post.platform}
                          </span>
                          <span className="mr-auto">{timeAgo(post.posted_at || post.first_seen_at)}</span>
                          {post.post_url && (
                            <a
                              href={post.post_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-muted-foreground hover:text-foreground shrink-0"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
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
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Ads section */}
        {section === 'ads' && (
          <div className="space-y-3">
            {!competitor.ad_intel_updated_at ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                {!competitor.facebook_url ? 'חסר לינק לפייסבוק' : 'לא זוהו מודעות פעילות'}
              </p>
            ) : (
              <>
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

                {competitor.last_promo_detected && (
                  <div className="text-xs bg-yellow-50 border border-yellow-200 rounded-lg p-2 text-yellow-800">
                    🏷️ {competitor.last_promo_detected}
                  </div>
                )}

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

                {ads.length > 0 && (
                  <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                    {hasGoogle && (
                      <p className="text-[10px] text-orange-500 shrink-0 self-center">⚠️ גוגל</p>
                    )}
                    {ads.map(ad => (
                      <AdCard key={ad.id} ad={ad} onSelect={setSelectedAd} />
                    ))}
                  </div>
                )}

                {competitor.ad_gaps && (
                  <div className="text-xs bg-green-50 border border-green-200 rounded-lg p-2 space-y-1">
                    <p className="font-medium text-green-800">💡 {competitor.ad_gaps}</p>
                    <Link to="/competitors" className="text-primary underline text-[10px]">ראה במסך מתחרים ↗</Link>
                  </div>
                )}

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
      <PostDetailModal post={selectedPost} onClose={() => setSelectedPost(null)} />
      <AdDetailModal   ad={selectedAd}    onClose={() => setSelectedAd(null)} />
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
  const [analyzingExisting, setAnalyzingExisting] = useState(false);
  const [filter,         setFilter]         = useState('all');
  const [platformFilter, setPlatformFilter] = useState(null);
  const cardRefs = useRef({});

  const focusId      = searchParams.get('competitorId');
  const sectionParam = searchParams.get('section');
  const focusSection = resolveSection(sectionParam);

  const { data: competitors = [], isLoading: loadingComps } = useQuery({
    queryKey: ['socialCompetitors', bpId],
    queryFn:  () => base44.entities.Competitor.filter({ linked_business: bpId, is_dismissed: { not: true }, not_relevant: { not: true } }),
    enabled:  !!bpId,
  });

  const compIds = competitors.map(c => c.id);

  const { data: allPosts = [], isLoading: loadingPosts } = useQuery({
    queryKey: ['socialPosts', bpId, compIds],
    queryFn:  () => base44.entities.CompetitorPost.filter({ competitor_id: { in: compIds } }, '-posted_at', 300),
    enabled:  !!bpId && compIds.length > 0,
  });

  const { data: allAdsRaw = [], isLoading: loadingAds } = useQuery({
    queryKey: ['socialAds', bpId, compIds],
    queryFn:  () => base44.entities.CompetitorAdHistory.filter({ competitor_id: { in: compIds } }, '-last_seen_at', 300),
    enabled:  !!bpId && compIds.length > 0,
  });
  const allAds = allAdsRaw.filter(a => a.platform !== 'tiktok');

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

  const handleAnalyzeExisting = async () => {
    setAnalyzingExisting(true);
    try {
      const result = await base44.functions.invoke('backfillCompetitorPostAnalysis', { businessProfileId: bpId }, 180000);
      queryClient.invalidateQueries({ queryKey: ['socialPosts', bpId] });
      queryClient.invalidateQueries({ queryKey: ['socialAds', bpId] });
      const total = (result?.posts_analyzed || 0) + (result?.ads_analyzed || 0);
      const remaining = (result?.posts_remaining || 0) + (result?.ads_remaining || 0);
      if (total > 0 && remaining > 0) {
        toast.success(`${total} פריטים נותחו — נשארו עוד ${remaining}, לחץ שוב כדי להמשיך`);
      } else if (total > 0) {
        toast.success(`ניתוח AI הושלם — ${total} פריטים נותחו`);
      } else {
        toast.warning('לא נמצאו פוסטים/מודעות שטרם נותחו');
      }
    } catch (e) { toast.error(`שגיאה בניתוח: ${e.message}`); }
    setAnalyzingExisting(false);
  };

  const loading = loadingComps || loadingPosts || loadingAds;

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
        <button
          onClick={handleAnalyzeExisting}
          disabled={analyzingExisting}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-muted disabled:opacity-50"
        >
          <Sparkles className={`w-3 h-3 ${analyzingExisting ? 'animate-pulse' : ''}`} />
          נתח פוסטים קיימים
        </button>
      </div>

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
