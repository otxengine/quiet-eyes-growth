import React from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Trophy, TrendingUp, TrendingDown, Minus, Loader2, Target } from 'lucide-react';

function DeltaIcon({ delta }) {
  if (delta > 0)  return <TrendingUp  className="w-3.5 h-3.5 text-green-500" />;
  if (delta < 0)  return <TrendingDown className="w-3.5 h-3.5 text-red-400" />;
  return <Minus className="w-3.5 h-3.5 text-foreground-muted/50" />;
}

function BenchmarkRow({ metric, your_value, sector_avg, unit, better, delta, no_data }) {
  if (no_data) return null;
  return (
    <div className={`flex items-center justify-between px-3 py-2.5 rounded-xl border ${better ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
      <div className="flex items-center gap-2 min-w-0">
        <DeltaIcon delta={delta} />
        <span className="text-[12px] text-foreground-secondary font-medium truncate">{metric}</span>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="text-right">
          <p className={`text-[13px] font-bold ${better ? 'text-green-700' : 'text-red-600'}`}>
            {your_value}{unit}
          </p>
          <p className="text-[9px] text-foreground-muted/70">אתה</p>
        </div>
        <div className="w-px h-6 bg-border" />
        <div className="text-right">
          <p className="text-[13px] font-semibold text-foreground-muted">{sector_avg}{unit}</p>
          <p className="text-[9px] text-foreground-muted/70">ממוצע</p>
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
      <div className="rounded-2xl border border-border/60 bg-white px-5 py-8 shadow-sm flex items-center justify-center gap-3">
        <Loader2 className="w-4 h-4 animate-spin text-primary/50" />
        <span className="text-[12px] text-foreground-muted/70">טוען השוואת סקטור...</span>
      </div>
    );
  }

  if (!data?.comparisons?.length) {
    return (
      <div className="rounded-2xl border border-border/60 bg-white px-5 py-6 shadow-sm text-center">
        <Trophy className="w-8 h-8 text-border mx-auto mb-2" />
        <p className="text-[12px] text-foreground-muted/70">אין עדיין נתונים לבנצ'מרק</p>
      </div>
    );
  }

  const { comparisons, overall_percentile, above_avg_count, total_metrics, top_improvement, sector_winner_insight } = data;

  const percentileColor = overall_percentile >= 70 ? 'text-green-600' : overall_percentile >= 40 ? 'text-amber-600' : 'text-red-500';
  const percentileLabel = overall_percentile >= 70 ? 'מצוין' : overall_percentile >= 40 ? 'ממוצע' : 'מתחת לממוצע';

  return (
    <div className="rounded-2xl border border-border/60 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" />
          <span className="text-[13px] font-bold text-foreground">בנצ'מרק — השוואה לסקטור</span>
        </div>
        {data.sector && (
          <span className="text-[10px] bg-primary/8 text-primary px-2 py-0.5 rounded-full font-medium">{data.sector}</span>
        )}
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Percentile hero */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-foreground-muted/70 mb-1">מיקום בסקטור</p>
            <p className={`text-[32px] font-black ${percentileColor}`}>{overall_percentile}%</p>
            <p className="text-[10px] text-foreground-muted">{percentileLabel} — {above_avg_count}/{total_metrics} מדדים מעל הממוצע</p>
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
          <div className="flex items-start gap-2 bg-primary/8 border border-primary/15 rounded-xl px-3 py-2.5">
            <TrendingUp className="w-3.5 h-3.5 text-primary/70 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-primary">{sector_winner_insight}</p>
          </div>
        )}
      </div>
    </div>
  );
}
