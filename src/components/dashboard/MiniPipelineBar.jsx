import React from 'react';
import { useNavigate } from 'react-router-dom';

const stages = [
  { key: 'new', label: 'חדש', color: '#9ca3af' },
  { key: 'contacted', label: 'קשר', color: '#3b82f6' },
  { key: 'meeting', label: 'פגישה', color: '#d97706' },
  { key: 'negotiation', label: 'מו״מ', color: '#8b5cf6' },
  { key: 'closed_won', label: 'סגירה', color: '#10b981' },
];

export default function MiniPipelineBar({ leads }) {
  const navigate = useNavigate();
  const counts = {};
  stages.forEach(s => { counts[s.key] = 0; });
  leads.forEach(l => {
    const stage = l.lifecycle_stage || 'new';
    if (counts[stage] !== undefined) counts[stage]++;
  });

  const total = Object.values(counts).reduce((s, v) => s + v, 0) || 1;

  return (
    <div className="cursor-pointer" onClick={() => navigate('/leads?view=pipeline')}>
      {/* Bar */}
      <div className="flex h-5 rounded-md overflow-hidden bg-[#f5f5f5]">
        {stages.map(stage => {
          const pct = (counts[stage.key] / total) * 100;
          if (pct === 0) return null;
          return (
            <div key={stage.key} style={{ width: `${pct}%`, backgroundColor: stage.color }}
              className="flex items-center justify-center transition-all duration-500"
              title={`${stage.label}: ${counts[stage.key]}`}>
              {pct > 12 && <span className="text-[8px] text-white font-medium">{counts[stage.key]}</span>}
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
        {stages.map(stage => (
          counts[stage.key] > 0 && (
            <span key={stage.key} className="flex items-center gap-1 text-[8px] text-foreground-muted">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: stage.color }} />
              {counts[stage.key]} {stage.label}
            </span>
          )
        ))}
      </div>
    </div>
  );
}