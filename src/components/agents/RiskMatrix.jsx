import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ShieldAlert } from 'lucide-react';

const IMPACT_MAP = { high: 1, medium: 0.5, low: 0 };
const PROB_MAP = { high: 1, medium: 0.5, low: 0 };

// Each quadrant: { label, color, bg, description }
const QUADRANTS = [
  { id: 'critical', label: 'פעל עכשיו',  color: '#ef4444', bg: '#fef2f2', x: 1, y: 1, desc: 'השפעה גבוהה + סבירות גבוהה' },
  { id: 'monitor',  label: 'מעקב צמוד',  color: '#f59e0b', bg: '#fffbeb', x: 0, y: 1, desc: 'השפעה נמוכה + סבירות גבוהה' },
  { id: 'plan',     label: 'הכן תגובה',   color: '#6366f1', bg: '#eef2ff', x: 1, y: 0, desc: 'השפעה גבוהה + סבירות נמוכה' },
  { id: 'watch',    label: 'נטר',         color: '#10b981', bg: '#f0fdf4', x: 0, y: 0, desc: 'השפעה נמוכה + סבירות נמוכה' },
];

function getQuadrant(impact, likelihood) {
  const x = IMPACT_MAP[impact] >= 0.5 ? 1 : 0;
  const y = PROB_MAP[likelihood] >= 0.5 ? 1 : 0;
  return QUADRANTS.find(q => q.x === x && q.y === y) || QUADRANTS[3];
}

export default function RiskMatrix({ risks = [], bpId }) {
  const [selected, setSelected] = useState(null);

  // If risks passed directly (from Strategy page), use them; otherwise fetch from signals
  const { data: signals } = useQuery({
    queryKey: ['signals-for-risk', bpId],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId }),
    enabled: !!bpId && risks.length === 0,
  });

  const items = risks.length > 0 ? risks : (signals || [])
    .filter(s => s.category === 'threat' || s.urgency >= 7)
    .slice(0, 8)
    .map(s => ({
      risk: s.summary || s.title || 'סיכון',
      likelihood: s.urgency >= 8 ? 'high' : s.urgency >= 5 ? 'medium' : 'low',
      impact: s.category === 'threat' ? 'high' : 'medium',
      mitigation: s.recommended_action || '',
    }));

  if (items.length === 0) return null;

  const grouped = QUADRANTS.map(q => ({
    ...q,
    items: items.filter(item => getQuadrant(item.impact, item.likelihood).id === q.id),
  }));

  return (
    <div className="card-base p-5">
      <div className="flex items-center gap-2 mb-4">
        <ShieldAlert className="w-4 h-4 text-danger" />
        <h3 className="text-[13px] font-semibold text-foreground">מטריצת סיכונים</h3>
      </div>

      {/* Axis labels */}
      <div className="relative">
        <div className="text-[9px] text-foreground-muted text-center mb-1 font-medium uppercase tracking-wide">
          ← סבירות נמוכה · סבירות גבוהה →
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {/* Top row: high likelihood */}
          {[QUADRANTS[1], QUADRANTS[0]].map(q => {
            const gData = grouped.find(g => g.id === q.id);
            return (
              <div key={q.id} className="rounded-lg p-3 min-h-[80px]" style={{ background: q.bg }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold" style={{ color: q.color }}>{q.label}</span>
                  {gData && gData.items.length > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold text-white" style={{ background: q.color }}>
                      {gData.items.length}
                    </span>
                  )}
                </div>
                <div className="space-y-1">
                  {(gData?.items || []).slice(0, 2).map((item, i) => (
                    <button
                      key={i}
                      onClick={() => setSelected(selected?.risk === item.risk ? null : item)}
                      className="text-[10px] text-right w-full line-clamp-1 hover:opacity-70 transition-opacity"
                      style={{ color: q.color }}
                    >
                      · {item.risk}
                    </button>
                  ))}
                  {(gData?.items || []).length > 2 && (
                    <span className="text-[9px] text-foreground-muted">+{gData.items.length - 2} נוספים</span>
                  )}
                </div>
              </div>
            );
          })}
          {/* Bottom row: low likelihood */}
          {[QUADRANTS[3], QUADRANTS[2]].map(q => {
            const gData = grouped.find(g => g.id === q.id);
            return (
              <div key={q.id} className="rounded-lg p-3 min-h-[80px]" style={{ background: q.bg }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold" style={{ color: q.color }}>{q.label}</span>
                  {gData && gData.items.length > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold text-white" style={{ background: q.color }}>
                      {gData.items.length}
                    </span>
                  )}
                </div>
                <div className="space-y-1">
                  {(gData?.items || []).slice(0, 2).map((item, i) => (
                    <button
                      key={i}
                      onClick={() => setSelected(selected?.risk === item.risk ? null : item)}
                      className="text-[10px] text-right w-full line-clamp-1 hover:opacity-70 transition-opacity"
                      style={{ color: q.color }}
                    >
                      · {item.risk}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Axis Y label */}
        <div className="text-[9px] text-foreground-muted text-center mt-1 font-medium uppercase tracking-wide">
          ← השפעה נמוכה · השפעה גבוהה →
        </div>
      </div>

      {/* Selected item detail */}
      {selected && (
        <div className="mt-3 p-3 rounded-lg bg-secondary border border-border">
          <p className="text-[11px] font-semibold text-foreground">{selected.risk}</p>
          {selected.mitigation && (
            <p className="text-[10px] text-foreground-muted mt-1">המלצה: {selected.mitigation}</p>
          )}
        </div>
      )}
    </div>
  );
}
