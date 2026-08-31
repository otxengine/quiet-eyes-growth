import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, TrendingUp } from 'lucide-react';
import { th } from '@/components/competitors/topicLabels';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3007/api').replace(/\/$/, '');

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

function StatCell({ bucket, className = '' }) {
  if (!bucket || bucket.positive + bucket.negative === 0) {
    return <td className={`py-2 px-2 text-center text-[10px] text-gray-200 ${className}`}>—</td>;
  }
  const r = ratio(bucket.positive, bucket.negative);
  return (
    <td className={`py-2 px-2 text-center ${className}`}>
      <span className={`text-[11px] font-semibold ${ratingColor(r)}`}>
        {r != null ? `${r}%` : '—'}
      </span>
      <div className="flex justify-center gap-1.5 mt-0.5">
        <span className="text-[9px] text-green-500">↑{bucket.positive}</span>
        <span className="text-[9px] text-red-400">↓{bucket.negative}</span>
      </div>
    </td>
  );
}

export default function TopicTimelineWidget({ businessProfileId, businessName }) {
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
  const sorted = [...own].sort((a, b) => topicTotal(b) - topicTotal(a));

  const compEntry = showComp ? competitors.find(c => c.id === showComp) : null;
  const hasCompData = !!(compEntry?.series?.length);

  // When competitor with data is selected, only show common topics
  const compTopicIds = new Set((compEntry?.series ?? []).map(s => s.topic_id));
  const visibleOwn = showComp && compTopicIds.size > 0
    ? sorted.filter(s => compTopicIds.has(s.topic_id))
    : sorted;

  // All periods from own data, last 6 quarters
  const allPeriods = [...new Set(own.flatMap(s => s.buckets.map(b => b.period)))].sort().slice(-4);

  // Competitor lookup: topic_id → period → bucket
  const compLookup = {};
  if (compEntry?.series) {
    for (const s of compEntry.series) {
      compLookup[s.topic_id] = Object.fromEntries(s.buckets.map(b => [b.period, b]));
    }
  }

  const ownLabel = businessName ?? 'העסק שלי';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-blue-500" />
        <h3 className="text-sm font-semibold text-foreground">נושאים לפי רבעון — Google</h3>
        <span className="text-[10px] text-foreground-muted mr-auto">% חיובי • ↑חיובי ↓שלילי</span>
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
          {competitors.map(c => (
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

      {showComp && compEntry && !hasCompData && (
        <p className="text-[11px] text-foreground-muted bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          אין נתוני נושאים עדיין למתחרה זה
        </p>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-right border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-100">
              <th className="text-[10px] font-semibold text-foreground-muted py-2 pr-0 pl-2 text-right">נושא</th>
              {/* label column — only when competitor is active */}
              {hasCompData && <th className="text-[10px] font-semibold text-foreground-muted py-2 px-1" />}
              {allPeriods.map(p => (
                <th key={p} className="text-[10px] font-semibold text-foreground-muted py-2 px-2 text-center whitespace-nowrap">
                  {periodLabel(p)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleOwn.map((s, idx) => {
              const ownBucketMap = Object.fromEntries(s.buckets.map(b => [b.period, b]));
              const rowBg = idx % 2 === 0 ? 'bg-gray-50/50' : '';

              return (
                <Fragment key={s.topic_id}>
                  {/* Own row */}
                  <tr className={rowBg}>
                    <td
                      rowSpan={hasCompData ? 2 : 1}
                      className="text-[11px] font-semibold text-foreground pr-0 pl-2 whitespace-nowrap align-middle border-b border-gray-100"
                    >
                      {th(s.topic_id)}
                    </td>
                    {hasCompData && (
                      <td className="text-[9px] font-semibold text-blue-600 px-1 py-2 whitespace-nowrap">
                        {ownLabel}
                      </td>
                    )}
                    {allPeriods.map(p => (
                      <StatCell key={p} bucket={ownBucketMap[p]} />
                    ))}
                  </tr>

                  {/* Competitor row */}
                  {hasCompData && (
                    <tr className={`${rowBg} border-b border-gray-100`}>
                      <td className="text-[9px] font-semibold text-purple-600 px-1 py-2 whitespace-nowrap truncate max-w-[90px]">
                        {compEntry.name}
                      </td>
                      {allPeriods.map(p => (
                        <StatCell key={p} bucket={compLookup[s.topic_id]?.[p]} />
                      ))}
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
