import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

function getDateStr(item) { return item.detected_at || item.created_at || item.created_date || ''; }

function compareMonths(items, getDate) {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  const current = items.filter(i => getDate(i).startsWith(thisMonth)).length;
  const previous = items.filter(i => getDate(i).startsWith(prevMonth)).length;
  const change = previous > 0 ? Math.round(((current - previous) / previous) * 100) : (current > 0 ? 100 : 0);
  return { current, previous, change };
}

export default function MonthCompareCards({ signals = [], leads = [], reviews = [], competitors = [] }) {
  const data = useMemo(() => [
    { label: 'תובנות שוק', ...compareMonths(signals, getDateStr) },
    { label: 'לידים חדשים', ...compareMonths(leads, getDateStr) },
    { label: 'ביקורות', ...compareMonths(reviews, getDateStr) },
    { label: 'מתחרים במעקב', current: competitors.length, previous: 0, change: 0 },
  ], [signals, leads, reviews, competitors]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {data.map((card) => {
        const TrendIcon = card.change > 0 ? TrendingUp : card.change < 0 ? TrendingDown : Minus;
        const trendColor = card.change > 0 ? 'text-[#10b981]' : card.change < 0 ? 'text-[#dc2626]' : 'text-[#cccccc]';
        return (
          <div key={card.label} className="bg-white rounded-[10px] border border-[#f0f0f0] p-5">
            <p className="text-[10px] text-[#bbbbbb] mb-1">{card.label}</p>
            <span className="text-[30px] font-bold text-[#111111] leading-none">{card.current}</span>
            {card.label !== 'מתחרים במעקב' && (
              <div className="flex items-center gap-1 mt-1">
                <span className={`text-[9px] font-medium ${trendColor}`}>{card.change > 0 ? '+' : ''}{card.change}%</span>
                <span className="text-[8px] text-[#cccccc]">מחודש שעבר</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}