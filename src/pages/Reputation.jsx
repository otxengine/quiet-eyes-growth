import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Star, Plus, Search, Loader2, MessageCircle, BarChart2 } from 'lucide-react';
import { toast } from 'sonner';
import ReviewCard from '@/components/reputation/ReviewCard';
import AddReviewModal from '@/components/reputation/AddReviewModal';
import RequestReviewModal from '@/components/reputation/RequestReviewModal';
import AiInsightBox from '@/components/ai/AiInsightBox';
import ScheduledReviewRequests from '@/components/reputation/ScheduledReviewRequests';

export default function Reputation() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [analyzingSentiment, setAnalyzingSentiment] = useState(false);
  const [sentimentResult, setSentimentResult] = useState(null);

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
      const res = await base44.functions.invoke('scanAllReviews', { businessProfileId: bpId });
      const { new_reviews = 0, google_reviews_added = 0 } = res.data || {};
      if (new_reviews > 0) {
        toast.success(`נמצאו ${new_reviews} ביקורות חדשות${google_reviews_added > 0 ? ` (${google_reviews_added} מגוגל)` : ''}`);
      } else {
        toast.info('לא נמצאו ביקורות חדשות');
      }
      queryClient.invalidateQueries({ queryKey: ['reviewsPage'] });
    } catch (err) {
      toast.error('שגיאה באיסוף ביקורות');
    }
    setScanning(false);
  };

  useEffect(() => {
    window.__quieteyes_scan = handleCollectReviews;
    return () => { delete window.__quieteyes_scan; };
  }, [bpId]);

  const { data: allReviewsRaw = [] } = useQuery({
    queryKey: ['reviewsPage', bpId],
    queryFn: () => base44.entities.Review.filter({ linked_business: bpId }, '-created_date', 200),
    enabled: !!bpId
  });

  const reviews = allReviewsRaw.filter(r => !r.is_historical);
  const historicalReviews = allReviewsRaw.filter(r => r.is_historical);
  const [showHistorical, setShowHistorical] = useState(false);

  const { data: reviewRequests = [] } = useQuery({
    queryKey: ['reviewRequests', bpId],
    queryFn: () => base44.entities.ReviewRequest.filter({ linked_business: bpId }, '-created_date', 100),
    enabled: !!bpId
  });
  const monthStartForReqs = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const requestsThisMonth = reviewRequests.filter(r => (r.sent_at || r.created_date) >= monthStartForReqs).length;

  const avgRating = reviews.length > 0 ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length) : 0;
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

  const statCards = [
    { label: 'ציון ממוצע', value: avgRating > 0 ? avgRating.toFixed(1) : '—' },
    { label: 'ביקורות החודש', value: thisMonthReviews.length },
    { label: 'ממתינות לתגובה', value: pendingCount },
    { label: 'מאומתות', value: `${verifiedCount}/${reviews.length}` },
    { label: 'בקשות ביקורת החודש', value: requestsThisMonth },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-[16px] font-bold text-foreground tracking-tight">מוניטין</h1>
        <div className="flex items-center gap-2">
          <button onClick={handleAnalyzeSentiment} disabled={analyzingSentiment}
            className="btn-subtle flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium border border-border text-foreground hover:bg-secondary transition-all disabled:opacity-50">
            {analyzingSentiment ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart2 className="w-4 h-4" />}
            {analyzingSentiment ? 'מנתח...' : 'נתח סנטימנט'}
          </button>
          <button onClick={handleCollectReviews} disabled={scanning}
            className="btn-subtle flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium border border-border text-foreground hover:bg-secondary transition-all disabled:opacity-50">
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {scanning ? 'סורק ביקורות...' : 'אסוף ביקורות מהרשת'}
          </button>
          <button onClick={() => setShowRequestModal(true)} className="btn-subtle flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium border border-border text-foreground hover:bg-secondary transition-all">
            <MessageCircle className="w-4 h-4" /> בקש ביקורת מלקוח
          </button>
          <button onClick={() => setShowAddModal(true)} className="btn-subtle flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium bg-foreground text-background hover:opacity-90 transition-all">
            <Plus className="w-4 h-4" /> הוסף ביקורת
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {statCards.map((card, i) => (
          <div key={card.label} className={`card-base p-5 fade-in-up stagger-${i + 1}`}>
            <p className="text-[11px] font-medium text-foreground-muted mb-1">{card.label}</p>
            <span className="text-[28px] font-bold text-foreground leading-none tracking-tight">{card.value}</span>
          </div>
        ))}
      </div>

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
        prompt={`אתה מנתח מוניטין דיגיטלי. העסק "${businessProfile?.name}" (${businessProfile?.category}) עם ${reviews.length} ביקורות, דירוג ממוצע ${avgRating.toFixed(1)}, ${pendingCount} ממתינות לתגובה.
ביקורות אחרונות: ${reviews.slice(0, 15).map(r => `[${r.sentiment}/${r.rating}⭐] "${(r.text || '').slice(0, 80)}"`).join('; ')}.
סכם את הנושאים החוזרים (חיובי/שלילי), זהה נקודות חוזק וחולשה, והמלץ 3 פעולות לשיפור המוניטין. בעברית, Markdown.`}
      />

      <div>
        <h2 className="text-[14px] font-semibold text-foreground mb-3">ביקורות ({reviews.length})</h2>
        {reviews.length === 0 ? (
          <div className="card-base py-20 text-center">
            <Star className="w-12 h-12 text-foreground-muted opacity-20 mx-auto mb-3" />
            <p className="text-[13px] text-foreground-muted mb-1">לא נמצאו ביקורות עדיין — הסוכן יאסוף ביקורות בריצה הבאה</p>
            <p className="text-[11px] text-foreground-muted opacity-50 mb-4">ניתן גם לאסוף ידנית או להוסיף ביקורת</p>
            <button onClick={() => setShowAddModal(true)} className="btn-subtle px-5 py-2.5 rounded-lg text-[12px] font-medium bg-foreground text-background hover:opacity-90 transition-all">+ הוסף ביקורת ראשונה</button>
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
          sortedReviews.forEach(r => {
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