import React from 'react';
import { useNavigate } from 'react-router-dom';

const stages = [
  { key: 'new', label: 'חדש', color: 'bg-gray-200 text-gray-700' },
  { key: 'contacted', label: 'קשר', color: 'bg-blue-100 text-blue-700' },
  { key: 'meeting', label: 'פגישה', color: 'bg-amber-100 text-amber-700' },
  { key: 'negotiation', label: 'מו"מ', color: 'bg-purple-100 text-purple-700' },
  { key: 'closed_won', label: 'נסגר', color: 'bg-green-100 text-green-700' },
];

export default function PipelineSummary({ leads = [] }) {
  const navigate = useNavigate();

  const counts = {};
  stages.forEach(s => { counts[s.key] = 0; });
  leads.forEach(l => {
    const stage = l.lifecycle_stage || 'new';
    if (counts[stage] !== undefined) counts[stage]++;
    else counts['new']++;
  });

  const total = leads.length;
  if (total === 0) return null;

  return (
    <div className="card-base p-4 cursor-pointer hover:shadow-sm transition-shadow" onClick={() => navigate('/leads?view=pipeline')}>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[11px] font-semibold text-foreground">Pipeline</h4>
        <span className="text-[10px] text-foreground-muted">{total} לידים</span>
      </div>
      <div className="flex gap-1 h-7 rounded-lg overflow-hidden">
        {stages.map(stage => {
          const count = counts[stage.key];
          if (count === 0) return null;
          const pct = Math.max((count / total) * 100, 8);
          return (
            <div key={stage.key} className={`${stage.color} flex items-center justify-center transition-all`} style={{ width: `${pct}%` }}>
              <span className="text-[9px] font-bold whitespace-nowrap">{count} {stage.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}