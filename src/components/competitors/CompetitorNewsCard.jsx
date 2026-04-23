import React from 'react';
import { Newspaper, Clock } from 'lucide-react';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'לפני פחות משעה';
  if (hours < 24) return `לפני ${hours} שעות`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

const categoryColors = {
  competitor_move: 'bg-[#fef3c7] text-[#d97706]',
  threat: 'bg-[#fce4ec] text-[#dc2626]',
  opportunity: 'bg-[#f0fdf8] text-[#10b981]',
  trend: 'bg-[#f0f4ff] text-[#3b82f6]',
};

export default function CompetitorNewsCard({ signals, competitorName }) {
  const filtered = signals.filter(s =>
    (s.summary || '').includes(competitorName)
  ).slice(0, 3);

  if (filtered.length === 0) return null;

  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Newspaper className="w-3 h-3 text-[#cccccc]" />
        <span className="text-[10px] font-medium text-[#999999]">חדשות אחרונות</span>
      </div>
      {filtered.map((signal) => (
        <div key={signal.id} className="flex items-start gap-2 px-2.5 py-1.5 rounded-md bg-[#fafafa] border border-[#f5f5f5]">
          <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-medium mt-0.5 flex-shrink-0 ${categoryColors[signal.category] || 'bg-[#f5f5f5] text-[#999999]'}`}>
            {signal.category === 'competitor_move' ? 'מהלך' : signal.category === 'threat' ? 'איום' : signal.category === 'opportunity' ? 'הזדמנות' : 'מגמה'}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-[#444444] truncate">{signal.summary}</p>
            <span className="text-[9px] text-[#cccccc] flex items-center gap-1 mt-0.5">
              <Clock className="w-2.5 h-2.5" /> {timeAgo(signal.detected_at || signal.created_date)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}