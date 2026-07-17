import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, TrendingUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3007/api').replace(/\/$/, '');

// positive / (positive + negative) as %, null when no data
function ratio(pos, neg) {
  const total = pos + neg;
  return total === 0 ? null : Math.round((pos / total) * 100);
}

export default function TopicTimelineWidget({ businessProfileId, businessName }) {
  const [activeTopic, setActiveTopic] = useState(null);
  const [showComp, setShowComp] = useState(null);

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

  const { own, competitors = [] } = data;
  const topics = own.map(s => s.topic_id);
  const topic = activeTopic ?? topics[0];

  const ownSeries  = own.find(s => s.topic_id === topic);
  const compEntry  = showComp ? competitors.find(c => c.id === showComp) : null;
  const compSeries = compEntry?.series?.find(s => s.topic_id === topic);

  const chartData = (ownSeries?.buckets ?? []).map(b => {
    const row = { period: b.period.slice(5), own: ratio(b.positive, b.negative) };
    if (compSeries) {
      const cb = compSeries.buckets?.find(x => x.period === b.period) ?? { positive: 0, negative: 0 };
      row.comp = ratio(cb.positive, cb.negative);
    }
    return row;
  });

  const ownLabel = businessName ?? 'העסק שלי';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4" dir="rtl">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-blue-500" />
        <h3 className="text-sm font-semibold text-foreground">מגמת נושאים לאורך זמן — Google</h3>
        <span className="text-[10px] text-foreground-muted mr-auto">% חיובי מתוך סה״כ אזכורים</span>
      </div>

      {/* Topic selector */}
      <div className="flex flex-wrap gap-1.5">
        {topics.map(t => (
          <button
            key={t}
            onClick={() => setActiveTopic(t)}
            className={`text-[11px] px-2.5 py-1 rounded-full border font-medium transition-colors ${
              topic === t
                ? 'bg-blue-600 text-white border-blue-600'
                : 'border-border text-foreground-muted hover:border-blue-400 hover:text-blue-600'
            }`}
          >
            {t}
          </button>
        ))}
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

      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="period" tick={{ fontSize: 9 }} />
          <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} />
          <Tooltip formatter={v => v != null ? `${v}%` : '—'} contentStyle={{ fontSize: 11, borderRadius: 6 }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line type="monotone" dataKey="own" name={ownLabel} stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          {compEntry && (
            <Line type="monotone" dataKey="comp" name={compEntry.name} stroke="#9333ea" strokeWidth={1.5} strokeDasharray="4 2" dot={{ r: 2.5 }} connectNulls={false} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
