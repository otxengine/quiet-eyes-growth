import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, BadgeCheck, Phone, Mail, MapPin, Link as LinkIcon, ChevronDown } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { base44 } from '@/api/base44Client';

export const PLATFORM_LABELS = { instagram: 'אינסטגרם', facebook: 'פייסבוק' };
export const PLATFORM_COLORS = {
  instagram: 'bg-pink-100 text-pink-700',
  facebook:  'bg-blue-100 text-blue-700',
};

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
export async function apiFetch(path) {
  const token = window.__clerk?.session ? await window.__clerk.session.getToken().catch(() => null) : null;
  const headers = token
    ? { Authorization: `Bearer ${token}` }
    : { 'x-dev-user': localStorage.getItem('dev_user_id') || 'dev-user' };
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return 'היום';
  if (d === 1) return 'אתמול';
  if (d < 30)  return `לפני ${d} ימים`;
  return `לפני ${Math.floor(d / 30)} חודשים`;
}

export function fmtDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString('he-IL');
}

// Only worth flagging once a page has clearly gone quiet — recent activity needs no badge.
const STALE_PAGE_THRESHOLD_DAYS = 180;
export function stalenessNote(lastPostAt) {
  if (!lastPostAt) return null;
  const days = Math.floor((Date.now() - new Date(lastPostAt).getTime()) / 86400000);
  if (days < STALE_PAGE_THRESHOLD_DAYS) return null;
  const unit = days >= 365 ? `${Math.floor(days / 365)} שנים` : `${Math.floor(days / 30)} חודשים`;
  return `⚠️ הפוסט האחרון בעמוד פורסם לפני ${unit}`;
}

// When a Facebook page has no custom Intro text, Facebook substitutes an auto-generated
// summary built from the same stats we already show ("{name}, {city}. {N} likes · {M} were
// here. {category}"). Detect that fallback by checking whether the bio is literally built
// from the follower/checkin counts we already have — locale-independent since it compares
// the numbers themselves, not English wording — and only suppress it when it matches; a
// real custom Intro (whatever language it's in) won't happen to contain those exact numbers.
export function isFacebookAutoBio(profile) {
  if (!profile.bio) return false;
  const markers = [];
  if (profile.follower_count != null) markers.push(String(profile.follower_count));
  if (profile.checkin_count != null) markers.push(String(profile.checkin_count));
  return markers.length > 0 && markers.every(m => profile.bio.includes(m));
}

