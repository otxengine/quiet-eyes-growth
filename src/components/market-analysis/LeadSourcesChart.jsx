import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

const COLORS = ['#111111', '#10b981', '#d97706', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'];

const sourceLabels = {
  'Google': 'גוגל',
  'Instagram': 'אינסטגרם',
  'Facebook': 'פייסבוק',
  'WhatsApp': 'וואטסאפ',
  'אתר': 'אתר',
  'המלצה': 'המלצה',
};

export default function LeadSourcesChart({ leads }) {
  const sourceCounts = {};
  leads.forEach(lead => {
    const src = lead.source || 'אחר';
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  });

  const data = Object.entries(sourceCounts)
    .map(([name, value]) => ({ name: sourceLabels[name] || name, value }))
    .sort((a, b) => b.value - a.value);

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5">
        <h3 className="text-[13px] font-semibold text-[#222222] mb-4">התפלגות לידים לפי מקור</h3>
        <p className="text-[12px] text-[#999999] text-center py-10">אין נתונים עדיין</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5">
      <h3 className="text-[13px] font-semibold text-[#222222] mb-1">התפלגות לידים לפי מקור</h3>
      <p className="text-[10px] text-[#999999] mb-4">מאיפה מגיעים הלקוחות הפוטנציאליים</p>
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} strokeWidth={0}>
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip
              formatter={(value) => [`${value} לידים`, '']}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #f0f0f0' }}
            />
            <Legend
              verticalAlign="bottom"
              iconType="circle"
              iconSize={8}
              formatter={(value) => <span style={{ fontSize: 11, color: '#666' }}>{value}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}