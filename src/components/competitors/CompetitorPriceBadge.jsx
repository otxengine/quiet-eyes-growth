import React from 'react';
import { Banknote, AlertTriangle } from 'lucide-react';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'לפני פחות משעה';
  if (hours < 24) return `לפני ${hours} שעות`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

export default function CompetitorPriceBadge({ competitor }) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentChange = competitor.price_changed_at && competitor.price_changed_at >= weekAgo;

  return (
    <div className="space-y-1.5">
      {competitor.last_known_prices && (
        <div className="flex items-start gap-1.5">
          <Banknote className="w-3.5 h-3.5 text-[#cccccc] mt-0.5" />
          <div>
            <span className="text-[10px] font-medium text-[#999999] block mb-0.5">מחירים ידועים</span>
            <p className="text-[11px] text-[#444444]">{competitor.last_known_prices}</p>
          </div>
        </div>
      )}
      {competitor.last_price_check && (
        <span className="text-[9px] text-[#cccccc] block">עדכון אחרון: {timeAgo(competitor.last_price_check)}</span>
      )}
      {recentChange && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium bg-[#fef2f2] text-[#dc2626]">
          <AlertTriangle className="w-3 h-3" /> מחיר השתנה!
        </span>
      )}
    </div>
  );
}