import React, { useState, useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Star, Plus, Search, Loader2, MessageCircle, BarChart2, Bot, Send, MoreHorizontal, AlertTriangle, X } from 'lucide-react';
import { toast } from 'sonner';
import ReviewCard from '@/components/reputation/ReviewCard';
import AddReviewModal from '@/components/reputation/AddReviewModal';
import RequestReviewModal from '@/components/reputation/RequestReviewModal';
import AiInsightBox from '@/components/ai/AiInsightBox';
import AiInsightsBar from '@/components/ai/AiInsightsBar';
import ScheduledReviewRequests from '@/components/reputation/ScheduledReviewRequests';
import RatingTrendChart from '@/components/reputation/RatingTrendChart';
import EmptyState from '@/components/ui/EmptyState';

export default function Reputation() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [analyzingSentiment, setAnalyzingSentiment] = useState(false);
  const [sentimentResult, setSentimentResult] = useState(null);
  const [autoResponding, setAutoResponding] = useState(false);
  const [sendingRequests, setSendingRequests] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef(null);
  const [selectedSources, setSelectedSources] = useState(['google', 'facebook', 'instagram', 'tripadvisor', 'waze', 'tiktok', 'wolt', '10bis', 'easy', 'forums']);
  const [dismissedAlerts, setDismissedAlerts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('dismissed_rep_alerts') || '[]'); } catch { return []; }
  });

  const handleSendRequests = async () => {
    if (!bpId) return;
    setSendingRequests(true);
    setMoreMenuOpen(false);
    toast.info('שולח בקשות ביקורת ללקוחות מרוצים...');
    try {
      const res = await base44.functions.invoke('reviewRequestAutomation', { businessProfileId: bpId });
      const { requests_sent = 0 } = res?.data || {};
      queryClient.invalidateQueries({ queryKey: ['reviewRequests', bpId] });
      toast.success(requests_sent > 0 ? `${requests_sent} בקשות נשלחו ✓` : 'אין לקוחות כשירים כרגע');
    } catch {
      toast.error('שגיאה בשליחת בקשות');
    }
    setSendingRequests(false);
  };

  // FIX 7: Sentiment analysis
  const handleAnalyzeSentiment = async () => {
    setAnalyzingSentiment(true);
    setSentimentResult(null);
    try {
      const res = await base44.functions.invoke('analyzeSentiment', { businessProfileId: bpId });
      const data = res?.data || res;
      setSentimentResult(data);
    } catch (err) {
      toast.error('שגיאה בניתוח סנטימנט');
    }
    setAnalyzingSentiment(false);
  };

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
    window.__quieteyes_scan = handleCollectReviews;
    return () => { delete window.__quieteyes_scan; };
  }, [bpId]);

  useEffect(() => {
    function handleOutside(e) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) setMoreMenuOpen(false);
    }
    if (moreMenuOpen) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [moreMenuOpen]);

  const { data: allReviewsRaw = [] } = useQuery({
    queryKey: ['reviewsPage', bpId],
    queryFn: () => base44.entities.Review.filter({ linked_business: bpId }, '-created_date', 200),
    enabled: !!bpId
  });

  const reviews = allReviewsRaw.filter(r => !r.is_historical && r.rating != null && Number(r.rating) > 0);
  const historicalReviews = allReviewsRaw.filter(r => r.is_historical);
  const [showHistorical, setShowHistorical] = useState(false);

  const { data: reviewRequests = [] } = useQuery({
    queryKey: ['reviewRequests', bpId],
    queryFn: () => base44.entities.ReviewRequest.filter({ linked_business: bpId }, '-created_date', 100),
    enabled: !!bpId
  });

  // Real-time: load reputation-related alerts — poll every 2 minutes
  const { data: negativeAlerts = [] } = useQuery({
    queryKey: ['negativeAlerts', bpId],
    queryFn: async () => {
      const [neg, risk] = await Promise.all([
        base44.entities.ProactiveAlert.filter(
          { linked_business: bpId, alert_type: 'negative_review', is_dismissed: false },
          '-created_at', 8
        ),
        base44.entities.ProactiveAlert.filter(
          { linked_business: bpId, alert_type: 'reputation_risk', is_dismissed: false },
          '-created_at', 4
        ),
      ]);
      return [...neg, ...risk].sort((a, b) =>
        new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      );
    },
    enabled: !!bpId,
    refetchInterval: 2 * 60 * 1000,
  });

  // Review timing recommendation from reviewRequestTimingAgent
  const { data: reviewTimingSignal } = useQuery({
    queryKey: ['reviewTimingSignal', bpId],
    queryFn: () => base44.entities.MarketSignal.filter(
      { linked_business: bpId, category: 'review_timing' },
      '-detected_at', 1
    ).then(r => r[0] || null),
    enabled: !!bpId,
    staleTime: 60 * 60 * 1000,
  });

  const visibleAlerts = negativeAlerts.filter(a => !dismissedAlerts.includes(a.id));

  function dismissAlert(id) {
    const next = [...dismissedAlerts, id];
    setDismissedAlerts(next);
    localStorage.setItem('dismissed_rep_alerts', JSON.stringify(next));
  }
  const monthStartForReqs = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const requestsThisMonth = reviewRequests.filter(r => (r.sent_at || r.created_date) >= monthStartForReqs).length;

  const avgRating = reviews.length > 0 ? (reviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / reviews.length) : 0;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const thisMonthReviews = reviews.filter(r => (r.created_at || r.created_date) >= monthStart);
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

  const verifiedCount = reviews.filter(r => r.source_url).length;
  const respondedCount = reviews.filter(r => ['responded', 'auto_responded', 'suggested', 'published'].includes(r.response_status)).length;
  const responseRate = reviews.length > 0 ? Math.round((respondedCount / reviews.length) * 100) : 0;

  const statCards = [
    { label: 'ציון ממוצע', value: avgRating > 0 ? avgRating.toFixed(1) : '—', color: avgRating >= 4.3 ? 'text-emerald-600' : avgRating >= 4 ? 'text-amber-600' : avgRating > 0 ? 'text-red-600' : '' },
    { label: 'ביקורות החודש', value: thisMonthReviews.length },
    { label: 'ממתינות לתגובה', value: pendingCount, color: pendingCount > 3 ? 'text-red-600' : pendingCount > 0 ? 'text-amber-600' : 'text-emerald-600' },
    { label: 'שיעור תגובה', value: reviews.length > 0 ? `${responseRate}%` : '—', color: responseRate >= 80 ? 'text-emerald-600' : responseRate >= 50 ? 'text-amber-600' : reviews.length > 0 ? 'text-red-600' : '' },
    { label: 'בקשות ביקורת החודש', value: requestsThisMonth },
  ];

  const [filterSentiment, setFilterSentiment] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const filteredReviews = sortedReviews.filter(r => {
    if (filterSentiment !== 'all' && r.sentiment !== filterSentiment) return false;
    if (filterStatus === 'pending' && r.response_status !== 'pending') return false;
    if (filterStatus === 'responded' && !['responded', 'auto_responded', 'suggested', 'published'].includes(r.response_status)) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <AiInsightsBar
        title="תובנות AI — מוניטין"
        prompt={`נתח מגמות ביקורות של עסק: מהם הנושאים החוזרים בביקורות שליליות, מה הסנטימנט הכללי, ומה הפעולה הכי יעילה לשיפור הדירוג הממוצע.`}
      />
      <div className="flex items-center justify-between">
        <h1 className="text-[16px] font-bold text-foreground tracking-tight">מוניטין</h1>
        <div className="flex items-center gap-2">
          {/* Primary: AI Responses */}
          <button onClick={async () => {
              if (!bpId) return;
              setAutoResponding(true);
              toast.info('מייצר תגובות AI לביקורות...');
              try {
                const res = await base44.functions.invoke('autoRespondToReviews', { businessProfileId: bpId });
                const { responses_generated = 0 } = res?.data || {};
                queryClient.invalidateQueries({ queryKey: ['reviewsPage', bpId] });
                toast.success(responses_generated > 0 ? `${responses_generated} תגובות מוכנות לאישור ✓` : 'אין ביקורות שדורשות תגובה');
              } catch { toast.error('שגיאה ביצירת תגובות'); }
              setAutoResponding(false);
            }} disabled={autoResponding}
            className="btn-subtle flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100 transition-all disabled:opacity-50">
            {autoResponding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
            {autoResponding ? 'מייצר...' : 'תגובות AI'}
          </button>
          {/* Primary: Collect Reviews */}
          <button onClick={handleCollectReviews} disabled={scanning}
            className="btn-subtle flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium border border-border text-foreground hover:bg-secondary transition-all disabled:opacity-50">
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {scanning ? 'סורק...' : 'אסוף ביקורות'}
          </button>
          {/* Secondary: More menu */}
          <div className="relative" ref={moreMenuRef}>
            <button
              onClick={() => setMoreMenuOpen(v => !v)}
              className="btn-subtle flex items-center gap-1 px-3 py-2.5 rounded-lg text-[12px] font-medium border border-border text-foreground hover:bg-secondary transition-all"
              title="פעולות נוספות"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {moreMenuOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-lg py-1 min-w-[200px]">
                <button
                  onClick={handleSendRequests}
                  disabled={sendingRequests}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  {sendingRequests ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  שלח בקשות ביקורת
                </button>
                <button
                  onClick={() => { setMoreMenuOpen(false); setShowRequestModal(true); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground hover:bg-secondary transition-colors"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  בקש ביקורת מלקוח
                </button>
                <button
                  onClick={() => { setMoreMenuOpen(false); handleAnalyzeSentiment(); }}
                  disabled={analyzingSentiment}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  {analyzingSentiment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart2 className="w-3.5 h-3.5" />}
                  {analyzingSentiment ? 'מנתח...' : 'ניתוח סנטימנט'}
                </button>
              </div>
            )}
          </div>
          {/* Primary: Add Review */}
          <button onClick={() => setShowAddModal(true)} className="btn-subtle flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium bg-foreground text-background hover:opacity-90 transition-all">
            <Plus className="w-4 h-4" /> הוסף ביקורת
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {statCards.map((card, i) => (
          <div key={card.label} className={`card-base p-5 fade-in-up stagger-${i + 1}`}>
            <p className="text-[11px] font-medium text-foreground-muted mb-1">{card.label}</p>
            <span className={`text-[28px] font-bold leading-none tracking-tight ${card.color || 'text-foreground'}`}>{card.value}</span>
          </div>
        ))}
      </div>

      {/* Review timing recommendation */}
      {reviewTimingSignal && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-teal-50 border border-teal-200">
          <MessageCircle className="w-4 h-4 text-teal-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-teal-800">המלצת תזמון לבקשות ביקורת</p>
            <p className="text-[11px] text-teal-700 mt-0.5 line-clamp-2">{reviewTimingSignal.recommended_action || reviewTimingSignal.summary}</p>
          </div>
        </div>
      )}

      {/* Real-time negative review alerts */}
      {visibleAlerts.length > 0 && (
        <div className="space-y-2">
          {visibleAlerts.map(alert => (
            <div key={alert.id} className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-red-800">{alert.title}</p>
                {alert.description && (
                  <p className="text-[11px] text-red-700 mt-0.5 line-clamp-2">{alert.description}</p>
                )}
              </div>
              <button
                onClick={() => dismissAlert(alert.id)}
                className="text-red-400 hover:text-red-600 flex-shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Rating trend chart */}
      {reviews.length >= 3 && <RatingTrendChart reviews={reviews} />}

      {/* FIX 7: Sentiment analysis result */}
      {sentimentResult && (
        <div className="card-base p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-foreground">ניתוח סנטימנט</h3>
            <span className="text-[10px] text-foreground-muted">{sentimentResult.sample_size} ביקורות</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-center">
              <span className="text-[28px] font-bold text-foreground leading-none">{sentimentResult.score}</span>
              <span className="text-[9px] text-foreground-muted">מתוך 100</span>
            </div>
            <div className="flex gap-3 text-[11px]">
              <span className="text-emerald-600 font-medium">👍 {sentimentResult.positive_count} חיובי</span>
              <span className="text-red-600 font-medium">👎 {sentimentResult.negative_count} שלילי</span>
              <span className="text-foreground-muted">😐 {sentimentResult.neutral_count} ניטרלי</span>
            </div>
          </div>
          {sentimentResult.key_insight && (
            <p className="text-[12px] text-foreground-secondary bg-secondary rounded-lg px-3 py-2">
              💡 {sentimentResult.key_insight}
            </p>
          )}
          {sentimentResult.top_themes?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {sentimentResult.top_themes.map((t, i) => (
                <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full border ${
                  t.sentiment === 'positive' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'
                }`}>
                  {t.theme} ({t.count})
                </span>
              ))}
            </div>
          )}
          {sentimentResult.recommendations?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-foreground-muted mb-1">המלצות:</p>
              <ul className="space-y-0.5">
                {sentimentResult.recommendations.map((r, i) => (
                  <li key={i} className="text-[11px] text-foreground-secondary flex items-start gap-1.5">
                    <span className="text-primary mt-0.5">→</span> {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button onClick={() => setSentimentResult(null)} className="text-[10px] text-foreground-muted hover:text-foreground transition-colors">
            סגור ←
          </button>
        </div>
      )}

      <AiInsightBox
        title="ניתוח סנטימנט ונושאים חוזרים"
        prompt={`אתה מנתח מוניטין דיגיטלי. העסק "${businessProfile?.name}" (${businessProfile?.category}) עם ${reviews.length} ביקורות, דירוג ממוצע ${Number(avgRating).toFixed(1)}, ${pendingCount} ממתינות לתגובה.
ביקורות אחרונות: ${reviews.slice(0, 15).map(r => `[${r.sentiment}/${r.rating}⭐] "${(r.text || '').slice(0, 80)}"`).join('; ')}.
סכם את הנושאים החוזרים (חיובי/שלילי), זהה נקודות חוזק וחולשה, והמלץ 3 פעולות לשיפור המוניטין. בעברית, Markdown.`}
      />

      {/* Source selector */}
      <div className="card-base px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium text-foreground-muted">מקורות סריקה:</span>
          {[
            { key: 'google',      label: 'Google',      icon: '📍' },
            { key: 'facebook',    label: 'Facebook',    icon: '📘' },
            { key: 'instagram',   label: 'Instagram',   icon: '📸' },
            { key: 'tripadvisor', label: 'TripAdvisor', icon: '🦉' },
            { key: 'waze',        label: 'Waze',        icon: '🗺️' },
            { key: 'tiktok',      label: 'TikTok',      icon: '🎵' },
            { key: 'wolt',        label: 'Wolt',        icon: '🛵' },
            { key: '10bis',       label: '10BIS',       icon: '🍽️' },
            { key: 'easy',        label: 'easy.co.il',  icon: '🔍' },
            { key: 'booking',     label: 'Booking',     icon: '🏨' },
            { key: 'forums',      label: 'פורומים',     icon: '💬' },
          ].map(src => {
            const active = selectedSources.includes(src.key);
            return (
              <button key={src.key}
                onClick={() => setSelectedSources(prev =>
                  active ? prev.filter(s => s !== src.key) : [...prev, src.key]
                )}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium border transition-all ${
                  active
                    ? 'bg-primary text-background border-primary'
                    : 'bg-white text-foreground-muted border-border hover:border-foreground-muted'
                }`}
              >
                {src.icon} {src.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-[14px] font-semibold text-foreground">
            ביקורות ({filteredReviews.length}{filteredReviews.length !== reviews.length ? `/${reviews.length}` : ''})
          </h2>
          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { key: 'all', label: 'הכל' },
              { key: 'negative', label: 'שליליות', cls: 'text-red-600' },
              { key: 'neutral', label: 'ניטרלי', cls: 'text-amber-600' },
              { key: 'positive', label: 'חיוביות', cls: 'text-emerald-600' },
            ].map(f => (
              <button key={f.key} onClick={() => setFilterSentiment(f.key)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition-all ${
                  filterSentiment === f.key
                    ? 'bg-foreground text-background border-foreground'
                    : `bg-white border-border ${f.cls || 'text-foreground-muted'} hover:border-foreground-muted`
                }`}>
                {f.label}
              </button>
            ))}
            <div className="w-px h-4 bg-border mx-1" />
            {[
              { key: 'all', label: 'כולן' },
              { key: 'pending', label: 'ממתינות' },
              { key: 'responded', label: 'נענו' },
            ].map(f => (
              <button key={f.key} onClick={() => setFilterStatus(f.key)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition-all ${
                  filterStatus === f.key
                    ? 'bg-foreground text-background border-foreground'
                    : 'bg-white border-border text-foreground-muted hover:border-foreground-muted'
                }`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {reviews.length === 0 ? (
          <EmptyState
            icon={Star}
            title="לא נמצאו ביקורות עדיין"
            description="הסוכן יאסוף ביקורות בריצה הבאה. ניתן גם להוסיף ידנית."
            action={() => setShowAddModal(true)}
            actionLabel="+ הוסף ביקורת ראשונה"
          />
        ) : filteredReviews.length === 0 ? (
          <div className="card-base py-10 text-center">
            <p className="text-[12px] text-foreground-muted">אין ביקורות התואמות את הסינון</p>
          </div>
        ) : (() => {
          // Group reviews by date
          const today = new Date();
          const todayStr = today.toISOString().split('T')[0];
          const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = yesterday.toISOString().split('T')[0];
          const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
          const monthAgo = new Date(today); monthAgo.setDate(monthAgo.getDate() - 30);

          const groups = { 'היום': [], 'אתמול': [], 'השבוע': [], 'החודש': [], 'ישן יותר': [] };
          filteredReviews.forEach(r => {
            const d = new Date(r.created_at || r.created_date || '2000-01-01');
            if (isNaN(d.getTime())) { groups['ישן יותר'].push(r); return; }
            const ds = d.toISOString().split('T')[0];
            if (ds === todayStr) groups['היום'].push(r);
            else if (ds === yesterdayStr) groups['אתמול'].push(r);
            else if (d >= weekAgo) groups['השבוע'].push(r);
            else if (d >= monthAgo) groups['החודש'].push(r);
            else groups['ישן יותר'].push(r);
          });

          return (
            <div className="space-y-4">
              {Object.entries(groups).filter(([,items]) => items.length > 0).map(([label, items]) => (
                <div key={label}>
                  <h3 className="text-[11px] font-semibold text-foreground-muted mb-2 px-1">{label} ({items.length})</h3>
                  <div className="space-y-2">{items.map(review => <ReviewCard key={review.id} review={review} businessProfile={businessProfile} />)}</div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {historicalReviews.length > 0 && (
        <div>
          <button onClick={() => setShowHistorical(v => !v)}
            className="flex items-center gap-2 text-[12px] font-medium text-foreground-muted hover:text-foreground transition-colors mb-2">
            <Star className="w-3.5 h-3.5" />
            ביקורות היסטוריות ({historicalReviews.length}) {showHistorical ? '▲' : '▼'}
          </button>
          {showHistorical && (
            <div className="space-y-2 opacity-70">
              {historicalReviews.map(review => (
                <ReviewCard key={review.id} review={review} businessProfile={businessProfile} />
              ))}
            </div>
          )}
        </div>
      )}

      <ScheduledReviewRequests bpId={bpId} />

      {showAddModal && <AddReviewModal bpId={bpId} onClose={() => setShowAddModal(false)} onAdded={() => { queryClient.invalidateQueries({ queryKey: ['reviewsPage'] }); setShowAddModal(false); }} />}
      {showRequestModal && <RequestReviewModal businessProfile={businessProfile} onClose={() => setShowRequestModal(false)} onSent={() => { queryClient.invalidateQueries({ queryKey: ['reviewRequests'] }); setShowRequestModal(false); }} />}
    </div>
  );
}