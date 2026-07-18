import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, TrendingUp } from 'lucide-react';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3007/api').replace(/\/$/, '');

const TOPIC_HE = {
  service: 'שירות', price: 'מחיר', quality: 'איכות', cleanliness: 'ניקיון',
  atmosphere: 'אווירה', availability: 'זמינות', delivery: 'משלוח',
  food_quality: 'איכות המזון', menu_variety: 'מגוון תפריט', wait_time: 'זמן המתנה',
  portion_size: 'גודל מנה', freshness: 'טריות', results: 'תוצאות',
  technique: 'טכניקה', appointment_availability: 'זמינות תורים',
  product_quality: 'איכות מוצרים', expertise: 'מקצועיות',
  trainers: 'מאמנים', equipment: 'ציוד', class_variety: 'מגוון שיעורים',
  schedule_flexibility: 'גמישות לוח זמנים', doctor_expertise: 'מקצועיות רופא',
  medical_wait_time: 'זמן המתנה', diagnosis_quality: 'איכות אבחון',
  staff_attitude: 'יחס הצוות', appointment_ease: 'נוחות קביעת תור',
  legal_expertise: 'מקצועיות', response_time: 'זמן תגובה', communication: 'תקשורת',
  value_for_money: 'תמורה לכסף', outcome: 'תוצאה', product_variety: 'מגוון מוצרים',
  staff_helpfulness: 'סיוע הצוות', stock_availability: 'זמינות מלאי',
  return_policy: 'מדיניות החזרות', repair_quality: 'איכות תיקון',
  diagnosis_accuracy: 'דיוק אבחון', auto_wait_time: 'זמן המתנה',
  price_transparency: 'שקיפות במחיר', warranty: 'אחריות על עבודה',
};
const th = id => TOPIC_HE[id] || id;

function ratio(pos, neg) {
  const total = pos + neg;
  return total === 0 ? null : Math.round((pos / total) * 100);
}

function topicTotal(series) {
  return (series.buckets ?? []).reduce((s, b) => s + b.positive + b.negative, 0);
}

function ratingColor(r) {
  if (r == null) return 'text-gray-300';
  if (r >= 65) return 'text-green-600';
  if (r <= 40) return 'text-red-500';
  return 'text-amber-500';
}

// "2025-Q2" → "Q2 '25"
function periodLabel(p) {
  const [year, q] = p.split('-');
  return `${q} '${year.slice(2)}`;
}