export function parseDeepAnalysis(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Shared "deep analysis" fetch/state logic used by both AnalysisTab and CompetitorOfferInsights. */
export function useDeepAnalysis(competitor, bpId) {
  const [analysis, setAnalysis] = useState(() => parseDeepAnalysis(competitor.social_deep_analysis));
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  const generate = async () => {
    setLoading(true); setError(null);
    try {
      const result = await base44.functions.invoke(
        'analyzeSocialPosts',
        { competitorId: competitor.id, businessProfileId: bpId, force: true },
        60000,
      );
      setAnalysis(result?.data || result);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  return { analysis, loading, error, generate };
}

export const ANALYSIS_FIELDS = [
  { key: 'topic',         label: '📌 נושא' },
  { key: 'has_offer',     label: '🏷️ מבצע/הנחה' },
  { key: 'offer_details', label: '💰 פרטי המבצע' },
  { key: 'style',         label: '🎨 סגנון' },
  { key: 'cta',           label: '📣 קריאה לפעולה' },
  { key: 'text_hooks',    label: '✍️ הוקים טקסטואליים' },
  { key: 'visual_hooks',  label: '🖼️ הוקים ויזואליים' },
  { key: 'video_description',  label: '🎬 תיאור הסרטון' },
  { key: 'video_script',       label: '🗣️ תמלול/דיבור' },
  { key: 'video_content_type', label: '🎥 סוג תוכן' },
];

export const VIDEO_CONTENT_TYPE_LABELS = {
  ugc: 'תוכן גולשים (UGC)',
  animated: 'אנימציה',
  produced: 'הפקה מקצועית',
  talking_head: 'דיבור מול מצלמה',
  slideshow: 'מצגת תמונות',
  screen_recording: 'הקלטת מסך',
  other: 'אחר',
};

export const TOP_PERFORMER_FIELDS = [
  { key: 'hook',                   label: '🪝 למה זה עבד' },
  { key: 'content_pillar',         label: '📌 פילר תוכן' },
  { key: 'audience_action_driver', label: '📣 מה גרם לקהל לפעול' },
];

// Separate, visually distinct block for the outlier-only fields (hook/content_pillar/
// audience_action_driver) — kept apart from the regular per-post AnalysisBlock below
// so "why this post outperformed" doesn't get lost inside the general AI analysis.
export function TopPerformerAnalysisBlock({ raw }) {
  if (!raw) return null;
  let a;
  try { a = JSON.parse(raw); } catch { return null; }
  if (!a || !TOP_PERFORMER_FIELDS.some(({ key }) => a[key])) return null;
  return (
    <div className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 space-y-2">
      <p className="text-[10px] font-semibold text-amber-800 dark:text-amber-300">🔥 ניתוח פוסט מצטיין</p>
      {TOP_PERFORMER_FIELDS.map(({ key, label }) => {
        const val = a[key];
        if (val == null || val === '') return null;
        return (
          <div key={key} className="space-y-0.5">
            <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">{label}</p>
            <p className="text-xs leading-relaxed text-amber-950 dark:text-amber-100">{val}</p>
          </div>
        );
      })}
    </div>
  );
}

// Generic expand/collapse wrapper for a titled section — used to keep long AI
// analysis blocks out of the way until the user actually wants to read them.
export function CollapsibleSection({ title, defaultOpen = false, action = null, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex-1 hover:text-foreground transition-colors"
        >
          <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
          {title}
        </button>
        {action}
      </div>
      {open && children}
    </div>
  );
}

export function AnalysisBlock({ raw }) {
  if (!raw) return null;
  let a;
  try { a = JSON.parse(raw); } catch { return null; }
  if (!a) return null;
  return (
    <div className="border-t pt-3 space-y-2">
      <p className="text-[10px] font-semibold text-muted-foreground">ניתוח AI</p>
      {ANALYSIS_FIELDS.map(({ key, label }) => {
        const val = a[key];
        if (val == null || val === '' || (Array.isArray(val) && val.length === 0)) return null;
        const display = key === 'has_offer' ? (val ? 'כן' : 'לא')
          : key === 'video_content_type' ? (VIDEO_CONTENT_TYPE_LABELS[val] || val)
          : Array.isArray(val) ? val.join(' • ')
          : String(val);
        return (
          <div key={key} className="bg-muted/40 rounded-lg p-2.5 space-y-0.5">
            <p className="text-[10px] font-semibold text-muted-foreground">{label}</p>
            <p className="text-xs leading-relaxed">{display}</p>
          </div>
        );
      })}
    </div>
  );
}

export function PostCard({ post, onSelect }) {
  return (
    <div
      onClick={() => onSelect?.(post)}
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
  );
}

export function StoryCard({ story, onSelect }) {
  const expired = story.expires_at && new Date(story.expires_at).getTime() < Date.now();
  return (
    <div
      onClick={() => onSelect?.(story)}
      className={`shrink-0 w-36 rounded-xl border border-border bg-background overflow-hidden relative ${onSelect ? 'hover:shadow-md transition-shadow cursor-pointer' : ''}`}
    >
      {story.media_url ? (
        story.media_type === 'video' ? (
          <video
            src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(story.media_url)}`}
            className="w-full h-52 object-cover"
            muted loop playsInline
          />
        ) : (
          <img
            src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(story.media_url)}`}
            alt=""
            className="w-full h-52 object-cover"
            loading="lazy"
            onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex'; }}
          />
        )
      ) : null}
      <div className={`w-full h-52 bg-muted items-center justify-center text-muted-foreground text-xs ${story.media_url ? 'hidden' : 'flex'}`}>
        סטורי
      </div>
      {expired && (
        <span className="absolute top-1.5 right-1.5 text-[9px] bg-black/60 text-white px-1.5 py-0.5 rounded-full">פג תוקף</span>
      )}
      <div className="p-2">
        <span className="text-[10px] text-muted-foreground">{timeAgo(story.posted_at || story.first_seen_at)}</span>
      </div>
    </div>
  );
}

export function AdCard({ ad, onSelect }) {
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

export function PostDetailModal({ post, onClose }) {
  if (!post) return null;
  return (
    <Dialog open={!!post} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto p-0">
        {post.media_url && (
          <img
            src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(post.media_url)}`}
            alt=""
            className="w-full max-h-64 object-cover"
          />
        )}
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className={`px-2 py-0.5 rounded ${PLATFORM_COLORS[post.platform] || 'bg-gray-100 text-gray-700'}`}>
              {PLATFORM_LABELS[post.platform] || post.platform}
            </span>
            {post.posted_at && <span className="text-muted-foreground">{fmtDate(post.posted_at)}</span>}
          </div>
          {(post.likes != null || post.comments_count != null) && (
            <div className="flex gap-3 text-sm">
              {post.likes != null && <span>❤️ {post.likes.toLocaleString()}</span>}
              {post.comments_count != null && <span>💬 {post.comments_count.toLocaleString()}</span>}
            </div>
          )}
          {post.caption && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{post.caption}</p>
          )}
          <TopPerformerAnalysisBlock raw={post.analysis} />
          <AnalysisBlock raw={post.analysis} />
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            {post.first_seen_at && <p>נראה לראשונה: {timeAgo(post.first_seen_at)}</p>}
            {post.last_seen_at  && <p>נראה לאחרונה: {timeAgo(post.last_seen_at)}</p>}
          </div>
          {post.post_url && (
            <a
              href={post.post_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-primary underline"
            >
              <ExternalLink className="w-3 h-3" /> פתח פוסט מקורי
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function StoryDetailModal({ story, onClose }) {
  if (!story) return null;
  const expired = story.expires_at && new Date(story.expires_at).getTime() < Date.now();
  return (
    <Dialog open={!!story} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto p-0">
        {story.media_url && (
          story.media_type === 'video' ? (
            <video
              src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(story.media_url)}`}
              className="w-full max-h-96 object-cover"
              controls muted loop
            />
          ) : (
            <img
              src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(story.media_url)}`}
              alt=""
              className="w-full max-h-96 object-cover"
            />
          )
        )}
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="px-2 py-0.5 rounded bg-pink-100 text-pink-700">אינסטגרם</span>
            {story.posted_at && <span className="text-muted-foreground">{fmtDate(story.posted_at)}</span>}
            {expired
              ? <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded">פג תוקף</span>
              : <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded">פעיל</span>
            }
          </div>
          <AnalysisBlock raw={story.analysis} />
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            {story.first_seen_at && <p>נראה לראשונה: {timeAgo(story.first_seen_at)}</p>}
            {story.last_seen_at  && <p>נראה לאחרונה: {timeAgo(story.last_seen_at)}</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AdDetailModal({ ad, onClose }) {
  if (!ad) return null;
  const thumb = ad.media_url || ad.video_url;
  return (
    <Dialog open={!!ad} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto p-0">
        {thumb && (
          <img
            src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(thumb)}`}
            alt=""
            className="w-full max-h-64 object-cover"
          />
        )}
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className={`px-2 py-0.5 rounded ${PLATFORM_COLORS[ad.platform] || 'bg-gray-100 text-gray-700'}`}>
              {PLATFORM_LABELS[ad.platform] || ad.platform}
            </span>
            {ad.is_active
              ? <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded">פעיל</span>
              : <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded">לא פעיל</span>
            }
            {ad.page_name && <span className="text-muted-foreground">{ad.page_name}</span>}
          </div>
          {ad.title && <p className="font-semibold text-sm">{ad.title}</p>}
          {ad.body  && <p className="text-sm leading-relaxed whitespace-pre-wrap">{ad.body}</p>}
          {ad.cta   && (
            <span className="inline-block bg-primary/10 text-primary text-xs px-2 py-0.5 rounded">{ad.cta}</span>
          )}
          <AnalysisBlock raw={ad.analysis} />
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            {ad.start_date    && <p>תחילת קמפיין: {fmtDate(ad.start_date)}</p>}
            {ad.end_date      && <p>סיום קמפיין: {fmtDate(ad.end_date)}</p>}
            {ad.first_seen_at && <p>נראה לראשונה: {timeAgo(ad.first_seen_at)}</p>}
            {ad.last_seen_at  && <p>נראה לאחרונה: {timeAgo(ad.last_seen_at)}</p>}
          </div>
          {ad.link && (
            <a
              href={ad.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-primary underline"
            >
              <ExternalLink className="w-3 h-3" /> פתח מודעה מקורית
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function fmtCount(n) {
  if (n == null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const OUTLIER_MULTIPLIER = 2;
const OUTLIER_MIN_SAMPLE = 3;

// Posts whose engagement (likes + comments) is >=2x that competitor's own
// average *for the same platform* — Instagram/Facebook baselines
// differ too much to average together.
export function computeOutlierPosts(posts) {
  const byPlatform = {};
  for (const p of posts) {
    if (p.likes == null && p.comments_count == null) continue;
    const list = byPlatform[p.platform] || (byPlatform[p.platform] = []);
    list.push({ ...p, engagement: (p.likes ?? 0) + (p.comments_count ?? 0) });
  }

  const outliers = [];
  for (const scored of Object.values(byPlatform)) {
    if (scored.length < OUTLIER_MIN_SAMPLE) continue;
    const avg = scored.reduce((s, p) => s + p.engagement, 0) / scored.length;
    if (avg <= 0) continue;
    outliers.push(
      ...scored
        .filter(p => p.engagement >= avg * OUTLIER_MULTIPLIER)
        .map(p => ({ ...p, engagementMultiple: p.engagement / avg })),
    );
  }
  return outliers.sort((a, b) => b.engagement - a.engagement);
}

// Posts-per-week for one entity (a competitor, or the business itself): count
// over the span between its earliest and latest tracked post. Needs >=2 dated
// posts to establish a span; returns null otherwise (nothing to compute a rate from).
export function weeklyPostingRate(posts) {
  const withDates = posts.filter(p => p.posted_at);
  if (withDates.length < 2) return null;
  const times = withDates.map(p => new Date(p.posted_at).getTime()).sort((a, b) => a - b);
  const spanWeeks = Math.max((times[times.length - 1] - times[0]) / (7 * 24 * 3600 * 1000), 1);
  return withDates.length / spanWeeks;
}

/**
 * Shared "analyze top performers" trigger — batch-runs the hook/content-pillar/
 * audience-action-driver analysis for a set of already-detected outlier posts.
 * Manual-trigger for now (see caller); a future auto-trigger just needs to call
 * analyzeNow() from a useEffect instead of a button, no other changes needed.
 */
export function useAnalyzeTopPerformers(outlierPosts, { businessProfileId, postType, onDone, initialInsight }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [insight, setInsight] = useState(initialInsight ?? null);

  const analyzeNow = async () => {
    if (!outlierPosts.length || analyzing) return;
    setAnalyzing(true);
    try {
      const fnName = postType === 'own' ? 'analyzeTopOwnPosts' : 'analyzeTopCompetitorPosts';
      const result = await base44.functions.invoke(
        fnName,
        { businessProfileId, posts: outlierPosts.map(p => ({ id: p.id, engagementMultiple: p.engagementMultiple })) },
        120000,
      );
      const newInsight = (result?.data ?? result)?.outlier_insight;
      if (newInsight) setInsight(newInsight);
      onDone?.();
    } catch (e) {
      console.warn('[useAnalyzeTopPerformers] failed:', e.message);
    }
    setAnalyzing(false);
  };

  return { analyzing, analyzeNow, insight };
}

// Mirrors MAX_POSTS_PER_CALL in analyzeContentTrends.ts.
const POOLED_OUTLIER_POST_CAP = 20;

/**
 * Fetches a business's tracked competitors + their posts and pools each
 * competitor's own engagement-outlier posts (computeOutlierPosts, applied
 * per-competitor so platform baselines aren't blended across competitors)
 * into one cross-competitor set, capped and sorted by engagementMultiple.
 * Shared by CompetitorContentTrends.jsx (Marketing tab) and the Social
 * pillar section (Insights page) so the pooling logic isn't duplicated a
 * third time.
 */
export function usePooledCompetitorOutlierPosts(bpId, { cap = POOLED_OUTLIER_POST_CAP } = {}) {
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

  const pooledOutlierPosts = useMemo(() => {
    const byCompetitor = {};
    for (const p of allPosts) (byCompetitor[p.competitor_id] ||= []).push(p);
    const compNameById = Object.fromEntries(competitors.map(c => [c.id, c.name]));
    return Object.entries(byCompetitor)
      .flatMap(([competitorId, posts]) =>
        computeOutlierPosts(posts).map(p => ({ ...p, competitor_id: competitorId, competitor_name: compNameById[competitorId] })))
      .sort((a, b) => b.engagementMultiple - a.engagementMultiple)
      .slice(0, cap);
  }, [allPosts, competitors, cap]);

  return { competitors, allPosts, pooledOutlierPosts };
}

/**
 * Cross-competitor variant of useAnalyzeTopPerformers — pools outlier posts
 * from ALL tracked competitors (each item carries its own competitorId) and
 * synthesizes a copy insight + a visual insight via analyzeContentTrends,
 * kept separate so a text-vs-image trend doesn't get blurred into one
 * merged paragraph.
 */
export function useAnalyzeContentTrends(pooledOutlierPosts, { businessProfileId, onDone, initialCopyInsight, initialCopyExamples, initialVisualInsight }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [copyInsight, setCopyInsight] = useState(initialCopyInsight ?? null);
  const [copyExamples, setCopyExamples] = useState(initialCopyExamples ?? []);
  const [visualInsight, setVisualInsight] = useState(initialVisualInsight ?? null);

  const analyzeNow = async () => {
    if (!pooledOutlierPosts.length || analyzing) return;
    setAnalyzing(true);
    try {
      const result = await base44.functions.invoke(
        'analyzeContentTrends',
        {
          businessProfileId,
          posts: pooledOutlierPosts.map(p => ({ id: p.id, competitorId: p.competitor_id, engagementMultiple: p.engagementMultiple })),
        },
        120000,
      );
      const data = result?.data ?? result;
      if (data?.content_trends_copy_insight) setCopyInsight(data.content_trends_copy_insight);
      if (data?.content_trends_copy_examples?.length) setCopyExamples(data.content_trends_copy_examples);
      if (data?.content_trends_visual_insight) setVisualInsight(data.content_trends_visual_insight);
      onDone?.();
    } catch (e) {
      console.warn('[useAnalyzeContentTrends] failed:', e.message);
    }
    setAnalyzing(false);
  };

  return { analyzing, analyzeNow, copyInsight, copyExamples, visualInsight };
}

/**
 * Analyzes what competitors' social bios commonly contain and how they're
 * structured, pooled across ALL tracked competitors' profiles via
 * analyzeBioProfiles — same real-verbatim-example approach as
 * useAnalyzeContentTrends, but there's nothing to rank/select here (one bio
 * per competitor+platform), so it takes no post/profile list, just the
 * business id.
 */
export function useAnalyzeBioTrends(hasProfiles, { businessProfileId, onDone, initialBioInsight, initialBioExamples }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [bioInsight, setBioInsight] = useState(initialBioInsight ?? null);
  const [bioExamples, setBioExamples] = useState(initialBioExamples ?? []);

  const analyzeNow = async () => {
    if (!hasProfiles || analyzing) return;
    setAnalyzing(true);
    try {
      const result = await base44.functions.invoke('analyzeBioProfiles', { businessProfileId }, 60000);
      const data = result?.data ?? result;
      if (data?.content_trends_bio_insight) setBioInsight(data.content_trends_bio_insight);
      if (data?.content_trends_bio_examples?.length) setBioExamples(data.content_trends_bio_examples);
      onDone?.();
    } catch (e) {
      console.warn('[useAnalyzeBioTrends] failed:', e.message);
    }
    setAnalyzing(false);
  };

  return { analyzing, analyzeNow, bioInsight, bioExamples };
}

/**
 * Suggests a rewritten version of the business's OWN bio per platform,
 * grounded in the winning-bio pattern already synthesized across
 * competitors (useAnalyzeBioTrends must have run first — the backend
 * 400s otherwise). Returns an array of {platform, suggested_bio, rationale}.
 */
export function useSuggestBioFix(canSuggest, { businessProfileId, onDone, initialSuggestions }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [suggestions, setSuggestions] = useState(initialSuggestions ?? []);

  const analyzeNow = async () => {
    if (!canSuggest || analyzing) return;
    setAnalyzing(true);
    try {
      const result = await base44.functions.invoke('suggestBioFix', { businessProfileId }, 60000);
      const data = result?.data ?? result;
      if (data?.suggestions?.length) setSuggestions(data.suggestions);
      onDone?.();
    } catch (e) {
      console.warn('[useSuggestBioFix] failed:', e.message);
    }
    setAnalyzing(false);
  };

  return { analyzing, analyzeNow, suggestions };
}

export function ProfileHeader({ profile }) {
  let highlights = [];
  try { highlights = profile.highlights ? JSON.parse(profile.highlights) : []; } catch { /* ignore malformed */ }

  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      {profile.cover_photo_url && (
        <img
          src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(profile.cover_photo_url)}`}
          alt=""
          className="w-full h-24 object-cover"
          loading="lazy"
          onError={e => { e.currentTarget.style.display = 'none'; }}
        />
      )}
      <div className="p-4 flex items-start gap-4">
        {profile.profile_picture_url && (
          <img
            src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(profile.profile_picture_url)}`}
            alt=""
            className="w-20 h-20 rounded-full object-cover shrink-0 border border-border"
            loading="lazy"
            onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'block'; }}
          />
        )}
        <div className={`w-20 h-20 rounded-full bg-muted shrink-0 ${profile.profile_picture_url ? 'hidden' : 'block'}`} />

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded ${PLATFORM_COLORS[profile.platform] || 'bg-gray-100 text-gray-700'}`}>
              {PLATFORM_LABELS[profile.platform] || profile.platform}
            </span>
            {profile.is_verified && <BadgeCheck className="w-4 h-4 text-blue-500 shrink-0" />}
            {profile.category && <span className="text-xs text-muted-foreground">{profile.category}</span>}
          </div>

          {(profile.follower_count != null || profile.following_count != null || profile.post_count != null || profile.checkin_count != null) && (
            <div className="flex gap-5 text-sm">
              {profile.follower_count != null && <span><b className="text-base">{fmtCount(profile.follower_count)}</b> עוקבים</span>}
              {profile.following_count != null && <span><b className="text-base">{fmtCount(profile.following_count)}</b> נעקבים</span>}
              {profile.post_count != null && <span><b className="text-base">{fmtCount(profile.post_count)}</b> פוסטים</span>}
              {profile.checkin_count != null && <span><b className="text-base">{fmtCount(profile.checkin_count)}</b> ביקרו כאן</span>}
            </div>
          )}

          {/* Facebook falls back to an auto-generated summary restating the stats already
              shown above when the page has no custom Intro text — only suppress that case
              (see isFacebookAutoBio); a real Intro is shown just like Instagram's bio. */}
          {profile.bio && !(profile.platform === 'facebook' && isFacebookAutoBio(profile)) && (
            <p className="text-sm leading-relaxed whitespace-pre-line">{profile.bio}</p>
          )}

          {stalenessNote(profile.last_post_at) && (
            <p className="text-xs text-amber-600 dark:text-amber-500">{stalenessNote(profile.last_post_at)}</p>
          )}

          {(profile.contact_phone || profile.contact_email || profile.contact_address || profile.external_url) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
              {profile.contact_phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5 shrink-0" />{profile.contact_phone}</span>}
              {profile.contact_email && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5 shrink-0" />{profile.contact_email}</span>}
              {profile.contact_address && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 shrink-0" />{profile.contact_address}</span>}
              {profile.external_url && (
                <a href={profile.external_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                  <LinkIcon className="w-3.5 h-3.5 shrink-0" />{profile.external_url}
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {highlights.length > 0 && (
        <div className="flex gap-3 overflow-x-auto px-4 pb-4">
          {highlights.slice(0, 10).map((h, idx) => (
            <div key={idx} className="flex flex-col items-center gap-1 shrink-0 w-14">
              {h.cover_url ? (
                <img
                  src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(h.cover_url)}`}
                  alt=""
                  className="w-14 h-14 rounded-full object-cover border border-border"
                  loading="lazy"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-muted" />
              )}
              {h.title && <span className="text-[10px] text-muted-foreground truncate w-14 text-center">{h.title}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Toggle between platforms when a competitor has more than one profile overview
// (e.g. both Instagram and Facebook) instead of silently picking just one.
export function ProfileHeaderWithToggle({ profiles }) {
  const available = (profiles || []).filter(Boolean);
  const [platform, setPlatform] = useState(() => (available.find(p => p.platform === 'instagram') || available[0])?.platform);
  if (available.length === 0) return null;
  const active = available.find(p => p.platform === platform) || available[0];

  return (
    <div className="space-y-2">
      {available.length > 1 && (
        <div className="flex gap-1">
          {available.map(p => (
            <button
              key={p.platform}
              type="button"
              onClick={() => setPlatform(p.platform)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                active.platform === p.platform
                  ? `${PLATFORM_COLORS[p.platform] || 'bg-gray-100 text-gray-700'} border-transparent`
                  : 'text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              {PLATFORM_LABELS[p.platform] || p.platform}
            </button>
          ))}
        </div>
      )}
      <ProfileHeader profile={active} />
    </div>
  );
}
