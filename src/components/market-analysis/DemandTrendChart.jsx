import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, subDays, startOfDay } from 'date-fns';

export default function DemandTrendChart({ signals }) {
  const data = useMemo(() => {
    const days = 30;
    const buckets = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = format(startOfDay(subDays(new Date(), i)), 'yyyy-MM-dd');
      buckets[d] = { date: d, opportunities: 0, threats: 0, trends: 0 };
    }

    signals.forEach(s => {
      const d = (s.detected_at || s.created_date || '').slice(0, 10);
      if (buckets[d]) {
        if (s.category === 'opportunity') buckets[d].opportunities++;
        else if (s.category === 'threat') buckets[d].threats++;
        else if (s.category === 'trend') buckets[d].trends++;
      }
    });

    return Object.values(buckets).map(b => ({
      ...b,
      label: format(new Date(b.date), 'dd/MM'),
    }));
  }, [signals]);

  const hasData = signals.length > 0;

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5">
      <h3 className="text-[13px] font-semibold text-[#222222] mb-1">מגמות ביקוש בשוק</h3>
      <p className="text-[10px] text-[#999999] mb-4">30 ימים אחרונים — מבוסס על סיגנלים שנאספו</p>
      {!hasData ? (
        <p className="text-[12px] text-[#999999] text-center py-10">אין נתונים עדיין</p>
      ) : (
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#999' }} interval={4} />
              <YAxis tick={{ fontSize: 10, fill: '#999' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #f0f0f0' }}
                labelFormatter={(v) => `תאריך: ${v}`}
              />
              <Area type="monotone" dataKey="opportunities" name="הזדמנויות" stroke="#10b981" fill="#10b981" fillOpacity={0.15} strokeWidth={2} />
              <Area type="monotone" dataKey="threats" name="איומים" stroke="#dc2626" fill="#dc2626" fillOpacity={0.1} strokeWidth={2} />
              <Area type="monotone" dataKey="trends" name="מגמות" stroke="#d97706" fill="#d97706" fillOpacity={0.1} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}