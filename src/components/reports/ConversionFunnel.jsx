import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const COLORS = ['#111111', '#10b981', '#d97706', '#999999'];

export default function ConversionFunnel({ leads = [], reviews = [] }) {
  const totalLeads = leads.length;
  const hotLeads = leads.filter(l => l.status === 'hot').length;
  const warmLeads = leads.filter(l => l.status === 'warm').length;
  const respondedReviews = reviews.filter(r => r.response_status === 'responded').length;

  const data = [
    { name: 'סה"כ לידים', value: totalLeads },
    { name: 'לידים חמים', value: hotLeads },
    { name: 'לידים פושרים', value: warmLeads },
    { name: 'ביקורות שנענו', value: respondedReviews },
  ];

  const hotRate = totalLeads > 0 ? Math.round((hotLeads / totalLeads) * 100) : 0;
  const responseRate = reviews.length > 0 ? Math.round((respondedReviews / reviews.length) * 100) : 0;

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5">
      <h3 className="text-[14px] font-semibold text-[#222222] mb-1">משפך המרה</h3>
      <p className="text-[10px] text-[#cccccc] mb-4">אחוזי המרה מלידים ללקוחות פוטנציאליים</p>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
            <XAxis type="number" tick={{ fill: '#cccccc', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" tick={{ fill: '#999999', fontSize: 11 }} axisLine={false} tickLine={false} width={85} />
            <Tooltip contentStyle={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 10, fontSize: 12, direction: 'rtl' }} />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={20}>
              {data.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-4">
        <div className="bg-[#fafafa] rounded-[10px] p-3 text-center">
          <span className="text-2xl font-bold text-[#10b981]">{hotRate}%</span>
          <p className="text-[10px] text-[#999999] mt-0.5">אחוז לידים חמים</p>
        </div>
        <div className="bg-[#fafafa] rounded-[10px] p-3 text-center">
          <span className="text-2xl font-bold text-[#111111]">{responseRate}%</span>
          <p className="text-[10px] text-[#999999] mt-0.5">אחוז מענה לביקורות</p>
        </div>
      </div>
    </div>
  );
}