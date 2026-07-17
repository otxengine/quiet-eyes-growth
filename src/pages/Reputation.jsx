import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Star, Plus, Search, Loader2, Bot, Send, X, ChevronDown, MoreVertical } from 'lucide-react';
import { toast } from 'sonner';
import AddReviewModal from '@/components/reputation/AddReviewModal';
import RequestReviewModal from '@/components/reputation/RequestReviewModal';
import ScheduledReviewRequests from '@/components/reputation/ScheduledReviewRequests';
import RatingTrendChart from '@/components/reputation/RatingTrendChart';
import StatCards from '@/components/shared/StatCards';
import PageHeader from '@/components/shared/PageHeader';

const PLATFORM_ICONS = {
  google:    { icon: '🔍', label: 'Google',    color: '#4285f4' },
  facebook:  { icon: '📘', label: 'Facebook',  color: '#1877f2' },
  instagram: { icon: '📸', label: 'Instagram', color: '#e1306c' },
  tripadvisor:{ icon: '🦉', label: 'TripAdvisor', color: '#00af87' },
  waze:      { icon: '🗺️', label: 'Waze',      color: '#00d4ff' },
  tiktok:    { icon: '🎵', label: 'TikTok',    color: '#000' },
  wolt:      { icon: '🛵', label: 'Wolt',      color: '#01dae8' },
  default:   { icon: '⭐', label: 'אחר',       color: '#9090A8' },
};

const SENTIMENT_DOT = {
  negative: 'bg-red-500',
  neutral:  'bg-amber-400',
  positive: 'bg-green-500',
};

