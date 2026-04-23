import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const COLORS = { positive: '#10b981', neutral: '#d97706', negative: '#dc2626' };
const LABELS = { positive: 'חיובי', neutral: 'ניטרלי', negative: 'שלילי' };

export default function SentimentBreakdown({ reviews = [] }) {
  const data = useMemo(() => {
    const counts = { positive: 0, neutral: 0, negative: 0 };
    reviews.forEach(r => { if (counts[r.sentiment] !== undefined) counts[r.sentiment]++; });
    return Object.entries(counts).filter(([, v]) => v > 0).map(([key, value]) => ({ name: LABELS[key], value, key }));
  }, [reviews]);

  const total = reviews.length;
  if (total === 0) return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5">
      <h3 className="text-[14px] font-semibold text-[#222222] mb-2">ניתוח סנטימנט</h3>
      <p className="text-[11px] text-[#999999] text-center py-8">אין ביקורות לניתוח</p>
    </div>
  );

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5">
      <h3 className="text-[14px] font-semibold text-[#222222] mb-2">ניתוח סנטימנט</h3>
      <div className="flex items-center gap-4">
        <div className="w-32 h-32">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={30} outerRadius={55} dataKey="value" strokeWidth={0}>
                {data.map((entry) => <Cell key={entry.key} fill={COLORS[entry.key]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 10, fontSize: 12, direction: 'rtl' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-2">
          {data.map((item) => (
            <div key={item.key} className="flex items-center gap-2">
              <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: COLORS[item.key] }} />
              <span className="text-[8.5px] text-[#bbbbbb] flex-1">{item.name}</span>
              <span className="text-[11px] font-semibold text-[#222222]">{item.value}</span>
              <span className="text-[10px] text-[#cccccc]">({Math.round((item.value / total) * 100)}%)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}