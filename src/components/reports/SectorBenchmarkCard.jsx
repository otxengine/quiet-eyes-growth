import React from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Trophy, TrendingUp, TrendingDown, Minus, Loader2, Target } from 'lucide-react';

function DeltaIcon({ delta }) {
  if (delta > 0)  return <TrendingUp  className="w-3.5 h-3.5 text-green-500" />;
  if (delta < 0)  return <TrendingDown className="w-3.5 h-3.5 text-red-400" />;
  return <Minus className="w-3.5 h-3.5 text-gray-300" />;
}

function BenchmarkRow({ metric, your_value, sector_avg, unit, better, delta, no_data }) {
  if (no_data) return null;
  return (
    <div className={`flex items-center justify-between px-3 py-2.5 rounded-xl border ${better ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
      <div className="flex items-center gap-2 min-w-0">
        <DeltaIcon delta={delta} />
        <span className="text-[12px] text-gray-700 font-medium truncate">{metric}</span>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="text-right">
          <p className={`text-[13px] font-bold ${better ? 'text-green-700' : 'text-red-600'}`}>
            {your_value}{unit}
          </p>
          <p className="text-[9px] text-gray-400">אתה</p>
        </div>
        <div className="w-px h-6 bg-gray-200" />
        <div className="text-right">
          <p className="text-[13px] font-semibold text-gray-500">{sector_avg}{unit}</p>
          <p className="text-[9px] text-gray-400">ממוצע</p>
        </div>
        <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${better ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
          {delta > 0 ? '+' : ''}{delta}{unit}
        </div>
      </div>
    </div>
  );
}

export default function SectorBenchmarkCard({ businessProfileId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['sectorBenchmark', businessProfileId],
    queryFn: () =>
      base44.functions.invoke('sectorBenchmark', { businessProfileId }).then(r => r?.data || r),
    enabled: !!businessProfileId,
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white px-5 py-8 shadow-sm flex items-center justify-center gap-3">
        <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
        <span className="text-[12px] text-gray-400">טוען השוואת סקטור...</span>
      </div>
    );
  }

  if (!data?.comparisons?.length) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white px-5 py-6 shadow-sm text-center">
        <Trophy className="w-8 h-8 text-gray-200 mx-auto mb-2" />
        <p className="text-[12px] text-gray-400">אין עדיין נתונים לבנצ'מרק</p>
      </div>
    );
  }

  const { comparisons, overall_percentile, above_avg_count, total_metrics, top_improvement, sector_winner_insight } = data;

  const percentileColor = overall_percentile >= 70 ? 'text-green-600' : overall_percentile >= 40 ? 'text-amber-600' : 'text-red-500';
  const percentileLabel = overall_percentile >= 70 ? 'מצוין' : overall_percentile >= 40 ? 'ממוצע' : 'מתחת לממוצע';

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" />
          <span className="text-[13px] font-bold text-gray-800">בנצ'מרק — השוואה לסקטור</span>
        </div>
        {data.sector && (
          <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-medium">{data.sector}</span>
        )}
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Percentile hero */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-gray-400 mb-1">מיקום בסקטור</p>
            <p className={`text-[32px] font-black ${percentileColor}`}>{overall_percentile}%</p>
            <p className="text-[10px] text-gray-500">{percentileLabel} — {above_avg_count}/{total_metrics} מדדים מעל הממוצע</p>
          </div>
          {top_improvement && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 max-w-[140px] text-right">
              <div className="flex items-center gap-1 mb-1">
                <Target className="w-3 h-3 text-amber-500" />
                <p className="text-[9px] text-amber-600 font-medium">שיפור מיידי</p>
              </div>
              <p className="text-[11px] text-amber-800 font-semibold leading-tight">{top_improvement}</p>
            </div>
          )}
        </div>

        {/* Comparisons */}
        <div className="space-y-2">
          {comparisons.map((c, i) => (
            <BenchmarkRow key={i} {...c} />
          ))}
        </div>

        {/* Winner insight */}
        {sector_winner_insight && (
          <div className="flex items-start gap-2 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2.5">
            <TrendingUp className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-indigo-700">{sector_winner_insight}</p>
          </div>
        )}
      </div>
    </div>
  );
}
