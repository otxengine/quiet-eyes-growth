import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function CompetitorPricingChart({ competitors }) {
  const data = useMemo(() => {
    return competitors
      .filter(c => c.rating)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 8)
      .map(c => ({
        name: (c.name || '').length > 12 ? c.name.slice(0, 12) + '…' : c.name,
        rating: c.rating || 0,
        reviews: c.review_count || 0,
      }));
  }, [competitors]);

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5">
        <h3 className="text-[13px] font-semibold text-[#222222] mb-4">השוואת מתחרים</h3>
        <p className="text-[12px] text-[#999999] text-center py-10">אין נתוני מתחרים עדיין</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5">
      <h3 className="text-[13px] font-semibold text-[#222222] mb-1">השוואת מתחרים — דירוג וביקורות</h3>
      <p className="text-[10px] text-[#999999] mb-4">דירוג ממוצע מול כמות ביקורות</p>
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#999' }} angle={-20} textAnchor="end" height={50} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#999' }} domain={[0, 5]} />
            <YAxis yAxisId="right" orientation="left" tick={{ fontSize: 10, fill: '#999' }} hide />
            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #f0f0f0' }} />
            <Legend
              iconType="circle"
              iconSize={8}
              formatter={(value) => <span style={{ fontSize: 11, color: '#666' }}>{value}</span>}
            />
            <Bar yAxisId="left" dataKey="rating" name="דירוג" fill="#111111" radius={[4, 4, 0, 0]} barSize={20} />
            <Bar yAxisId="right" dataKey="reviews" name="ביקורות" fill="#10b981" radius={[4, 4, 0, 0]} barSize={20} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}