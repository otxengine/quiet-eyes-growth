import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, TrendingUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

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

function buildChartData(ownSeries, compSeries) {
  return (ownSeries?.buckets ?? []).map(b => {
    const row = { period: b.period.slice(5), own: ratio(b.positive, b.negative) };
    if (compSeries) {
      const cb = compSeries.buckets?.find(x => x.period === b.period) ?? { positive: 0, negative: 0 };
      row.comp = ratio(cb.positive, cb.negative);
    }
    return row;
  });
}

function MiniChart({ ownSeries, compSeries, label, mentions }) {
  const chartData = buildChartData(ownSeries, compSeries);
  return (
    <div className="bg-gray-50 rounded-lg p-3 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-foreground truncate">{label}</span>
        <span className="text-[9px] text-foreground-muted whitespace-nowrap mr-1">{mentions} אזכורים</span>
      </div>
      <ResponsiveContainer width="100%" height={90}>
        <LineChart data={chartData} margin={{ top: 2, right: 4, left: -28, bottom: 0 }}>
          <XAxis dataKey="period" tick={{ fontSize: 7 }} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} hide />
          <Tooltip formatter={v => v != null ? `${v}%` : '—'} contentStyle={{ fontSize: 10, borderRadius: 4 }} />
          <Line type="monotone" dataKey="own" stroke="#2563eb" strokeWidth={1.5} dot={false} connectNulls={false} />
          {compSeries && <Line type="monotone" dataKey="comp" stroke="#9333ea" strokeWidth={1} strokeDasharray="3 2" dot={false} connectNulls={false} />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function FullChart({ ownSeries, compSeries, compName, ownLabel }) {
  const chartData = buildChartData(ownSeries, compSeries);
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="period" tick={{ fontSize: 9 }} />
        <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} />
        <Tooltip formatter={v => v != null ? `${v}%` : '—'} contentStyle={{ fontSize: 11, borderRadius: 6 }} />
        <Line type="monotone" dataKey="own" name={ownLabel} stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
        {compSeries && <Line type="monotone" dataKey="comp" name={compName} stroke="#9333ea" strokeWidth={1.5} strokeDasharray="4 2" dot={{ r: 2.5 }} connectNulls={false} />}
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function TopicTimelineWidget({ businessProfileId, businessName }) {
  const [showComp, setShowComp] = useState(null);
  const [activeTopic, setActiveTopic] = useState(null);

  // ponytail: mirror GoogleCompareWidget's set so the timeline respects the same curated list (R3-2)
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
  const top4 = sorted.slice(0, 4);
  const rest = sorted.slice(4);

  const compEntry  = showComp ? competitors.find(c => c.id === showComp) : null;
  const ownLabel   = businessName ?? 'העסק שלי';

  function getCompSeries(topicId) {
    return compEntry?.series?.find(s => s.topic_id === topicId) ?? null;
  }

  const selectedRest = activeTopic && rest.find(s => s.topic_id === activeTopic);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-blue-500" />
        <h3 className="text-sm font-semibold text-foreground">מגמת נושאים לאורך זמן — Google</h3>
        <span className="text-[10px] text-foreground-muted mr-auto">% חיובי מתוך סה״כ אזכורים</span>
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

      {/* No topic-sentiment data for selected competitor */}
      {showComp && compEntry && !compEntry.series?.length && (
        <p className="text-[11px] text-foreground-muted bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          אין נתוני נושאים עדיין למתחרה זה
        </p>
      )}

      {/* Top 4 mini charts — 2×2 grid */}
      <div className="grid grid-cols-2 gap-3">
        {top4.map(s => (
          <MiniChart
            key={s.topic_id}
            label={th(s.topic_id)}
            mentions={topicTotal(s)}
            ownSeries={s}
            compSeries={getCompSeries(s.topic_id)}
          />
        ))}
      </div>

      {/* Rest — pill selector + full chart */}
      {rest.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[10px] text-foreground-muted">נושאים נוספים:</span>
            {rest.map(s => (
              <button
                key={s.topic_id}
                onClick={() => setActiveTopic(s.topic_id === activeTopic ? null : s.topic_id)}
                className={`text-[11px] px-2.5 py-1 rounded-full border font-medium transition-colors ${
                  activeTopic === s.topic_id
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-border text-foreground-muted hover:border-blue-400 hover:text-blue-600'
                }`}
              >
                {th(s.topic_id)}
              </button>
            ))}
          </div>

          {selectedRest && (
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-[11px] font-semibold text-foreground mb-2">{th(selectedRest.topic_id)}</p>
              <FullChart
                ownSeries={selectedRest}
                compSeries={getCompSeries(selectedRest.topic_id)}
                compName={compEntry?.name}
                ownLabel={ownLabel}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
