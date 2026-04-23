import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const CATEGORIES = {
  threat: { label: 'איומים', color: '#dc2626' },
  opportunity: { label: 'הזדמנויות', color: '#10b981' },
  trend: { label: 'מגמות', color: '#d97706' },
  competitor_move: { label: 'מהלכי מתחרים', color: '#999999' },
};

export default function SignalCategoryChart({ signals = [] }) {
  const data = useMemo(() => {
    const counts = {};
    signals.forEach(s => { const cat = s.category || 'trend'; counts[cat] = (counts[cat] || 0) + 1; });
    return Object.entries(CATEGORIES).map(([key, config]) => ({ name: config.label, value: counts[key] || 0, color: config.color }));
  }, [signals]);

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5">
      <h3 className="text-[14px] font-semibold text-[#222222] mb-1">פילוח תובנות לפי קטגוריה</h3>
      <p className="text-[10px] text-[#cccccc] mb-4">התפלגות סוגי התובנות שזוהו</p>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fill: '#cccccc', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#cccccc', fontSize: 11 }} axisLine={false} tickLine={false} width={25} />
            <Tooltip contentStyle={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 10, fontSize: 12, direction: 'rtl' }} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={32}>
              {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}