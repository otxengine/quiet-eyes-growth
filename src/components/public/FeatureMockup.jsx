import React from 'react';

function MockupFrame({ children }) {
  return (
    <div className="rounded-2xl border border-[#eee] bg-white overflow-hidden max-w-[520px]" style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.06)' }}>
      {children}
    </div>
  );
}

export function IntelligenceMockup() {
  return (
    <MockupFrame>
      <div className="p-4 border-b border-[#f0f0f0]">
        <div className="flex gap-2 mb-3">
          {['הכל', 'איומים', 'הזדמנויות', 'מגמות'].map((t, i) => (
            <span key={t} className={`px-3 py-1 rounded-md text-[9px] font-medium ${i === 0 ? 'bg-[#111] text-white' : 'bg-[#f5f5f5] text-[#999]'}`}>{t}</span>
          ))}
        </div>
      </div>
      <div className="p-3 space-y-2">
        {[
          { color: '#dc2626', text: 'מתחרה פתח סניף חדש ב-500 מטר ממך', time: 'לפני 2 שעות', impact: 'השפעה גבוהה' },
          { color: '#10b981', text: 'ביקוש עולה לשירותי פרימיום — 35% יותר חיפושים', time: 'לפני 4 שעות', impact: 'הזדמנות' },
          { color: '#d97706', text: 'מגמה: לקוחות עוברים להזמנות אונליין', time: 'אתמול', impact: 'מגמה' },
        ].map((s, i) => (
          <div key={i} className="rounded-lg p-3 bg-[#fafafa] hover:bg-[#f5f5f5] transition-colors" style={{ borderRight: `2.5px solid ${s.color}` }}>
            <p className="text-[10px] font-medium text-[#222] mb-1">{s.text}</p>
            <div className="flex items-center gap-2">
              <span className="text-[8px] font-semibold" style={{ color: s.color }}>{s.impact}</span>
              <span className="text-[8px] text-[#bbb]">{s.time}</span>
              <span className="text-[8px] text-primary mr-auto">צפה במקור ←</span>
            </div>
          </div>
        ))}
      </div>
    </MockupFrame>
  );
}

export function ReviewsMockup() {
  return (
    <MockupFrame>
      <div className="p-4 border-b border-[#f0f0f0]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-[#222]">מוניטין</span>
          <span className="px-3 py-1 rounded-md text-[9px] font-medium bg-[#111] text-white">אסוף ביקורות</span>
        </div>
      </div>
      <div className="p-3 space-y-2">
        {[
          { stars: 2, name: 'דנה כ.', platform: 'Google Maps', text: 'השירות היה איטי ולא ענו לטלפון...', sentiment: 'שלילי', sentColor: '#dc2626' },
          { stars: 5, name: 'אבי מ.', platform: 'Facebook', text: 'מקום מדהים! חוזרים בהחלט!', sentiment: 'חיובי', sentColor: '#10b981' },
        ].map((r, i) => (
          <div key={i} className="rounded-lg border border-[#f0f0f0] p-3" style={{ borderRight: `2px solid ${r.sentColor}` }}>
            <div className="flex items-center gap-1 mb-1">
              {Array.from({ length: 5 }, (_, j) => (
                <span key={j} className={`text-[10px] ${j < r.stars ? 'text-[#d97706]' : 'text-[#ddd]'}`}>★</span>
              ))}
              <span className="text-[8px] text-[#bbb] mr-1">{r.platform}</span>
              <span className="text-[8px] text-[#999]">{r.name}</span>
            </div>
            <p className="text-[9px] text-[#555] mb-1.5">{r.text}</p>
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded-full text-[7px] font-medium" style={{ background: `${r.sentColor}10`, color: r.sentColor }}>{r.sentiment}</span>
              {r.stars <= 3 && <span className="px-2 py-0.5 rounded text-[8px] font-medium bg-[#111] text-white">הצע תגובה מקצועית</span>}
            </div>
          </div>
        ))}
      </div>
    </MockupFrame>
  );
}

