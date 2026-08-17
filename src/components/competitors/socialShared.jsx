import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { base44 } from '@/api/base44Client';

export const PLATFORM_LABELS = { instagram: 'אינסטגרם', facebook: 'פייסבוק', tiktok: 'טיקטוק' };
export const PLATFORM_COLORS = {
  instagram: 'bg-pink-100 text-pink-700',
  facebook:  'bg-blue-100 text-blue-700',
  tiktok:    'bg-gray-100 text-gray-800',
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
];

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

export function StoryCard({ story }) {
  const expired = story.expires_at && new Date(story.expires_at).getTime() < Date.now();
  return (
    <div
      className="shrink-0 w-36 rounded-xl border border-border bg-background overflow-hidden relative"
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
