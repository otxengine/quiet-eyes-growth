import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3007/api').replace(/\/$/, '');

const CHIP = {
  positive: 'bg-green-100 text-green-700',
  negative: 'bg-red-100 text-red-600',
  neutral:  'bg-amber-100 text-amber-600',
};
const PREFIX = { positive: '+', negative: '−', neutral: '' };

function dominant(a) {
  if (a.positive > a.negative && a.positive > a.neutral) return 'positive';
  if (a.negative > a.positive) return 'negative';
  return 'neutral';
}

function AspectChips({ aspects }) {
  const top = (aspects || []).slice(0, 4);
  if (!top.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {top.map(a => {
        const pol = dominant(a);
        return (
          <span key={a.theme} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${CHIP[pol]}`}>
            {PREFIX[pol]}{a.theme}
          </span>
        );
      })}
    </div>
  );
}

function Row({ name, rating, reviewCount, delta, isOwn }) {
  return (
    <div dir="rtl" className={`flex items-center gap-4 px-4 py-3 border-b border-border/40 last:border-0 ${isOwn ? 'bg-blue-50/30' : ''}`}>
      <div className="w-24 flex-shrink-0">
        <p className="text-[12px] font-semibold text-foreground truncate">{name}</p>
        {isOwn && <p className="text-[9px] text-blue-500 font-medium mt-0.5">העסק שלי</p>}
      </div>
      <div className="w-20 flex-shrink-0 text-center">
        <p className={`text-[20px] font-bold leading-none ${isOwn ? 'text-blue-600' : 'text-foreground-secondary'}`}>
          {rating != null ? Number(rating).toFixed(1) : '—'}
        </p>
        <p className="text-[9px] text-foreground-muted mt-0.5">דירוג Google</p>
      </div>
      <div className="w-16 flex-shrink-0 text-center">
        <p className="text-[12px] font-medium text-foreground">{reviewCount ?? '—'}</p>
        <p className="text-[9px] text-foreground-muted">ביקורות</p>
      </div>
      <div className="w-16 flex-shrink-0 text-center">
        {isOwn ? (
          <span className="text-[10px] text-foreground-muted">בסיס</span>
        ) : delta != null ? (
          <span className={`text-[13px] font-semibold ${delta <= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}
          </span>
        ) : (
          <span className="text-[12px] text-foreground-muted">—</span>
        )}
      </div>
    </div>
  );
}

// ponytail: client-side aggregate avoids a second API call; BE already returns per-competitor rating+count
function weightedAgg(list) {
  let sw = 0, sr = 0;
  for (const c of list) {
    if (c.rating == null || !c.review_count) continue;
    sw += Number(c.rating) * c.review_count;
    sr += c.review_count;
  }
  if (!sr) return null;
  return { rating: sw / sr, total_reviews: sr, low_confidence: sr < 50 };
}

export default function GoogleCompareWidget({ businessProfileId, businessName }) {
  const [mode, setMode] = useState('market'); // 'market' | 'selected'
  const [selectedIds, setSelectedIds] = useState([]); // [] = all selected

  const { data, isLoading, isError } = useQuery({
    queryKey: ['googleCompare', businessProfileId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/functions/compareGoogleMetrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessProfileId }),
      });
      if (!res.ok) throw new Error('compare failed');
      return res.json();
    },
    enabled: !!businessProfileId,
    staleTime: 1000 * 60 * 5,
  });

  if (isLoading) return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 flex items-center justify-center">
      <Loader2 className="w-5 h-5 animate-spin text-foreground-muted" />
    </div>
  );

  if (isError || !data) return null;

  const { own, competitors = [], market: beMarket } = data;
  if (!own && !competitors.length) return null;

  const ownRating = own?.google_rating != null ? Number(own.google_rating) : null;

  // In selected mode, filter to checked subset (empty selectedIds = all)
  const subset = mode === 'selected' && selectedIds.length
    ? competitors.filter(c => selectedIds.includes(c.id))
    : competitors;

  const market = mode === 'market' ? beMarket : weightedAgg(subset);
  const marketDelta = ownRating != null && market != null ? ownRating - market.rating : null;

  function toggleId(id) {
    setSelectedIds(prev => {
      // first uncheck seeds from all competitors, then removes the target
      const base = prev.length ? prev : competitors.map(c => c.id);
      return base.includes(id) ? base.filter(x => x !== id) : [...base, id];
    });
  }

  function ModeBtn({ m, label }) {
    return (
      <button
        onClick={() => setMode(m)}
        className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${
          mode === m ? 'bg-blue-100 text-blue-700' : 'text-foreground-muted hover:text-foreground'
        }`}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header + mode toggle */}
      <div dir="rtl" className="px-4 py-3 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-foreground">השוואת דירוג Google</span>
          <span className="text-[11px] text-foreground-muted">— Google בלבד</span>
        </div>
        <div className="flex items-center gap-1">
          <ModeBtn m="market" label="שוק כולל" />
          <ModeBtn m="selected" label="מתחרים נבחרים" />
        </div>
      </div>

      {/* Competitor picker (selected mode only) */}
      {mode === 'selected' && competitors.length > 0 && (
        <div dir="rtl" className="px-4 py-2 border-b border-border/30 flex flex-wrap gap-x-3 gap-y-1.5 bg-gray-50/40">
          {competitors.map(c => {
            const checked = !selectedIds.length || selectedIds.includes(c.id);
            return (
              <label key={c.id} className="flex items-center gap-1 text-[11px] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleId(c.id)}
                  className="accent-blue-600"
                />
                <span className={checked ? 'text-foreground' : 'text-foreground-muted line-through'}>{c.name}</span>
              </label>
            );
          })}
        </div>
      )}

      {/* Column headers */}
      <div dir="rtl" className="flex items-center gap-4 px-4 py-1.5 border-b border-border/30 text-[9px] font-semibold text-foreground-muted uppercase tracking-wide">
        <span className="w-24 flex-shrink-0">עסק</span>
        <span className="w-20 flex-shrink-0 text-center">דירוג Google</span>
        <span className="w-16 flex-shrink-0 text-center">ביקורות</span>
        <span className="w-16 flex-shrink-0 text-center">פער</span>
      </div>

      {/* Own row */}
      {own && (
        <>
          <Row
            name={businessName || 'העסק שלי'}
            rating={own.google_rating}
            reviewCount={own.review_count}
            delta={null}
            isOwn
          />
          {own.aspects?.length > 0 && (
            <div dir="rtl" className="px-4 pb-3 border-b border-border/40 bg-blue-50/30">
              <p className="text-[9px] font-semibold text-foreground-muted mb-1.5">הנושאים שלי</p>
              <AspectChips aspects={own.aspects} />
            </div>
          )}
        </>
      )}

      {/* Weighted aggregate row (own vs market/subset) */}
      {market && (
        <div dir="rtl" className="flex items-center gap-4 px-4 py-3 border-b border-border/40 bg-amber-50/30">
          <div className="w-24 flex-shrink-0">
            <p className="text-[12px] font-semibold text-foreground">
              {mode === 'selected' ? 'ממוצע נבחרים' : 'ממוצע שוק'}
            </p>
            <p className="text-[9px] text-amber-600 font-medium mt-0.5">משוקלל לפי ביקורות</p>
            {market.low_confidence && (
              <p className="text-[9px] text-amber-500 mt-0.5">⚠ נפח נמוך</p>
            )}
          </div>
          <div className="w-20 flex-shrink-0 text-center">
            <p className="text-[20px] font-bold leading-none text-amber-700">
              {market.rating.toFixed(1)}
            </p>
            <p className="text-[9px] text-foreground-muted mt-0.5">דירוג Google</p>
          </div>
          <div className="w-16 flex-shrink-0 text-center">
            <p className="text-[12px] font-medium text-foreground">
              {market.total_reviews.toLocaleString()}
            </p>
            <p className="text-[9px] text-foreground-muted">ביקורות</p>
          </div>
          <div className="w-16 flex-shrink-0 text-center">
            {marketDelta != null ? (
              <span className={`text-[13px] font-semibold ${marketDelta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {marketDelta >= 0 ? `+${marketDelta.toFixed(1)}` : marketDelta.toFixed(1)}
              </span>
            ) : (
              <span className="text-[12px] text-foreground-muted">—</span>
            )}
          </div>
        </div>
      )}

      {/* Individual competitor rows */}
      {subset.map(c => {
        const delta = ownRating != null && c.rating != null ? Number(c.rating) - ownRating : null;
        return (
          <Row
            key={c.id}
            name={c.name}
            rating={c.rating}
            reviewCount={c.review_count}
            delta={delta}
            isOwn={false}
          />
        );
      })}
    </div>
  );
}
