import React from 'react';
import { Check } from 'lucide-react';
import { Container, Section, GradientText, CtaButton } from '../ui/primitives.jsx';
import useReveal from '../lib/useReveal.js';

const STEPS = [
  {
    n: '01',
    title: 'מגדירים את העסק — 30 שניות',
    body: 'שם, תחום ועיר. מכאן המערכת ממשיכה לבד: מזהה מתחרים, מילות מפתח ומקורות מידע רלוונטיים לתחום שלך, ואתה רק מאשר את הרשימה.',
    details: ['זיהוי מתחרים אוטומטי', 'מילות מפתח ומקורות לפי 44 קטגוריות עסקיות', 'אישור והתאמה בלחיצה'],
  },
  {
    n: '02',
    title: 'המערכת סורקת ולומדת',
    body: 'ביקורות מכל הפלטפורמות, פרופילי המתחרים, רשתות חברתיות ומגמות שוק. תובנה ראשונה מופיעה תוך 60 שניות מההרשמה — והסריקה ממשיכה ברקע כל הזמן.',
    details: ['אותות שוק כל 30 דקות', 'מגמות כל שעה, מתחרים כל 6 שעות', 'הכל מדורג לפי חשיבות לעסק שלך'],
  },
  {
    n: '03',
    title: 'מקבלים פעולות — ומאשרים',
    body: 'כל בוקר: בריף קצר עם 3–4 פעולות מוכנות. תגובה לביקורת כתובה, פוסט מוכן לפרסום, התראה על מהלך של מתחרה. שום דבר לא יוצא החוצה בלי אישור שלך.',
    details: ['טקסט מוכן לשימוש בכל פעולה', 'אומדן זמן והסבר "למה"', 'תיבת אישורים מרכזית'],
  },
];

export default function HowItWorks() {
  const revealRef = useReveal();

  return (
    <div ref={revealRef}>
      <div className="relative">
        <div className="absolute inset-0 mkt-dotgrid mkt-dotgrid-fade" aria-hidden="true" />
        <Container className="relative pt-16 md:pt-24 pb-12 text-center">
          <h1 className="text-[32px] md:text-[44px] leading-tight">
            מהרשמה לתובנה ראשונה — <GradientText>60 שניות</GradientText>
          </h1>
          <p className="mt-4 text-[15.5px] max-w-xl mx-auto" style={{ color: 'var(--mkt-ink-2)' }}>
            שלושה צעדים. בלי הגדרות מסובכות, בלי הדרכות ארוכות.
          </p>
        </Container>
      </div>

      <Section className="!pt-4">
        <Container className="max-w-3xl space-y-5">
          {STEPS.map((s) => (
            <div key={s.n} className="mkt-card mkt-reveal p-7 md:p-8">
              <div className="flex items-start gap-5">
                <div className="text-[15px] font-extrabold mkt-grad-text shrink-0 mt-1">{s.n}</div>
                <div>
                  <h2 className="text-[19px]">{s.title}</h2>
                  <p className="mt-2 text-[14.5px] leading-relaxed" style={{ color: 'var(--mkt-ink-2)' }}>{s.body}</p>
                  <ul className="mt-4 space-y-2">
                    {s.details.map((d) => (
                      <li key={d} className="flex items-start gap-2 text-[13.5px]" style={{ color: 'var(--mkt-ink-2)' }}>
                        <Check size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--mkt-ink)' }} aria-hidden="true" />
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </Container>
      </Section>

      <Section className="!pt-0 pb-24">
        <Container className="text-center mkt-reveal">
          <h2 className="text-[26px] md:text-[32px]">רוצים לראות מה המערכת תמצא על העסק שלכם?</h2>
          <div className="mt-6">
            <CtaButton href="/sign-up" variant="gradient">התחילו בחינם</CtaButton>
          </div>
          <p className="mt-4 text-[12.5px]" style={{ color: 'var(--mkt-muted)' }}>ללא כרטיס אשראי · ביטול בכל עת</p>
        </Container>
      </Section>
    </div>
  );
}
