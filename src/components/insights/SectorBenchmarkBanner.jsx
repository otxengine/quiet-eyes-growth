import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { BarChart2 } from 'lucide-react';

export default function SectorBenchmarkBanner({ businessProfileId, businessProfile }) {
  const { data: sectorRows = [] } = useQuery({
    queryKey: ['sectorKnowledge', businessProfileId],
    queryFn: () => base44.entities.SectorKnowledge.filter(
      { sector: businessProfile?.category }, '-created_date', 1
    ),
    enabled: !!businessProfileId && !!businessProfile?.category,
    staleTime: 30 * 60 * 1000,
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['reviewsForBenchmark', businessProfileId],
    queryFn: () => base44.entities.Review.filter({ linked_business: businessProfileId }, '-created_date', 100),
    enabled: !!businessProfileId,
    staleTime: 10 * 60 * 1000,
  });

  const sector = sectorRows[0];
  if (!sector) return null;

  const sectorAvg = sector.avg_rating;
  const myAvg = reviews.length > 0
    ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1)
    : null;

  const trendingServices = (() => {
    try { return JSON.parse(sector.trending_services || '[]'); } catch { return []; }
  })();
  const winnerDNA = (() => {
    try {
      const d = typeof sector.winner_lead_dna === 'string'
        ? JSON.parse(sector.winner_lead_dna)
        : sector.winner_lead_dna;
      return d || {};
    } catch { return {}; }
  })();

  const myVsSector = myAvg && sectorAvg
    ? ((parseFloat(myAvg) - sectorAvg) / sectorAvg * 100).toFixed(0)
    : null;

  return (
    <div className="bg-gradient-to-l from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl px-4 py-3 flex flex-wrap gap-x-6 gap-y-2 items-center" dir="rtl">
      <div className="flex items-center gap-1.5 shrink-0">
        <BarChart2 className="w-3.5 h-3.5 text-blue-600" />
        <span className="text-[11px] font-bold text-blue-800">הסקטור שלך</span>
      </div>

      {sectorAvg && (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-foreground-secondary">ממוצע ענף:</span>
          <span className="text-[12px] font-bold text-foreground">{sectorAvg.toFixed(1)}★</span>
        </div>
      )}

      {myAvg && (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-foreground-secondary">אתה:</span>
          <span className="text-[12px] font-bold text-foreground">{myAvg}★</span>
          {myVsSector !== null && (
            <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${
              parseFloat(myVsSector) > 0
                ? 'text-emerald-700 bg-emerald-100'
                : 'text-red-700 bg-red-100'
            }`}>
              {parseFloat(myVsSector) > 0 ? `+${myVsSector}%` : `${myVsSector}%`}
            </span>
          )}
        </div>
      )}

      {trendingServices.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-foreground-secondary">שירות מוביל:</span>
          <span className="text-[11px] font-semibold text-foreground">{trendingServices[0]}</span>
        </div>
      )}

      {winnerDNA?.top_source && (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-foreground-secondary">מקור ליד מנצח:</span>
          <span className="text-[11px] font-semibold text-foreground">{winnerDNA.top_source}</span>
        </div>
      )}
    </div>
  );
}
