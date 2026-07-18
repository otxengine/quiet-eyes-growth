import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';

const TREND_ICON = {
  improving: <TrendingUp  className="w-3.5 h-3.5 text-success inline-block" />,
  declining: <TrendingDown className="w-3.5 h-3.5 text-danger  inline-block" />,
  stable:    <Minus        className="w-3.5 h-3.5 text-foreground-muted inline-block" />,
};

function ReviewSnippet({ review }) {
  const stars = Math.round(review.rating ?? 0);
  const date = (() => {
    const d = new Date(review.created_date);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
  })();
  return (
    <div dir="rtl" className="bg-gray-50 rounded-lg px-3 py-2 space-y-0.5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-foreground truncate flex-1">{review.reviewer_name || 'לקוח'}</span>
        <span className="text-amber-400 text-[10px] flex-shrink-0">{'★'.repeat(stars)}{'☆'.repeat(5 - stars)}</span>
        {date && <span className="text-[10px] text-foreground-muted flex-shrink-0">{date}</span>}
      </div>
      {review.text && (
        <p className="text-[11px] text-foreground-secondary leading-relaxed line-clamp-2">{review.text}</p>
      )}
    </div>
  );
}

export default function CompetitorReviewInsightsPanel({ competitor, businessProfileId }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded]   = useState(false);

  const load = async () => {
    if (loaded) return;
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getCompetitorReviewInsights', {
        competitorId: competitor.id,
        businessProfileId,
      });
      setData(res?.data ?? res);
    } catch { /* show nothing on error */ }
    setLoading(false);
    setLoaded(true);
  };

  // Lazy-load on mount
  React.useEffect(() => { load(); }, []);

  if (!loaded && loading) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-foreground-muted py-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        טוען תובנות ביקורות...
      </div>
    );
  }

  if (!data) return null;

  const { rating, review_count, own_rating, rating_delta, top_positive_themes = [], top_negative_themes = [], trend, hebrew_summary, latest_reviews = [] } = data;

  const deltaColor = rating_delta == null ? '' : rating_delta > 0 ? 'text-red-500' : 'text-green-600';
  const deltaLabel = rating_delta == null ? null : `${rating_delta > 0 ? '+' : ''}${rating_delta} ממך`;

  return (
    <div className="rounded-xl border border-border bg-secondary/40 p-4 space-y-3">
      <p className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide">
        תובנות ביקורות Google — {competitor.name}
      </p>

      {/* Rating + own comparison + trend */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[22px] font-bold text-foreground leading-none">
          {rating != null ? Number(rating).toFixed(1) : '—'}
        </span>
        {own_rating != null && (
          <span className="text-[11px] text-foreground-muted">vs {own_rating.toFixed(1)} שלך</span>
        )}
        {deltaLabel && (
          <span className={`text-[12px] font-semibold ${deltaColor}`}>{deltaLabel}</span>
        )}
        <span className="text-[11px] text-foreground-muted">{review_count ? `${review_count} ביקורות` : ''}</span>
        {trend && (
          <span className="flex items-center gap-1 text-[11px] text-foreground-secondary">
            {TREND_ICON[trend]} {trend === 'improving' ? 'משתפר' : trend === 'declining' ? 'יורד' : 'יציב'}
          </span>
        )}
      </div>

      {/* Positive themes */}
      {top_positive_themes.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-success mb-1">בולטים לטובה</p>
          <div className="flex flex-wrap gap-1.5">
            {top_positive_themes.map((t, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full text-[10px] bg-green-50 border border-green-200 text-green-700">{t}</span>
            ))}
          </div>
        </div>
      )}

      {/* Negative themes */}
      {top_negative_themes.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-danger mb-1">תלונות נפוצות</p>
          <div className="flex flex-wrap gap-1.5">
            {top_negative_themes.map((t, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full text-[10px] bg-red-50 border border-red-200 text-red-700">{t}</span>
            ))}
          </div>
        </div>
      )}

      {/* Hebrew summary */}
      {hebrew_summary && (
        <p className="text-[11px] text-foreground-secondary leading-relaxed border-t border-border pt-3">
          {hebrew_summary}
        </p>
      )}

      {/* Latest reviews */}
      {latest_reviews.length > 0 && (
        <div className="border-t border-border pt-3 space-y-1.5">
          <p className="text-[10px] font-semibold text-foreground-muted mb-2">ביקורות אחרונות 🕐</p>
          {latest_reviews.map((r, i) => <ReviewSnippet key={i} review={r} />)}
        </div>
      )}

      {/* AC3: no reply/publish actions rendered here */}
    </div>
  );
}
