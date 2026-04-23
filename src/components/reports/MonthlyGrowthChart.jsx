import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const hebrewMonths = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני', 'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];

function getDateStr(item) { return item.detected_at || item.created_at || item.created_date || ''; }

export default function MonthlyGrowthChart({ signals = [], leads = [], reviews = [] }) {
  const data = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({
        name: hebrewMonths[d.getMonth()],
        תובנות: signals.filter(s => getDateStr(s).startsWith(prefix)).length,
        לידים: leads.filter(l => getDateStr(l).startsWith(prefix)).length,
        ביקורות: reviews.filter(r => getDateStr(r).startsWith(prefix)).length,
      });
    }
    return months;
  }, [signals, leads, reviews]);

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5">
      <h3 className="text-[14px] font-semibold text-[#222222] mb-4">מגמת צמיחה — 6 חודשים אחרונים</h3>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradS" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#111111" stopOpacity={0.08} /><stop offset="95%" stopColor="#111111" stopOpacity={0} /></linearGradient>
              <linearGradient id="gradL" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.15} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
              <linearGradient id="gradR" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#d97706" stopOpacity={0.15} /><stop offset="95%" stopColor="#d97706" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fill: '#cccccc', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#cccccc', fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip contentStyle={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 10, fontSize: 12, direction: 'rtl' }} />
            <Area type="monotone" dataKey="תובנות" stroke="#111111" fill="url(#gradS)" strokeWidth={1.5} />
            <Area type="monotone" dataKey="לידים" stroke="#10b981" fill="url(#gradL)" strokeWidth={1.5} />
            <Area type="monotone" dataKey="ביקורות" stroke="#d97706" fill="url(#gradR)" strokeWidth={1.5} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-center gap-5 mt-3">
        <span className="flex items-center gap-1.5 text-[8.5px] text-[#cccccc]"><span className="w-2 h-[1px] bg-[#111111] inline-block" /> תובנות</span>
        <span className="flex items-center gap-1.5 text-[8.5px] text-[#cccccc]"><span className="w-2 h-[1px] bg-[#10b981] inline-block" /> לידים</span>
        <span className="flex items-center gap-1.5 text-[8.5px] text-[#cccccc]"><span className="w-2 h-[1px] bg-[#d97706] inline-block" /> ביקורות</span>
      </div>
    </div>
  );
}