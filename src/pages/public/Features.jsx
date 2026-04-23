import React from 'react';
import { base44 } from '@/api/base44Client';
import { IntelligenceMockup, ReviewsMockup, LeadsMockup, RetentionMockup } from '@/components/public/FeatureMockup';

const sections = [
  {
    title: 'מודיעין שוק — תדע לפני כולם',
    desc: '8 סוכני AI סורקים את הרשת 24/7 ומביאים לך תובנות פעולתיות. כל שינוי אצל מתחרה, כל מגמה חדשה, כל הזדמנות — אתה הראשון לדעת.',
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
    desc: 'המערכת מזהה לקוחות פוטנציאליים ברשת, מנקדת אותם, ומייצרת הודעות מותאמות. Pipeline מלא עם גרירה.',
    Mockup: LeadsMockup,
    bullets: ['ניקוד אוטומטי 0-100', 'זיהוי כוונת קנייה', 'Pipeline CRM מובנה'],
  },
  {
    title: 'שימור לקוחות — תגובה לפני שמאבדים',
    desc: 'זיהוי לקוחות בסיכון, סקרי שביעות רצון אוטומטיים, והודעות WhatsApp מותאמות לחזרה.',
    Mockup: RetentionMockup,
    bullets: ['זיהוי נטישה מוקדם', 'סקרי NPS אוטומטיים', 'הודעות שימור מותאמות'],
  },
];

export default function Features() {
  return (
    <div className="min-h-screen">
      <section className="px-6 pt-20 pb-12 max-w-5xl mx-auto text-center">
        <h1 className="text-[32px] md:text-[40px] font-bold text-foreground mb-4">כל מה שעסק קטן צריך כדי לנצח</h1>
        <p className="text-[15px] text-foreground-muted max-w-2xl mx-auto">8 סוכנים חכמים, מאות מקורות, תובנה ראשונה תוך 60 שניות.</p>
      </section>

      {sections.map((section, i) => (
        <section key={i} className={`px-6 py-16 ${i % 2 === 1 ? 'bg-secondary/30' : ''}`}>
          <div className="max-w-5xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
            <div className={i % 2 === 1 ? 'order-2' : ''}>
              <h2 className="text-[22px] font-bold text-foreground mb-3">{section.title}</h2>
              <p className="text-[13px] text-foreground-muted leading-relaxed mb-5">{section.desc}</p>
              <ul className="space-y-2">
                {section.bullets.map(b => (
                  <li key={b} className="flex items-center gap-2 text-[12px] text-foreground-secondary">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" /> {b}
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
      <section className="px-6 py-20 bg-foreground">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-[28px] font-bold text-background mb-4">מוכן לנסות?</h2>
          <p className="text-[14px] text-background/70 mb-8">הרשמה חינם. בלי כרטיס אשראי.</p>
          <button onClick={() => base44.auth.redirectToLogin()} className="px-10 py-4 rounded-xl bg-background text-foreground text-[14px] font-semibold hover:opacity-90 transition-all">
            התחל עכשיו ←
          </button>
        </div>
      </section>
    </div>
  );
}