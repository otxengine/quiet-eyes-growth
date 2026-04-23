import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';

function Sparkline({ trend }) {
  const heights = trend === 'up' ? [3, 4, 5, 7, 9, 12, 15] : trend === 'down' ? [15, 12, 9, 7, 5, 4, 3] : [5, 6, 5, 6, 5, 6, 5];
  return (
    <div className="flex items-end gap-[1px]">
      {heights.map((h, i) => {
        const opacity = trend === 'up' ? 0.08 + (i * 0.035) : trend === 'down' ? 0.04 + (i * 0.02) : 0.04;
        const color = trend === 'up' ? `rgba(16,185,129,${opacity})` : trend === 'down' ? `rgba(220,38,38,${opacity})` : `rgba(0,0,0,${opacity})`;
        return <div key={i} className="w-[2px] rounded-t" style={{ height: h * 0.6, background: color }} />;
      })}
    </div>
  );
}

export default function CompactCompetitors({ competitors = [], business }) {
  const navigate = useNavigate();

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] flex flex-col">
      <div className="px-4 py-3 border-b border-[#f5f5f5]">
        <h3 className="text-[13px] font-semibold text-[#222222]">מתחרים מובילים</h3>
      </div>
      <div className="divide-y divide-[#f5f5f5]">
        {business && (
          <div className="px-4 py-2 flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-[#f0f0f0] flex items-center justify-center text-[#111111] text-[8px] font-bold flex-shrink-0">
              {business.name?.substring(0, 2)}
            </div>
            <span className="text-[11px] font-medium text-[#222222] flex-1 truncate">{business.name}</span>
            <span className="text-[10px] text-[#111111] font-medium">אתה</span>
            <span className="text-[14px] font-semibold text-[#444444]">4.2</span>
          </div>
        )}
        {competitors.slice(0, 4).map((comp) => (
          <div
            key={comp.id}
            className="px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[#f5f5f5] transition-colors"
            onClick={() => navigate('/competitors')}
          >
            <div className="w-6 h-6 rounded-md bg-[#f5f5f5] flex items-center justify-center text-[#999999] text-[8px] font-bold flex-shrink-0">
              {comp.name?.substring(0, 2)}
            </div>
            <span className="text-[11px] text-[#999999] flex-1 truncate">{comp.name}</span>
            <Sparkline trend={comp.trend_direction} />
            <span className={`text-[14px] font-semibold ${comp.rating >= 4.3 ? 'text-[#10b981]' : comp.rating >= 4 ? 'text-[#d97706]' : 'text-[#dc2626]'}`}>
              {comp.rating?.toFixed(1)}
            </span>
          </div>
        ))}
        {competitors.length === 0 && !business && (
          <div className="p-4 text-center text-[11px] text-[#999999]">טרם זוהו מתחרים</div>
        )}
      </div>
    </div>
  );
}