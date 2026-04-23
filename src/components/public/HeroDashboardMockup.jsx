import React from 'react';

export default function HeroDashboardMockup() {
  return (
    <div className="relative" style={{ perspective: '1000px' }}>
      <div
        className="bg-white border border-[#eee] rounded-2xl overflow-hidden"
        style={{
          boxShadow: '0 20px 60px rgba(0,0,0,0.06)',
          transform: 'rotateY(-3deg)',
          maxHeight: '440px',
          animation: 'float 6s ease-in-out infinite',
        }}
      >
        <div className="flex">
          {/* Mini sidebar */}
          <div className="w-10 bg-[#fafafa] border-l border-[#f0f0f0] hidden sm:flex flex-col items-center py-3 gap-3">
            <div className="w-4 h-4 rounded bg-[#e5e5e5]" />
            <div className="w-4 h-4 rounded bg-[#10b981]/20" />
            <div className="w-4 h-4 rounded bg-[#e5e5e5]" />
            <div className="w-4 h-4 rounded bg-[#e5e5e5]" />
          </div>

          {/* Content */}
          <div className="flex-1 p-4">
            {/* Morning briefing */}
            <div className="bg-[#fafafa] rounded-lg p-3 mb-3" style={{ borderRight: '2px solid #10b981' }}>
              <p className="text-[9px] font-semibold text-[#111] mb-1.5">תדריך בוקר</p>
              <div className="space-y-1">
                <p className="text-[8px] text-[#444]">🔴 ביקורת שלילית חדשה — דורשת תגובה</p>
                <p className="text-[8px] text-[#444]">🟢 3 לידים חמים חדשים באזור שלך</p>
                <p className="text-[8px] text-[#444]">🟡 המתחרה שינה מחירים — שקול להגיב</p>
              </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-4 gap-2 mb-3">
              {[
                { n: '15', l: 'תובנות', c: '3 דחופות' },
                { n: '7', l: 'מתחרים', c: '1 שינוי' },
                { n: '6', l: 'ביקורות', c: '2 ממתינות' },
                { n: '11', l: 'לידים', c: '4 חמים' },
              ].map((card, i) => (
                <div key={i} className="bg-white border border-[#f0f0f0] rounded-lg p-2">
                  <p className="text-[7px] text-[#999]">{card.l}</p>
                  <p className="text-[14px] font-bold text-[#111]">{card.n}</p>
                  <p className="text-[6px] text-[#10b981]">{card.c}</p>
                </div>
              ))}
            </div>

            {/* Insights column hint */}
            <div className="space-y-1.5">
              {['תובנה: ביקוש עולה ל...', 'מתחרה חדש באזור...', 'הזדמנות: נישה פנוי...'].map((text, i) => (
                <div key={i} className="flex items-center gap-1.5 bg-white border border-[#f0f0f0] rounded-md px-2 py-1.5">
                  <div className="w-1 h-4 rounded-full" style={{ backgroundColor: ['#dc2626', '#10b981', '#d97706'][i] }} />
                  <p className="text-[7px] text-[#555] flex-1">{text}</p>
                  <p className="text-[6px] text-[#ccc]">לפני שעה</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes float {
          0%, 100% { transform: rotateY(-3deg) translateY(0); }
          50% { transform: rotateY(-3deg) translateY(-5px); }
        }
      `}</style>
    </div>
  );
}