export default function TopicTimelineWidget({ businessProfileId, businessName }) {
  const [showComp, setShowComp] = useState(null);

  const storedSet = (() => {
    if (!businessProfileId) return null;
    try { return JSON.parse(localStorage.getItem(`compare-set-${businessProfileId}`) ?? 'null'); } catch { return null; }
  })();

  const { data, isLoading } = useQuery({
    queryKey: ['topicTimeline', businessProfileId],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/functions/topicTimeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessProfileId }),
      });
      if (!r.ok) throw new Error('topicTimeline failed');
      return r.json();
    },
    enabled: !!businessProfileId,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 flex justify-center">
      <Loader2 className="w-5 h-5 animate-spin text-foreground-muted" />
    </div>
  );

  if (!data?.own?.length) return null;

  const { own, competitors: rawComps = [] } = data;
  const competitors = storedSet ? rawComps.filter(c => storedSet.includes(c.id)) : rawComps;
  const sorted = [...own].sort((a, b) => topicTotal(b) - topicTotal(a));

  const compEntry = showComp ? competitors.find(c => c.id === showComp) : null;

  // When competitor with data is selected, only show common topics
  const compTopicIds = new Set((compEntry?.series ?? []).map(s => s.topic_id));
  const visibleOwn = showComp && compTopicIds.size > 0
    ? sorted.filter(s => compTopicIds.has(s.topic_id))
    : sorted;

  // All periods from own data, last 6 quarters
  const allPeriods = [...new Set(own.flatMap(s => s.buckets.map(b => b.period)))].sort().slice(-6);

  // Build competitor lookup: topic_id → period → bucket
  const compLookup = {};
  if (compEntry?.series) {
    for (const s of compEntry.series) {
      compLookup[s.topic_id] = {};
      for (const b of s.buckets) compLookup[s.topic_id][b.period] = b;
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-blue-500" />
        <h3 className="text-sm font-semibold text-foreground">נושאים לפי רבעון — Google</h3>
        <span className="text-[10px] text-foreground-muted mr-auto">% חיובי • ×ביקורות</span>
      </div>

      {/* Competitor toggle */}
      {competitors.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] text-foreground-muted">השווה מול:</span>
          <button
            onClick={() => setShowComp(null)}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              !showComp ? 'bg-gray-200 text-gray-700 border-gray-300' : 'border-border text-foreground-muted hover:border-gray-400'
            }`}
          >
            ללא השוואה
          </button>
          {competitors.slice(0, 4).map(c => (
            <button
              key={c.id}
              onClick={() => setShowComp(c.id === showComp ? null : c.id)}
              className={`text-[10px] px-2 py-0.5 rounded-full border truncate max-w-[130px] transition-colors ${
                showComp === c.id
                  ? 'bg-purple-100 text-purple-700 border-purple-300'
                  : 'border-border text-foreground-muted hover:border-purple-300'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {showComp && compEntry && !compEntry.series?.length && (
        <p className="text-[11px] text-foreground-muted bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          אין נתוני נושאים עדיין למתחרה זה
        </p>
      )}

      {/* Legend when competitor selected */}
      {compEntry && compEntry.series?.length > 0 && (
        <div className="flex gap-3 text-[10px]">
          <span className="flex items-center gap-1 text-blue-600">
            <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" />
            {businessName ?? 'העסק שלי'}
          </span>
          <span className="flex items-center gap-1 text-purple-600">
            <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />
            {compEntry.name}
          </span>
        </div>
      )}

      {/* Comparison table */}
      <div className="overflow-x-auto">
        <table className="w-full text-right border-collapse">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-[10px] font-semibold text-foreground-muted py-1.5 pr-0 pl-3 text-right w-24">נושא</th>
              {allPeriods.map(p => (
                <th key={p} className="text-[10px] font-semibold text-foreground-muted py-1.5 px-2 text-center whitespace-nowrap">
                  {periodLabel(p)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleOwn.map((s, idx) => {
              const ownBucketMap = Object.fromEntries(s.buckets.map(b => [b.period, b]));
              return (
                <tr key={s.topic_id} className={idx % 2 === 0 ? 'bg-gray-50/50' : ''}>
                  <td className="text-[11px] font-medium text-foreground py-2 pr-0 pl-2 whitespace-nowrap">
                    {th(s.topic_id)}
                  </td>
                  {allPeriods.map(p => {
                    const ob = ownBucketMap[p];
                    const cb = compLookup[s.topic_id]?.[p];
                    const ownTotal = ob ? ob.positive + ob.negative : 0;
                    const compTotal = cb ? cb.positive + cb.negative : 0;
                    const ownR = ob ? ratio(ob.positive, ob.negative) : null;
                    const compR = cb ? ratio(cb.positive, cb.negative) : null;

                    if (ownTotal === 0 && (!compEntry || compTotal === 0)) {
                      return <td key={p} className="py-2 px-2 text-center text-[10px] text-gray-200">—</td>;
                    }

                    return (
                      <td key={p} className="py-2 px-2 text-center">
                        {ownTotal > 0 && (
                          <div className={`text-[11px] font-semibold leading-tight ${ratingColor(ownR)}`}>
                            {ownR != null ? `${ownR}%` : '—'}
                            <span className="text-[9px] font-normal text-gray-400"> ×{ownTotal}</span>
                          </div>
                        )}
                        {compEntry && compTotal > 0 && (
                          <div className={`text-[10px] leading-tight mt-0.5 ${ratingColor(compR)} opacity-80`}>
                            {compR != null ? `${compR}%` : '—'}
                            <span className="text-[9px] text-gray-400"> ×{compTotal}</span>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
