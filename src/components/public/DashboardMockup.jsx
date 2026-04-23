import React from 'react';

export default function DashboardMockup() {
  return (
    <div className="relative w-full max-w-[560px] mx-auto" style={{ perspective: '1200px' }}>
      <div className="rounded-2xl border border-[#e8e8e8] bg-white overflow-hidden" style={{ transform: 'rotateY(-3deg) rotateX(2deg)', boxShadow: '0 20px 60px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)' }}>
        {/* Morning briefing */}
        <div className="p-4 border-b border-[#f0f0f0] bg-[#fafafa]" style={{ borderRight: '3px solid #10b981' }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-semibold text-[#222]">תדריך בוקר</span>
            <span className="w-[5px] h-[5px] rounded-full bg-[#10b981]" />
            <span className="text-[9px] text-[#999]">לפני 12 דקות</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[10px]"><span>🔴</span><span className="text-[#444]">ביקורת שלילית חדשה מגוגל — דורשת תגובה מיידית</span></div>
            <div className="flex items-center gap-2 text-[10px]"><span>🔥</span><span className="text-[#444]">3 לידים חמים חדשים — ציון 90+ — צור קשר היום</span></div>
            <div className="flex items-center gap-2 text-[10px]"><span>📊</span><span className="text-[#444]">מתחרה הוריד מחירים ב-15% — שקול תגובה</span></div>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-4 gap-2 p-4">
          {[
            { label: 'תובנות', value: '12', change: '+3' },
            { label: 'מתחרים', value: '8', change: null },
            { label: 'ביקורות', value: '47', change: '+5' },
            { label: 'לידים', value: '23', change: '+7' },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-[#f0f0f0] p-2.5 bg-white">
              <p className="text-[8px] text-[#999] mb-0.5">{s.label}</p>
              <span className="text-[18px] font-bold text-[#111] leading-none">{s.value}</span>
              {s.change && <span className="text-[8px] text-[#10b981] font-semibold block mt-0.5">{s.change}</span>}
            </div>
          ))}
        </div>

        {/* Insights preview */}
        <div className="px-4 pb-4 space-y-1.5">
          <span className="text-[9px] font-semibold text-[#999]">תובנות אחרונות</span>
          {[
            { color: '#dc2626', text: 'המתחרה הוסיף שירות חדש שמתחרה ישירות בשלך' },
            { color: '#10b981', text: 'הזדמנות: ביקוש גובר ל-שירותי פרימיום באזור' },
            { color: '#d97706', text: 'מגמה: עלייה של 20% בחיפושים של הקטגוריה שלך' },
          ].map((s, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg bg-[#fafafa] p-2" style={{ borderRight: `2px solid ${s.color}` }}>
              <p className="text-[9px] text-[#555] leading-relaxed">{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}