export function LeadsMockup() {
  return (
    <MockupFrame>
      <div className="p-4 border-b border-[#f0f0f0]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-[#222]">לידים</span>
          <div className="flex gap-1.5">
            <span className="px-2 py-0.5 rounded text-[8px] bg-[#111] text-white">רשימה</span>
            <span className="px-2 py-0.5 rounded text-[8px] bg-[#f5f5f5] text-[#999]">Pipeline</span>
          </div>
        </div>
      </div>
      <div className="p-3 space-y-2">
        {[
          { name: 'שרה לוי', score: 92, service: 'שירות פרימיום', intent: true, budget: '₪5,000' },
          { name: 'יוסי כהן', score: 88, service: 'ייעוץ עסקי', intent: false, budget: '₪3,000' },
          { name: 'מיכל אב.', score: 64, service: 'חבילה בסיסית', intent: false, budget: '₪1,500' },
        ].map((l, i) => (
          <div key={i} className="rounded-lg border border-[#f0f0f0] p-3 flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold text-white ${l.score >= 80 ? 'bg-[#10b981]' : l.score >= 60 ? 'bg-[#d97706]' : 'bg-[#999]'}`}>{l.score}</div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-medium text-[#222]">{l.name}</p>
              <p className="text-[8px] text-[#999]">{l.service} · {l.budget}</p>
            </div>
            {l.intent && <span className="px-1.5 py-0.5 rounded-full text-[7px] font-bold bg-purple-50 text-purple-600 border border-purple-100">כוונת קנייה</span>}
          </div>
        ))}
      </div>
      {/* Pipeline bar */}
      <div className="px-3 pb-3">
        <div className="flex rounded-lg overflow-hidden text-[7px] font-medium">
          <div className="bg-gray-100 text-gray-600 px-2 py-1 flex-1 text-center">3 חדש</div>
          <div className="bg-blue-50 text-blue-600 px-2 py-1 flex-1 text-center">5 קשר</div>
          <div className="bg-amber-50 text-amber-600 px-2 py-1 flex-1 text-center">2 פגישה</div>
          <div className="bg-green-50 text-green-600 px-2 py-1 flex-1 text-center">8 נסגר</div>
        </div>
      </div>
    </MockupFrame>
  );
}

export function RetentionMockup() {
  return (
    <MockupFrame>
      <div className="p-4 border-b border-[#f0f0f0]">
        <span className="text-[11px] font-semibold text-[#222]">שימור לקוחות</span>
      </div>
      <div className="p-3 space-y-2">
        <div className="rounded-lg bg-[#fef2f2] border border-[#fecaca] p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-bold text-[#dc2626]">⚠️ בסיכון</span>
            <span className="text-[9px] text-[#999]">3 לקוחות</span>
          </div>
          <p className="text-[9px] text-[#555]">לקוחות שלא חזרו מעל 30 יום</p>
        </div>
        <div className="rounded-lg border border-[#f0f0f0] p-3">
          <span className="text-[9px] font-medium text-[#222] block mb-1.5">הודעת WhatsApp מוכנה:</span>
          <div className="bg-[#dcf8c6] rounded-lg p-2 text-[9px] text-[#333]">
            היי דנה! 👋 לא ראינו אותך כבר חודש. חשבנו עלייך ורצינו להציע הנחה מיוחדת...
          </div>
        </div>
        <div className="rounded-lg border border-[#f0f0f0] p-3">
          <span className="text-[9px] font-medium text-[#222] block mb-1">סקר שביעות רצון</span>
          <div className="flex gap-1">
            {[1,2,3,4,5].map(n => (
              <span key={n} className={`w-6 h-6 rounded flex items-center justify-center text-[10px] ${n === 4 ? 'bg-[#d97706] text-white' : 'bg-[#f5f5f5] text-[#999]'}`}>{n}</span>
            ))}
          </div>
        </div>
      </div>
    </MockupFrame>
  );
}