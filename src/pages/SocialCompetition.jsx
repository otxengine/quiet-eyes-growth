import { useState, useEffect, useRef, useMemo } from 'react';
import { useOutletContext, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, RefreshCw, ChevronDown, Trophy, Megaphone } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/shared/PageHeader';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  PLATFORM_LABELS, PLATFORM_COLORS, apiFetch, timeAgo,
  PostCard, AdCard, StoryCard, PostDetailModal, AdDetailModal, StoryDetailModal, useDeepAnalysis, ProfileHeaderWithToggle,
  computeOutlierPosts, useAnalyzeTopPerformers, CollapsibleSection,
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

function StoryHistoryModal({ open, onClose, competitorId, competitorName }) {
  const [sort, setSort] = useState('newest');
  const [selectedStory, setSelectedStory] = useState(null);

  const { data: stories = [], isLoading, error } = useQuery({
    queryKey: ['storyHistory', competitorId, sort],
    queryFn:  () => base44.entities.CompetitorStory.filter(
      { competitor_id: competitorId },
      sort === 'newest' ? '-posted_at' : 'posted_at',
      1000,
    ),
    enabled: open && !!competitorId,
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border">
          <DialogTitle className="text-sm">ארכיון סטוריז — {competitorName}</DialogTitle>
          <div className="flex gap-1.5 mt-2">
            {[['newest', 'החדשים ביותר'], ['oldest', 'הישנים ביותר']].map(([k, label]) => (
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

        <div className="overflow-y-auto flex-1 p-4">
          {isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && (
            <p className="text-xs text-destructive text-center py-4">שגיאה בטעינת הארכיון</p>
          )}
          {!isLoading && !error && stories.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">אין סטוריז בארכיון</p>
          )}
          <div className="flex flex-wrap gap-3">
            {stories.map(story => (
              <StoryCard key={story.id} story={story} onSelect={setSelectedStory} />
            ))}
          </div>
        </div>
      </DialogContent>
      <StoryDetailModal story={selectedStory} onClose={() => setSelectedStory(null)} />
    </Dialog>
  );
}

function AnalysisTab({ competitor, posts, bpId }) {
  const { analysis, loading, error, generate } = useDeepAnalysis(competitor, bpId);

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
      <CollapsibleSection title="ניתוח AI עמוק">
        {!analysis && !loading && (
          <button
            onClick={generate}
            className="w-full py-2 text-xs border border-dashed border-border rounded-lg hover:bg-muted/50 text-muted-foreground transition-colors"
          >
            ✨ עדיין לא נותח (ינותח אוטומטית) — לחץ לניתוח מיידי ({posts.length} פוסטים, {competitor.active_ad_count || 0} מודעות)
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
              { key: 'hook_patterns',       label: '🪝 דפוסי הוקים' },
              { key: 'cta_strategy',        label: '📣 אסטרטגיית CTA' },
              { key: 'promotion_pattern',   label: '🏷️ דפוס מבצעים' },
              { key: 'caption_patterns',    label: '✍️ סגנון כיתוב' },
              { key: 'ad_messaging',        label: '📢 מסרים במודעות' },
              { key: 'offer_recommendation', label: '💡 המלצת פעולה למבצעים' },
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
            <div className="flex items-center gap-2">
              <button onClick={generate} className="text-[10px] text-muted-foreground underline">רענן ניתוח</button>
              {(analysis.analyzed_at || competitor.social_deep_analysis_at) && (
                <span className="text-[10px] text-muted-foreground">
                  עודכן {timeAgo(analysis.analyzed_at || competitor.social_deep_analysis_at)}
                </span>
              )}
            </div>
          </div>
        )}
      </CollapsibleSection>

      {noData && (
        <p className="text-xs text-muted-foreground text-center py-6">אין מספיק נתונים — נסה לרענן את הפיד</p>
      )}
    </div>
  );
}

function RivalCard({ competitor, posts, ads, stories, profiles, defaultSec, bpId, autoOpenHistory, defaultExpanded }) {
  const [expanded,    setExpanded]    = useState(defaultExpanded || false);
  const [section,     setSection]     = useState(() => defaultSec || getDefaultSection(posts, ads));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [storyHistoryOpen, setStoryHistoryOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [selectedAd,   setSelectedAd]   = useState(null);
  const [selectedStory, setSelectedStory] = useState(null);

  useEffect(() => {
    if (autoOpenHistory) { setExpanded(true); setHistoryOpen(true); }
  }, [autoOpenHistory]);

  const hasGoogle = competitor.active_ad_platforms?.includes('google');
  const outlierPosts = useMemo(() => computeOutlierPosts(posts), [posts]);
  const queryClient = useQueryClient();
  const { analyzing, analyzeNow, insight } = useAnalyzeTopPerformers(outlierPosts, {
    businessProfileId: bpId,
    postType: 'competitor',
    initialInsight: competitor.outlier_insight,
    onDone: () => queryClient.invalidateQueries({ queryKey: ['socialPosts', bpId] }),
  });

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

        {profiles?.length > 0 && <ProfileHeaderWithToggle profiles={profiles} />}

        <div className="flex gap-2">
          {[
            { key: 'feed',    label: `פיד (${posts.length})` },
            { key: 'stories', label: `סטוריז (${stories.length})` },
            { key: 'ads',     label: `מודעות (${competitor.active_ad_count || ads.length})` },
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
                {insight && (
                  <CollapsibleSection title="🧠 למה הפוסטים האלה מצליחים">
                    <div className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3">
                      <p className="text-xs leading-relaxed text-amber-950 dark:text-amber-100">{insight}</p>
                    </div>
                  </CollapsibleSection>
                )}
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                  {outlierPosts.slice(0, 10).map(post => (
                    <PostCard key={post.id} post={post} onSelect={setSelectedPost} />
                  ))}
                </div>
              </>
            )}

            {posts.length > 0 && (
              <>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">פוסטים אחרונים</p>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                  {posts.slice(0, 20).map(post => (
                    <PostCard key={post.id} post={post} onSelect={setSelectedPost} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Stories section */}
        {section === 'stories' && (
          <div className="space-y-3">
            {stories.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                {!competitor.instagram_url ? 'חסר לינק לאינסטגרם' : 'לא נמצאו סטוריז שמורים'}
              </p>
            ) : (
              <>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                  {stories.slice(0, 12).map(story => (
                    <StoryCard key={story.id} story={story} onSelect={setSelectedStory} />
                  ))}
                </div>
                <button
                  onClick={() => setStoryHistoryOpen(true)}
                  className="text-[10px] text-muted-foreground underline"
                >
                  ▼ ארכיון סטוריז מלא
                </button>
              </>
            )}
          </div>
        )}

        {/* Ads section */}
        {section === 'ads' && (
          <div className="space-y-3">
            {!(competitor.active_ad_count > 0 || ads.length > 0) ? (
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
                  <span className="text-muted-foreground mr-auto">עודכן {timeAgo(competitor.ad_intel_updated_at || competitor.sponsored_ads_updated_at)}</span>
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
      <StoryHistoryModal
        open={storyHistoryOpen}
        onClose={() => setStoryHistoryOpen(false)}
        competitorId={competitor.id}
        competitorName={competitor.name}
      />
      <PostDetailModal  post={selectedPost}   onClose={() => setSelectedPost(null)} />
      <AdDetailModal    ad={selectedAd}       onClose={() => setSelectedAd(null)} />
      <StoryDetailModal story={selectedStory} onClose={() => setSelectedStory(null)} />
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
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [scanningAds,   setScanningAds]   = useState(false);
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

  const { data: allStories = [], isLoading: loadingStories } = useQuery({
    queryKey: ['socialStories', bpId, compIds],
    queryFn:  () => base44.entities.CompetitorStory.filter({ competitor_id: { in: compIds } }, '-posted_at', 300),
    enabled:  !!bpId && compIds.length > 0,
  });

  const { data: allProfiles = [] } = useQuery({
    queryKey: ['socialProfiles', bpId, compIds],
    queryFn:  () => base44.entities.CompetitorSocialProfile.filter({ competitor_id: { in: compIds } }, '-fetched_at', 300),
    enabled:  !!bpId && compIds.length > 0,
  });

  const { data: leaderboardData } = useQuery({
    queryKey: ['socialLeaderboard', bpId],
    queryFn:  () => apiFetch(`/competitors/social/leaderboard?businessProfileId=${bpId}`),
    enabled:  !!bpId,
  });
  const leaderboard = leaderboardData?.leaderboard ?? [];

  useEffect(() => {
    if (!focusId || loadingComps || loadingPosts || loadingAds) return;
    const el = cardRefs.current[focusId];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusId, loadingComps, loadingPosts, loadingAds]);

  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    const parts = [];

    try {
      const feedResult = await base44.functions.invoke('collectCompetitorSocialPosts', { businessProfileId: bpId, force: true }, 180000);
      queryClient.invalidateQueries({ queryKey: ['socialPosts', bpId] });
      if (feedResult?.upserted > 0) parts.push(`${feedResult.upserted} פוסטים חדשים`);
      else console.info('[refresh-all] feed diagnostics:', feedResult?.diagnostics);
    } catch (e) { toast.error(`שגיאה בעדכון הפיד: ${e.message}`); }

    try {
      await base44.functions.invoke('detectCompetitorAds', { businessProfileId: bpId, force: true }, 120000);
      queryClient.invalidateQueries({ queryKey: ['socialAds', bpId] });
      parts.push('מודעות עודכנו');
    } catch { toast.error('שגיאה בעדכון המודעות'); }

    try {
      await base44.functions.invoke('collectCompetitorSocialProfile', { businessProfileId: bpId, force: true }, 120000);
      queryClient.invalidateQueries({ queryKey: ['socialProfiles', bpId] });
      parts.push('פרופילים עודכנו');
    } catch (e) { toast.error(`שגיאה בעדכון הפרופילים: ${e.message}`); }

    try {
      const storiesResult = await base44.functions.invoke('collectCompetitorSocialStories', { businessProfileId: bpId, force: true }, 120000);
      queryClient.invalidateQueries({ queryKey: ['socialStories', bpId] });
      if (storiesResult?.upserted > 0) parts.push(`${storiesResult.upserted} סטוריז חדשים`);
    } catch (e) { toast.error(`שגיאה בעדכון הסטוריז: ${e.message}`); }

    try {
      const result = await base44.functions.invoke('backfillCompetitorPostAnalysis', { businessProfileId: bpId }, 180000);
      queryClient.invalidateQueries({ queryKey: ['socialPosts', bpId] });
      queryClient.invalidateQueries({ queryKey: ['socialAds', bpId] });
      const total = (result?.posts_analyzed || 0) + (result?.ads_analyzed || 0);
      const remaining = (result?.posts_remaining || 0) + (result?.ads_remaining || 0);
      if (total > 0) parts.push(remaining > 0 ? `${total} פריטים נותחו (נשארו עוד ${remaining})` : `${total} פריטים נותחו`);
    } catch (e) { toast.error(`שגיאה בניתוח: ${e.message}`); }

    toast.success(parts.length ? `רענון הושלם — ${parts.join(' · ')}` : 'רענון הושלם — אין עדכונים חדשים');
    setRefreshingAll(false);
  };

  const handleScanAdsOnly = async () => {
    setScanningAds(true);
    try {
      const result = await base44.functions.invoke('detectCompetitorAds', { businessProfileId: bpId, force: true }, 120000);
      queryClient.invalidateQueries({ queryKey: ['socialAds', bpId] });
      toast.success(result?.alerts_created > 0 ? `מודעות עודכנו — ${result.alerts_created} התראות חדשות` : 'מודעות עודכנו');
    } catch (e) {
      toast.error(`שגיאה בעדכון המודעות: ${e.message}`);
    } finally {
      setScanningAds(false);
    }
  };

  const loading = loadingComps || loadingPosts || loadingAds || loadingStories;

  let visible = competitors;
  if (filter === 'with_posts') visible = visible.filter(c => allPosts.some(p => p.competitor_id === c.id));
  if (filter === 'with_ads')   visible = visible.filter(c => allAds.some(a => a.competitor_id === c.id));
  if (platformFilter) {
    visible = visible.filter(c =>
      allPosts.some(p => p.competitor_id === c.id && p.platform === platformFilter) ||
      allAds.some(a   => a.competitor_id === c.id && a.platform === platformFilter) ||
      allStories.some(s => s.competitor_id === c.id && s.platform === platformFilter)
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      {refreshingAll && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" dir="rtl">
          <div className="bg-background rounded-xl shadow-xl p-6 flex flex-col items-center gap-3 max-w-xs text-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm font-semibold text-foreground">סורק את הסושיאל של המתחרים...</p>
            <p className="text-xs text-muted-foreground">זה עשוי לקחת עד דקה-שתיים</p>
          </div>
        </div>
      )}

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
          onClick={handleScanAdsOnly}
          disabled={refreshingAll || scanningAds}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-muted disabled:opacity-50"
        >
          <Megaphone className={`w-3 h-3 ${scanningAds ? 'animate-pulse' : ''}`} />
          {scanningAds ? 'מחפש מודעות...' : 'חפש מודעות בלבד'}
        </button>

        <button
          onClick={handleRefreshAll}
          disabled={refreshingAll || scanningAds}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${refreshingAll ? 'animate-spin' : ''}`} />
          רענן ונתח הכל
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
                stories={allStories.filter(s => s.competitor_id === comp.id)}
                profiles={allProfiles.filter(p => p.competitor_id === comp.id)}
                defaultSec={comp.id === focusId ? focusSection : null}
                defaultExpanded={comp.id === focusId}
                bpId={bpId}
                autoOpenHistory={comp.id === focusId && sectionParam === 'ad-history'}
              />
            </div>
          ))}
        </div>
      )}

      {leaderboard.length > 0 && (
        <div className="card-base p-4">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-amber-500" />
            מובילי מעורבות — 30 יום אחרונים
          </p>
          <div className="space-y-1.5">
            {leaderboard.slice(0, 10).map((row, i) => (
              <button
                key={row.competitor_id}
                onClick={() => setSearchParams({ competitorId: row.competitor_id, section: 'feed' })}
                className="w-full flex items-center gap-3 px-2.5 py-1.5 rounded-lg hover:bg-muted transition-colors text-right"
              >
                <span className={`w-5 text-xs font-bold flex-shrink-0 ${i === 0 ? 'text-amber-500' : 'text-muted-foreground'}`}>
                  {i + 1}
                </span>
                <span className="flex-1 text-[12px] text-foreground truncate">{row.competitor_name}</span>
                <span className="text-[11px] text-muted-foreground">{row.post_count} פוסטים</span>
                <span className="text-[12px] font-semibold text-foreground w-16 text-left">{row.avg_interactions.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
