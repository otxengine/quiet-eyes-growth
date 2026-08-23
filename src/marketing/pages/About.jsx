import React from 'react';
import { Container, Section, GradientText, CtaButton } from '../ui/primitives.jsx';
import useReveal from '../lib/useReveal.js';

// Product values — carried over from the existing About page (they're accurate)
const VALUES = [
  { title: 'שקיפות מלאה', body: 'כל המלצה מגיעה עם הסבר ומקור. אין קופסה שחורה — רואים למה המערכת ממליצה מה שהיא ממליצה.' },
  { title: 'רלוונטיות לפני כמות', body: 'לא עוד פיד אינסופי. המערכת מסננת ומתעדפת, ומציגה רק מה שדורש החלטה שלך.' },
  { title: 'מהירות לפעולה', body: 'כל תובנה מסתיימת בפעולה: טקסט מוכן, שלבי ביצוע ואומדן זמן. לא דוחות למגירה.' },
  { title: 'בנוי לעסקים קטנים', body: 'בעברית, במחיר של עסק קטן, ובלי צורך באיש שיווק במשרה מלאה.' },
];

export default function About() {
  const revealRef = useReveal();

  return (
    <div ref={revealRef}>
      <div className="relative">
        <div className="absolute inset-0 mkt-dotgrid mkt-dotgrid-fade" aria-hidden="true" />
        <Container className="relative pt-16 md:pt-24 pb-12 text-center">
          <h1 className="text-[32px] md:text-[44px] leading-tight max-w-3xl mx-auto">
            מודיעין ברמת Enterprise. <GradientText>לעסק הקטן.</GradientText>
          </h1>
          <p className="mt-5 text-[16px] leading-relaxed max-w-2xl mx-auto" style={{ color: 'var(--mkt-ink-2)' }}>
            הרשתות הגדולות מעסיקות מחלקות שלמות שעוקבות אחרי מתחרים, מנתחות ביקורות ומתזמנות קמפיינים.
            לעסק הקטן אין את זה — ולרוב גם אין זמן. את הפער הזה Cortexi באה לסגור.
          </p>
        </Container>
      </div>

      <Section className="!pt-4">
        <Container className="max-w-3xl">
          <div className="mkt-card mkt-reveal p-8 md:p-10 space-y-5 text-[15px] leading-relaxed" style={{ color: 'var(--mkt-ink-2)' }}>
            <h2 className="text-[22px]">למה בנינו את Cortexi</h2>
            <p>
              בעל עסק קטן בישראל מנהל בו-זמנית תפעול, לקוחות, עובדים — ובשעות שנשארות, גם שיווק.
              בינתיים מתחרה פותח מבצע, ביקורת שלילית יושבת בגוגל בלי מענה, וטרנד שהיה יכול להביא לקוחות עובר לידו.
            </p>
            <p>
              Cortexi הופכת את המשוואה: המערכת עוקבת אחרי השוק, המתחרים, הביקורות והרשתות מסביב לשעון,
              מבינה מה חשוב, ומגישה כל בוקר רשימה קצרה של פעולות מוכנות — עם טקסט כתוב, הסבר ואומדן זמן.
              העסק לא צריך ללמוד עוד מערכת. הוא צריך רק לאשר.
            </p>
            <p>
              החזון שלנו: כל עסק קטן מנהל את השיווק שלו בשיחה אחת ביום — והמערכת עושה את השאר.
            </p>
          </div>
        </Container>
      </Section>

      <Section className="!pt-0">
        <Container>
          <h2 className="mkt-reveal text-center text-[26px] md:text-[32px] mb-8">מה מנחה אותנו</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {VALUES.map((v) => (
              <div key={v.title} className="mkt-card mkt-reveal p-6">
                <h3 className="text-[16px]">{v.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed" style={{ color: 'var(--mkt-ink-2)' }}>{v.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* Founders — placeholders only, no invented bios */}
      <Section className="!pt-0">
        <Container className="max-w-3xl">
          <h2 className="mkt-reveal text-center text-[26px] md:text-[32px] mb-8">מי מאחורי Cortexi</h2>
          {/* TODO: TAL — ביוגרפיות מייסדים: שם, תפקיד, שורת רקע, תמונה (אופציונלי) */}
          <div className="grid sm:grid-cols-2 gap-4">
            {[1, 2].map((i) => (
              <div key={i} className="mkt-card mkt-reveal p-6 text-center">
                <div className="w-16 h-16 rounded-full mx-auto" style={{ background: 'var(--mkt-border)' }} aria-hidden="true" />
                <div className="mt-4 font-bold text-[15px]" style={{ color: 'var(--mkt-muted)' }}>שם המייסד/ת</div>
                <div className="mt-1 text-[13px]" style={{ color: 'var(--mkt-muted)' }}>תפקיד · שורת רקע קצרה</div>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section className="!pt-0 pb-24">
        <Container className="text-center mkt-reveal">
          <h2 className="text-[26px] md:text-[32px]">רוצים לראות את זה על העסק שלכם?</h2>
          <div className="mt-6 flex items-center justify-center gap-3">
            <CtaButton href="/sign-up" variant="gradient">התחילו בחינם</CtaButton>
            <CtaButton href="/contact" variant="ghost">דברו איתנו</CtaButton>
          </div>
        </Container>
      </Section>
    </div>
  );
}
