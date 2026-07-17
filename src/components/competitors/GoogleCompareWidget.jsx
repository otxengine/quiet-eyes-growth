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
  if (!top.length) return <span className="text-[10px] text-foreground-muted opacity-50">אין נתוני נושאים</span>;
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

function Row({ name, rating, reviewCount, aspects, isOwn }) {
  return (
    <div dir="rtl" className={`flex items-start gap-4 px-4 py-3 border-b border-border/40 last:border-0 ${isOwn ? 'bg-blue-50/30' : ''}`}>
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
      <div className="flex-1 pt-0.5">
        <AspectChips aspects={aspects} />
      </div>
    </div>
  );
}

export default function GoogleCompareWidget({ businessProfileId, businessName }) {
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

  const { own, competitors = [] } = data;
  if (!own && !competitors.length) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div dir="rtl" className="px-4 py-3 border-b border-gray-100 bg-gray-50/60 flex items-center gap-2">
        <span className="text-[13px] font-semibold text-foreground">השוואת דירוג Google</span>
        <span className="text-[11px] text-foreground-muted">— Google בלבד</span>
      </div>
      <div dir="rtl" className="flex items-center gap-4 px-4 py-1.5 border-b border-border/30 text-[9px] font-semibold text-foreground-muted uppercase tracking-wide">
        <span className="w-24 flex-shrink-0">עסק</span>
        <span className="w-20 flex-shrink-0 text-center">דירוג Google</span>
        <span className="w-16 flex-shrink-0 text-center">ביקורות</span>
        <span className="flex-1">נושאים מובילים</span>
      </div>
      {own && (
        <Row
          name={businessName || 'העסק שלי'}
          rating={own.google_rating}
          reviewCount={own.review_count}
          aspects={own.aspects}
          isOwn
        />
      )}
      {competitors.map(c => (
        <Row
          key={c.id}
          name={c.name}
          rating={c.rating}
          reviewCount={c.review_count}
          aspects={c.aspects}
          isOwn={false}
        />
      ))}
    </div>
  );
}