function ReviewRow({ review, onApprove }) {
  const platCfg = PLATFORM_ICONS[review.source] || PLATFORM_ICONS.default;
  const sentDot = SENTIMENT_DOT[review.sentiment] || 'bg-gray-400';
  const relDate = (() => {
    const d = new Date(review.created_at || review.created_date || '');
    if (isNaN(d.getTime())) return '—';
    const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (diff === 0) return 'היום';
    if (diff === 1) return 'אתמול';
    if (diff < 7)  return `לפני ${diff} ימים`;
    if (diff < 30) return `לפני ${Math.floor(diff / 7)} שבועות`;
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
  })();
  const isPending = review.response_status === 'pending';

  return (
    <div dir="rtl" className="flex items-center gap-3 px-4 py-3 border-b border-border/40 last:border-0 hover:bg-gray-50/40 transition-colors">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${sentDot}`} />
      <span className="flex-1 text-[12px] text-foreground truncate min-w-0">
        {(review.text || '').slice(0, 80) || '(ביקורת ללא טקסט)'}
        {(review.text || '').length > 80 ? '...' : ''}
      </span>
      <span className="text-[12px] font-semibold text-foreground w-8 flex-shrink-0 text-center">
        {review.rating ? Number(review.rating).toFixed(1) : '—'}
      </span>
      <span className="text-[18px] w-8 flex-shrink-0 text-center" title={platCfg.label}>{platCfg.icon}</span>
      <span className="text-[11px] text-foreground-muted w-20 flex-shrink-0">{relDate}</span>
      <button onClick={() => onApprove(review)}
        className={`flex-shrink-0 text-[11px] px-3 py-1.5 rounded-full border font-medium transition-colors ${
          isPending
            ? 'border-[#e8344d] text-[#e8344d] hover:bg-red-50'
            : 'border-border text-foreground-muted hover:bg-secondary'
        }`}>
        {isPending ? 'אשר/ערוך תגובה' : 'ערוך תגובה'}
      </button>
      <button className="text-foreground-muted hover:text-foreground flex-shrink-0">
        <MoreVertical className="w-4 h-4" />
      </button>
    </div>
  );
}

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3007/api').replace(/\/$/, '');

function ReviewReplyPanel({ review, bpId, onClose, onSent }) {
  const platCfg = PLATFORM_ICONS[review.source] || PLATFORM_ICONS.default;
  const [replyText, setReplyText] = useState(review.suggested_response || '');
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);

  const generateReply = async () => {
    setGenerating(true);
    try {
      await base44.functions.invoke('autoRespondToReviews', { businessProfileId: bpId });
      const rows = await base44.entities.Review.filter({ id: review.id });
      const updated = rows?.[0];
      if (updated?.suggested_response) {
        setReplyText(updated.suggested_response);
        toast.success('תגובה AI נוצרה ✓');
      } else {
        toast.info('לא נמצאה תגובה — נסה שנית');
      }
    } catch {
      toast.error('שגיאה ביצירת תגובה');
    }
    setGenerating(false);
  };

  const sendReply = async () => {
    if (!replyText.trim()) { toast.error('יש להזין תגובה'); return; }
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/social/reviews/${review.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessProfileId: bpId, replyText }),
      });
      const data = await res.json();
      if (data.published) {
        toast.success('התגובה פורסמה ב-Google ✓');
      } else {
        toast.success('התגובה נשמרה — תפורסם ב-Google כשהחיבור יאומת');
      }
      onSent();
    } catch (e) {
      toast.error('שגיאת חיבור: ' + e.message);
    }
    setSending(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl w-full max-w-lg mx-auto z-10 shadow-xl" dir="rtl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="text-lg">{platCfg.icon}</span>
            <span className="text-[13px] font-bold text-gray-900">תגובה לביקורת</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-semibold text-gray-500">{review.reviewer_name || 'לקוח'}</span>
            <span className="text-amber-400 text-[12px]">{'★'.repeat(review.rating || 0)}{'☆'.repeat(5 - (review.rating || 0))}</span>
          </div>
          <p className="text-[12px] text-gray-700 leading-relaxed">{review.text || '(ביקורת ללא טקסט)'}</p>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-[12px] font-semibold text-gray-700">התגובה שלך</label>
            <button
              onClick={generateReply}
              disabled={generating}
              className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
            >
              {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />}
              {generating ? 'מייצר...' : 'צור עם AI'}
            </button>
          </div>
          <textarea
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            rows={5}
            placeholder="כתוב תגובה לביקורת..."
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] text-gray-800 resize-none focus:outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-200"
          />
          <p className="text-[10px] text-gray-400">
            {review.source === 'google'
              ? 'התגובה תפורסם ישירות ב-Google Business Profile שלך'
              : 'התגובה תישמר במערכת'}
          </p>
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-[13px] font-medium text-gray-600 hover:bg-gray-50">
            ביטול
          </button>
          <button
            onClick={sendReply}
            disabled={sending || !replyText.trim()}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gray-900 text-white text-[13px] font-semibold hover:bg-gray-700 disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sending ? 'שולח...' : 'שלח תגובה'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Reputation() {
  // @ts-ignore -- outlet context shape not inferred in JSX
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [_scanning, setScanning] = useState(false);
  const [selectedReview, setSelectedReview] = useState(null);
  const [selectedSources] = useState(['google', 'facebook', 'instagram', 'tripadvisor', 'waze', 'tiktok', 'wolt', '10bis', 'easy', 'forums']);

  const handleCollectReviews = async () => {
    setScanning(true);
    try {
      const res = await base44.functions.invoke('scanAllReviews', {
        businessProfileId: bpId,
        sources: selectedSources,
      });
      const { new_reviews = 0 } = res?.data || {};
      if (new_reviews > 0) {
        toast.success(`נמצאו ${new_reviews} ביקורות חדשות מ-${selectedSources.length} מקורות ✓`);
      } else {
        toast.info('לא נמצאו ביקורות חדשות');
      }
      queryClient.invalidateQueries({ queryKey: ['reviewsPage'] });
      queryClient.invalidateQueries({ queryKey: ['negativeAlerts', bpId] });
    } catch (err) {
      toast.error('שגיאה באיסוף ביקורות');
    }
    setScanning(false);
  };

  useEffect(() => {
    // @ts-ignore -- internal scan hook for DevTools
    window.__cortexi_scan = handleCollectReviews;
    // @ts-ignore
    return () => { delete window.__cortexi_scan; };
  }, [bpId]);

  const { data: allReviewsRaw = [] } = useQuery({
    queryKey: ['reviewsPage', bpId],
    queryFn: () => base44.entities.Review.filter({ linked_business: bpId }, '-created_date', 200),
    enabled: !!bpId
  });

  const { data: topThemes = [] } = useQuery({
    queryKey: ['topThemes', bpId],
    queryFn: async () => {
      const res = await base44.functions.invoke('analyzeSentiment', { businessProfileId: bpId });
      return res?.data?.top_themes ?? [];
    },
    enabled: !!bpId,
    staleTime: 1000 * 60 * 30,
  });

  const reviews = /** @type {Array<Record<string, any>>} */ (allReviewsRaw).filter(r => !r.is_historical && r.rating != null && Number(r.rating) > 0);

  const avgRating = reviews.length > 0 ? (reviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / reviews.length) : 0;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const thisMonthReviews = reviews.filter(r => (r.created_at || r.created_date) >= monthStart);
  const prevMonthReviews = reviews.filter(r => {
    const d = r.created_at || r.created_date || '';
    return d >= prevMonthStart && d < monthStart;
  });
  const prevMonthAvg = prevMonthReviews.length > 0
    ? prevMonthReviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / prevMonthReviews.length
    : 0;
  const thisMonthAvg = thisMonthReviews.length > 0
    ? thisMonthReviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / thisMonthReviews.length
    : 0;
  const ratingDelta = prevMonthAvg > 0 && thisMonthAvg > 0
    ? (thisMonthAvg - prevMonthAvg).toFixed(1)
    : null;
  const pendingCount = reviews.filter(r => r.response_status === 'pending').length;

  // Sort: pending negative first, then pending positive, then pending neutral, then responded
  const sortedReviews = [...reviews].sort((a, b) => {
    const aP = a.response_status === 'pending' ? 1 : 0;
    const bP = b.response_status === 'pending' ? 1 : 0;
    if (aP !== bP) return bP - aP;
    if (aP && bP) {
      const order = { negative: 0, neutral: 1, positive: 2 };
      return (order[a.sentiment] ?? 1) - (order[b.sentiment] ?? 1);
    }
    return (new Date(b.created_at || b.created_date || 0).getTime() || 0) - (new Date(a.created_at || a.created_date || 0).getTime() || 0);
  });

  const respondedCount = reviews.filter(r => ['responded', 'auto_responded', 'suggested', 'published'].includes(r.response_status)).length;
  const responseRate = reviews.length > 0 ? Math.round((respondedCount / reviews.length) * 100) : 0;

  const statCards = [
    {
      count: pendingCount,
      label: 'ביקורות דורשות מענה',
      borderColor: 'red',
      change: pendingCount > 0 ? `${Math.min(pendingCount, 3)} חדשות מאז השבוע הקודם` : 'הכל טופל',
      changeColor: pendingCount > 0 ? 'text-red-500' : 'text-green-600',
    },
    {
      count: avgRating > 0 ? avgRating.toFixed(1) : '—',
      label: 'ציון ממוצע',
      borderColor: 'blue',
      change: 'ללא שינוי מהחודש הקודם',
      changeColor: 'text-foreground-muted',
    },
    {
      count: ratingDelta != null ? (Number(ratingDelta) >= 0 ? `+${ratingDelta}` : ratingDelta) : '—',
      label: 'שינוי בדירוג',
      borderColor: 'yellow',
      change: ratingDelta != null ? (Number(ratingDelta) >= 0 ? 'שיפור מהחודש הקודם' : 'ירידה מהחודש הקודם') : 'אין נתוני השוואה',
      changeColor: ratingDelta != null && Number(ratingDelta) >= 0 ? 'text-green-600' : 'text-red-500',
    },
    {
      count: thisMonthReviews.length,
      label: 'ביקורות חדשות החודש',
      borderColor: 'none',
      change: thisMonthReviews.length > 0 ? `+${thisMonthReviews.length} מהחודש הקודם` : null,
      changeColor: 'text-green-600',
    },
  ];

  const [reviewSearch, setReviewSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');

  const filteredTable = sortedReviews.filter(r => {
    if (platformFilter !== 'all' && r.source !== platformFilter) return false;
    if (reviewSearch && !(r.text || '').toLowerCase().includes(reviewSearch.toLowerCase()) &&
        !(r.reviewer_name || '').toLowerCase().includes(reviewSearch.toLowerCase())) return false;
    return true;
  });

  const insights = [
    pendingCount > 0 && {
      text: `${pendingCount} ביקורות שליליות ממתינות למענה`,
      border: 'border-r-red-500',
      dot: 'bg-red-500',
    },
    responseRate < 80 && reviews.length > 0 && {
      text: `שיעור התגובה ירד ב-${100 - responseRate}%`,
      border: 'border-r-yellow-400',
      dot: 'bg-yellow-400',
    },
    thisMonthReviews.filter(r => Number(r.rating) >= 5).length > 0 && {
      text: `${thisMonthReviews.filter(r => Number(r.rating) >= 5).length} דירוגי 5 כוכבים התקבלו החודש. הידד!`,
      border: 'border-r-green-500',
      dot: 'bg-green-500',
    },
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      <PageHeader
        title="מוניטין/נראות עסקית"
        subtitle="מעקב אחר ביקורות, דירוג העסק והמלצות לשיפור המוניטין"
        actionLabel="הוספת ביקורת"
        actionIcon={<Plus className="w-4 h-4" />}
        onAction={() => setShowAddModal(true)}
      />

      <StatCards cards={statCards} />

      {/* Two-column: chart (40%) + מבט על (60%) */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="md:col-span-2 bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3" dir="rtl">
              <button className="flex items-center gap-1 text-[11px] text-foreground-muted border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-secondary transition-colors">
                חצי שנתי <ChevronDown className="w-3 h-3" />
              </button>
              <span className="text-[13px] font-semibold text-foreground">דירוג לאורך זמן</span>
            </div>
            <RatingTrendChart reviews={reviews} />
          </div>

          <div className="md:col-span-3 bg-gradient-to-l from-pink-50 via-purple-50 to-blue-50 border border-gray-200 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3" dir="rtl">
              <button className="flex items-center gap-1.5 text-[11px] text-foreground-muted border border-gray-200 bg-white/60 rounded-lg px-2.5 py-1.5 hover:bg-white transition-colors">
                לכל התובנות וההמלצות
              </button>
              <span className="text-[14px] font-bold text-foreground">מבט על</span>
            </div>
            <div className="space-y-2.5">
              {insights.length === 0 ? (
                <div className="bg-white/70 rounded-xl p-4 text-center">
                  <p className="text-[12px] text-foreground-muted">הכל תקין — אין פעולות דחופות</p>
                </div>
              ) : insights.map((ins, i) => (
                <div key={i} dir="rtl" className={`flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-gray-100 border-r-4 ${ins.border}`}>
                  <button className="flex-shrink-0 text-[11px] border border-rose-300 text-rose-600 px-3 py-1.5 rounded-full hover:bg-rose-50 transition-colors font-medium">
                    קרא והגב
                  </button>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ins.dot}`} />
                    <span className="text-[12px] font-semibold text-foreground truncate">{ins.text}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
      </div>

      {/* Top themes rollup */}
      {topThemes.length > 0 && (() => {
        const maxTotal = topThemes[0]?.total || 1;
        return (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3" dir="rtl">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-[10px] text-foreground-muted"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> חיובי</span>
                <span className="flex items-center gap-1 text-[10px] text-foreground-muted"><span className="w-2 h-2 rounded-full bg-rose-400 inline-block" /> שלילי</span>
                <span className="flex items-center gap-1 text-[10px] text-foreground-muted"><span className="w-2 h-2 rounded-full bg-amber-300 inline-block" /> ניטרלי</span>
              </div>
              <span className="text-[13px] font-semibold text-foreground">נושאים מובילים <span className="text-foreground-muted font-normal text-[11px]">— 90 יום</span></span>
            </div>
            <div className="space-y-2" dir="rtl">
              {topThemes.slice(0, 8).map(t => (
                <div key={t.theme} className="flex items-center gap-3">
                  <span className="text-[12px] font-medium text-foreground w-20 flex-shrink-0 text-right truncate">{t.theme}</span>
                  <div className="flex-1 h-3.5 rounded-full bg-gray-100 overflow-hidden flex" style={{ maxWidth: `${(t.total / maxTotal) * 100}%` }}>
                    {t.positive > 0 && <div className="bg-green-400 h-full transition-all" style={{ width: `${(t.positive / t.total) * 100}%` }} />}
                    {t.neutral  > 0 && <div className="bg-amber-300 h-full transition-all" style={{ width: `${(t.neutral  / t.total) * 100}%` }} />}
                    {t.negative > 0 && <div className="bg-rose-400  h-full transition-all" style={{ width: `${(t.negative / t.total) * 100}%` }} />}
                  </div>
                  <span className="text-[11px] text-foreground-muted w-6 flex-shrink-0">{t.total}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Reviews table */}
      <div>
        {/* Section header: title on RIGHT, filters+search on LEFT (RTL) */}
        <div className="flex items-center justify-between mb-3" dir="rtl">
          <h2 className="text-[15px] font-bold text-foreground">ביקורות <span className="text-foreground-muted font-normal">({reviews.length})</span></h2>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Filters first in DOM = appear on RIGHT within the group in RTL */}
            <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
              {[{ key: 'all', label: 'הכל' }, { key: 'google', label: 'Google' }, { key: 'facebook', label: 'Facebook' }].map(f => (
                <button key={f.key} onClick={() => setPlatformFilter(f.key)}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                    platformFilter === f.key ? 'bg-white shadow-sm text-foreground' : 'text-foreground-muted hover:text-foreground'
                  }`}>
                  {f.label}
                </button>
              ))}
            </div>
            <button className="flex items-center gap-1 text-[11px] text-foreground-muted border border-border rounded-lg px-2.5 py-1.5 hover:bg-secondary transition-colors">
              כל הפלטפורמות <ChevronDown className="w-3 h-3" />
            </button>
            <button className="flex items-center gap-1 text-[11px] text-foreground-muted border border-border rounded-lg px-2.5 py-1.5 hover:bg-secondary transition-colors">
              פילטרים מתקדמים <ChevronDown className="w-3 h-3" />
            </button>
            {(reviewSearch || platformFilter !== 'all') && (
              <button onClick={() => { setReviewSearch(''); setPlatformFilter('all'); }} className="text-[11px] text-foreground-muted hover:text-foreground transition-colors">
                נקה פילטרים
              </button>
            )}
            {/* Search last = appears leftmost in RTL */}
            <div className="relative">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted" />
              <input type="text" placeholder="חיפוש" value={reviewSearch} onChange={e => setReviewSearch(e.target.value)} dir="rtl"
                className="pr-8 pl-3 py-1.5 text-[12px] border border-border rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-foreground w-28" />
            </div>
          </div>
        </div>

        {reviews.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <Star className="w-8 h-8 text-foreground-muted opacity-30 mx-auto mb-3" />
            <p className="text-[13px] text-foreground-muted mb-4">לא נמצאו ביקורות</p>
            <button onClick={() => setShowAddModal(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-full text-[12px] font-semibold hover:opacity-90">
              <Plus className="w-4 h-4" /> הוסף ביקורת ראשונה
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div dir="rtl" className="flex items-center gap-3 px-4 py-2.5 bg-gray-50/60 border-b border-gray-200 text-[11px] font-semibold text-foreground-muted">
              <span className="w-4" />
              <span className="flex-1">ביקורת</span>
              <span className="w-12 text-center">דירוג</span>
              <span className="w-12 text-center">פלטפורמה</span>
              <span className="w-24">מועד</span>
              <span className="w-32" />
              <span className="w-8" />
            </div>
            {filteredTable.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-[12px] text-foreground-muted">אין ביקורות התואמות את הסינון</p>
              </div>
            ) : filteredTable.map(review => (
              <ReviewRow key={review.id} review={review}
                onApprove={() => setSelectedReview(review)}
              />
            ))}
          </div>
        )}
      </div>

      <ScheduledReviewRequests bpId={bpId} />

      {showAddModal && <AddReviewModal bpId={bpId} onClose={() => setShowAddModal(false)} onAdded={() => { queryClient.invalidateQueries({ queryKey: ['reviewsPage'] }); setShowAddModal(false); }} />}
      {showRequestModal && <RequestReviewModal businessProfile={businessProfile} onClose={() => setShowRequestModal(false)} onSent={() => { queryClient.invalidateQueries({ queryKey: ['reviewRequests'] }); setShowRequestModal(false); }} />}
      {selectedReview && (
        <ReviewReplyPanel
          review={selectedReview}
          bpId={bpId}
          onClose={() => setSelectedReview(null)}
          onSent={() => {
            queryClient.invalidateQueries({ queryKey: ['reviewsPage', bpId] });
            setSelectedReview(null);
          }}
        />
      )}
    </div>
  );
}