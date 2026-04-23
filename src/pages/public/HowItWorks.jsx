import React from 'react';
import { base44 } from '@/api/base44Client';

const steps = [
  {
    number: '1',
    title: 'הרשמה — 30 שניות',
    desc: 'שם העסק, קטגוריה, עיר. זה הכל.',
    mockup: (
      <div className="rounded-2xl border border-[#eee] bg-white p-5 max-w-[380px]" style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.06)' }}>
        <span className="text-[11px] font-semibold text-[#222] block mb-3">הרשם ל-OTX</span>
        <div className="space-y-2.5">
          {[{ label: 'שם העסק', value: 'מסעדת הגינה' }, { label: 'קטגוריה', value: 'מסעדה' }, { label: 'עיר', value: 'תל אביב' }].map(f => (
            <div key={f.label}>
              <span className="text-[9px] text-[#999] block mb-0.5">{f.label}</span>
              <div className="rounded-lg border border-[#e8e8e8] bg-[#fafafa] px-3 py-2 text-[10px] text-[#444]">{f.value}</div>
            </div>
          ))}
          <div className="rounded-lg bg-[#111] text-white text-center py-2.5 text-[10px] font-semibold mt-2">התחל סריקה ←</div>
        </div>
      </div>
    ),
  },
  {
    number: '2',
    title: 'סריקה — 60 שניות',
    desc: 'הסוכנים שלנו סורקים את הרשת בשבילך.',
    mockup: (
      <div className="rounded-2xl border border-[#eee] bg-white p-5 max-w-[380px] text-center" style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.06)' }}>
        <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary mx-auto mb-3 animate-spin" style={{ animationDuration: '1.5s' }} />
        <span className="text-[12px] font-semibold text-[#222] block mb-2">סורק את הרשת...</span>
        <div className="space-y-1 text-[9px] text-[#999]">
          <p>✓ Google Maps — 12 ביקורות</p>
          <p>✓ Facebook — 8 ביקורות</p>
          <p className="text-primary animate-pulse">⟳ מנתח מתחרים...</p>
          <p className="text-[#ddd]">○ מייצר תובנות</p>
        </div>
      </div>
    ),
  },
  {
    number: '3',
    title: 'תובנה ראשונה',
    desc: 'תוך דקה אתה כבר יודע מה קורה בשוק שלך.',
    mockup: (
      <div className="rounded-2xl border border-[#eee] bg-white p-4 max-w-[380px]" style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.06)' }}>
        <span className="text-[10px] font-semibold text-[#222] block mb-2.5">🎉 נמצאו 3 תובנות חדשות</span>
        <div className="space-y-2">
          {[
            { color: '#dc2626', text: 'ביקורת שלילית בגוגל — דורשת תגובה מיידית', icon: '🔴' },
            { color: '#10b981', text: '2 לידים חמים זוהו — ציון 90+', icon: '🔥' },
            { color: '#d97706', text: 'מתחרה חדש נפתח ב-300 מטר', icon: '⚠️' },
          ].map((s, i) => (
            <div key={i} className="rounded-lg bg-[#fafafa] p-2.5 flex items-start gap-2" style={{ borderRight: `2px solid ${s.color}` }}>
              <span className="text-[11px]">{s.icon}</span>
              <p className="text-[9px] text-[#444]">{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    number: '4',
    title: 'דשבורד מלא — עכשיו אתה בשליטה',
    desc: 'תדריך בוקר, מודיעין שוק, לידים, מוניטין — הכל במקום אחד.',
    mockup: (
      <div className="rounded-2xl border border-[#eee] bg-white overflow-hidden max-w-[380px]" style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.06)' }}>
        <div className="p-3 border-b border-[#f0f0f0] bg-[#fafafa]" style={{ borderRight: '3px solid #10b981' }}>
          <span className="text-[9px] font-semibold text-[#222] block mb-1">תדריך בוקר</span>
          <div className="space-y-1">
            <p className="text-[8px] text-[#555]">🔴 ביקורת שלילית דורשת תגובה</p>
            <p className="text-[8px] text-[#555]">🔥 3 לידים חמים ממתינים</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1 p-2">
          {[{ v: '12', l: 'תובנות' }, { v: '8', l: 'מתחרים' }, { v: '47', l: 'ביקורות' }, { v: '23', l: 'לידים' }].map(c => (
            <div key={c.l} className="rounded-md border border-[#f0f0f0] p-1.5 text-center">
              <span className="text-[12px] font-bold text-[#111] block">{c.v}</span>
              <span className="text-[6px] text-[#999]">{c.l}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
];

export default function HowItWorks() {
  return (
    <div className="min-h-screen">
      <section className="px-6 pt-20 pb-12 max-w-5xl mx-auto text-center">
        <h1 className="text-[32px] md:text-[40px] font-bold text-foreground mb-4">מהרשמה לתובנה ראשונה — 60 שניות</h1>
        <p className="text-[15px] text-foreground-muted">ארבעה צעדים פשוטים. בלי הגדרות מסובכות.</p>
      </section>

      <section className="px-6 pb-20 max-w-5xl mx-auto">
        <div className="space-y-20">
          {steps.map((step, i) => (
            <div key={i} className={`grid lg:grid-cols-2 gap-12 items-center ${i % 2 === 1 ? 'direction-ltr' : ''}`}>
              <div className={i % 2 === 1 ? 'lg:order-2' : ''}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground text-[14px] font-bold flex items-center justify-center">{step.number}</span>
                  <h2 className="text-[20px] font-bold text-foreground">{step.title}</h2>
                </div>
                <p className="text-[14px] text-foreground-muted leading-relaxed">{step.desc}</p>
              </div>
              <div className={`flex justify-center ${i % 2 === 1 ? 'lg:order-1' : ''}`}>
                {step.mockup}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-20 bg-foreground">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-[28px] font-bold text-background mb-4">מוכן להתחיל?</h2>
          <p className="text-[14px] text-background/70 mb-8">הרשמה חינם. בלי כרטיס אשראי. תובנה ראשונה תוך 60 שניות.</p>
          <button onClick={() => base44.auth.redirectToLogin()} className="px-10 py-4 rounded-xl bg-background text-foreground text-[14px] font-semibold hover:opacity-90 transition-all">
            התחל עכשיו ←
          </button>
        </div>
      </section>
    </div>
  );
}