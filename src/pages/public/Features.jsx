import React from 'react';
import { base44 } from '@/api/base44Client';
import { IntelligenceMockup, ReviewsMockup, LeadsMockup, RetentionMockup } from '@/components/public/FeatureMockup';

const G = 'linear-gradient(135deg, #7B2FBE 0%, #E8344D 55%, #FF8C00 100%)';
const gradientText = { background: G, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' };

const sections = [
  {
    title: 'מודיעין שוק — תדע לפני כולם',
    desc: 'Cortexi סורקת את הרשת 24/7 ומביאה לך תובנות פעולתיות. כל שינוי אצל מתחרה, כל מגמה חדשה, כל הזדמנות — אתה הראשון לדעת.',
    Mockup: IntelligenceMockup,
    bullets: ['ניתוח סנטימנט אוטומטי', 'מקורות מקושרים לכל תובנה', 'התראות לשינויים קריטיים'],
  },
  {
    title: 'ניהול מוניטין — כל ביקורת מכל פלטפורמה',
    desc: 'ביקורות מגוגל, פייסבוק, אינסטגרם, וולט, 10bis ועוד — הכל במקום אחד. תגובות AI מותאמות לטון שלך בלחיצה.',
    Mockup: ReviewsMockup,
    bullets: ['סריקה מ-8 פלטפורמות', 'תגובות AI מקצועיות', 'התראה מיידית על ביקורות שליליות'],
  },
  {
    title: 'לידים חכמים — מהזיהוי לסגירה',
    desc: 'Cortexi מזהה לקוחות פוטנציאליים ברשת, מנקדת אותם, ומייצרת הודעות מותאמות. Pipeline מלא עם גרירה.',
    Mockup: LeadsMockup,
    bullets: ['ניקוד אוטומטי 0-100', 'זיהוי כוונת קנייה', 'Pipeline CRM מובנה'],
  },
  {
    title: 'שימור לקוחות — תגובה לפני שמאבדים',
    desc: 'Cortexi מזהה לקוחות בסיכון, מייצרת סקרי שביעות רצון אוטומטיים, ושולחת הודעות WhatsApp מותאמות לחזרה.',
    Mockup: RetentionMockup,
    bullets: ['זיהוי נטישה מוקדם', 'סקרי NPS אוטומטיים', 'הודעות שימור מותאמות'],
  },
];

export default function Features() {
  return (
    <div className="min-h-screen" style={{ background: '#0A0A0F' }}>
      <section className="px-6 pt-20 pb-12 max-w-5xl mx-auto text-center">
        <h1 className="text-[32px] md:text-[40px] font-bold text-white mb-4">
          כל מה שעסק קטן צריך כדי <span style={gradientText}>לנצח</span>
        </h1>
        <p className="text-[15px] max-w-2xl mx-auto" style={{ color: '#9090A8' }}>
          8 סוכנים חכמים, מאות מקורות, תובנה ראשונה תוך 60 שניות.
        </p>
      </section>

      {sections.map((section, i) => (
        <section
          key={i}
          className="px-6 py-16"
          style={{ background: i % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent' }}
        >
          <div className="max-w-5xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
            <div className={i % 2 === 1 ? 'order-2' : ''}>
              <h2 className="text-[22px] font-bold text-white mb-3">{section.title}</h2>
              <p className="text-[13px] leading-relaxed mb-5" style={{ color: '#9090A8' }}>{section.desc}</p>
              <ul className="space-y-2">
                {section.bullets.map(b => (
                  <li key={b} className="flex items-center gap-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#E8344D' }} /> {b}
                  </li>
                ))}
              </ul>
            </div>
            <div className={i % 2 === 1 ? 'order-1' : ''}>
              <section.Mockup />
            </div>
          </div>
        </section>
      ))}

      {/* CTA */}
      <section className="px-6 py-20" style={{ background: G }}>
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-[28px] font-bold text-white mb-4">מוכן לנסות?</h2>
          <p className="text-[14px] text-white/80 mb-8">הרשמה חינם. בלי כרטיס אשראי.</p>
          <button
            onClick={() => base44.auth.redirectToLogin()}
            className="px-10 py-4 rounded-xl text-[14px] font-semibold hover:opacity-90 transition-all"
            style={{ background: '#0A0A0F', color: '#ffffff' }}
          >
            התחל עכשיו ←
          </button>
        </div>
      </section>
    </div>
  );
}
