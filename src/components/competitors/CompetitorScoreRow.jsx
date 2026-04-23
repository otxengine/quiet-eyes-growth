import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function CompetitorScoreRow({ business, avgRating, reviewCount, competitors }) {
  return (
    <div className="flex gap-3 overflow-x-auto">
      <div className="flex-1 min-w-[160px] max-w-[220px] card-base p-3.5 border-l-2 border-l-foreground">
        <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[10px] font-semibold text-foreground">אתה</span>
        <span className="text-[11px] font-medium text-foreground truncate">{business?.name}</span>
        </div>
        <div className="flex items-center justify-between">
        <span className="text-[22px] font-bold text-foreground tracking-tight">{avgRating.toFixed(1)}</span>
        <span className="text-[10px] text-foreground-muted">{reviewCount} ביקורות</span>
        </div>
      </div>

      {competitors.slice(0, 4).map((comp) => (
        <div key={comp.id} className="flex-1 min-w-[160px] max-w-[220px] card-base p-3.5">
          <span className="text-[11px] font-medium text-[#444444] block truncate mb-2">{comp.name}</span>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className={`text-[22px] font-bold ${comp.rating >= 4.3 ? 'text-[#10b981]' : comp.rating >= 4 ? 'text-[#d97706]' : 'text-[#dc2626]'}`}>
                {comp.rating?.toFixed(1) || '—'}
              </span>
              {comp.trend_direction === 'up' && <TrendingUp className="w-3.5 h-3.5 text-[#10b981]" />}
              {comp.trend_direction === 'down' && <TrendingDown className="w-3.5 h-3.5 text-[#dc2626]" />}
              {(!comp.trend_direction || comp.trend_direction === 'stable') && <Minus className="w-3.5 h-3.5 text-[#cccccc]" />}
            </div>
            <span className="text-[10px] text-[#999999]">{comp.review_count || 0} ביקורות</span>
          </div>
        </div>
      ))}
    </div>
  );
}