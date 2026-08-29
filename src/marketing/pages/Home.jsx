import React from 'react';
import { Star, Eye, Lightbulb, Megaphone, Users, Percent, Calendar, Check } from 'lucide-react';
import { Container, Section, GradientText, Badge, CtaButton } from '../ui/primitives.jsx';
import { MODULES, featurePath } from '../content/modules.js';
import DashboardWindowMockup from '../mockups/DashboardWindowMockup.jsx';
import DailyBriefCard from '../mockups/DailyBriefCard.jsx';
import useReveal from '../lib/useReveal.js';
import useParallax from '../lib/useParallax.js';

const MODULE_ICONS = { star: Star, eye: Eye, lightbulb: Lightbulb, megaphone: Megaphone, users: Users, percent: Percent, calendar: Calendar };

// From src/pages/public/Home.jsx SECTORS + sectorSites.ts (44 categories)
const SECTORS = ['🍕 מסעדות', '💪 כושר', '💇 יופי', '🏥 רפואה', '🛒 קמעונאות', '🏗️ שיפוצים'];

// Every number sourced in docs/midsite-content-audit.md §3.7 — no agent counts (user decision)
const TECH_STATS = [
  { value: '30 דק׳', label: 'סריקת אותות שוק', sub: 'חיפוש, פורומים, חדשות וביקורות' },
  { value: 'כל שעה', label: 'זיהוי מגמות בסקטור', sub: 'זינוקים סטטיסטיים, לא ניחושים' },
  { value: '6 שעות', label: 'צילום מצב מתחרים', sub: 'רק שינויים — בלי רעש' },
  { value: '12', label: 'שלבי עיבוד לכל אות', sub: 'מאיסוף ועד המלצה מנומקת' },
  { value: '8', label: 'מנועי הזדמנויות במקביל', sub: 'פערי ביקוש, תמחור, תזמון ועוד' },
  { value: '9', label: 'גורמים מנוקדים לכל המלצה', sub: 'רק מה שעובר סף מגיע אליך' },
  { value: '8', label: 'פלטפורמות ביקורות', sub: 'Google, Facebook, TripAdvisor ועוד' },
  { value: '44', label: 'קטגוריות עסקיות בישראל', sub: 'מקורות מידע ייעודיים לכל תחום' },
];

const INTEGRATIONS = ['Facebook', 'Instagram', 'TikTok', 'Google Business', 'Google Ads', 'Meta Ads', 'WhatsApp'];

const STEPS = [
  {
    n: '01',
    title: 'מגדירים את העסק',
    body: 'שם, תחום ועיר — והמערכת מזהה לבד את המתחרים, מילות המפתח ומקורות המידע הרלוונטיים.',
  },
  {
    n: '02',
    title: 'המערכת סורקת ולומדת',
    body: 'ביקורות, מתחרים, רשתות חברתיות ומגמות — תובנה ראשונה תוך 60 שניות מההרשמה.',
  },
  {
    n: '03',
    title: 'מקבלים פעולות ומאשרים',
    body: 'אוטומציות לעסקים — עם רסן: כל המלצה מגיעה עם הסבר, טקסט מוכן ואומדן זמן, ושום דבר לא מתפרסם בלי אישור שלך.',
  },
];

function SectionHeading({ eyebrow, title, sub }) {
  return (
    <div className="text-center max-w-2xl mx-auto mkt-reveal">
      {eyebrow && (
        <div className="text-[13px] font-bold mb-3 mkt-grad-text">{eyebrow}</div>
      )}
      <h2 className="text-[28px] md:text-[36px] leading-tight">{title}</h2>
      {sub && <p className="mt-3 text-[15.5px] leading-relaxed" style={{ color: 'var(--mkt-muted)' }}>{sub}</p>}
    </div>
  );
}

export default function Home() {
  const revealRef = useReveal();
  const dotgridRef = useParallax(0.045, { clamp: 14 });
  const windowRef = useParallax(0.10, { clamp: 26 });
  const headlineRef = useParallax(-0.16, { clamp: 34 });
  const ctaRef = useParallax(-0.16, { clamp: 34 });

  return (
    <div ref={revealRef}>
      {/* ── Hero: headline+CTA row, then a "look into the system" window ─── */}
      <div className="relative">
        <div ref={dotgridRef} className="absolute inset-0 mkt-dotgrid mkt-dotgrid-fade" aria-hidden="true" />
        <Container className="relative pt-16 md:pt-20 pb-16">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 text-center md:text-right">
            <div ref={headlineRef} className="max-w-xl mx-auto md:mx-0">
              <Badge>Inspired by the brain. Built for intelligence.</Badge>
              <h1 className="mt-6 text-[32px] md:text-[46px] leading-[1.12]">
                מערכת <GradientText>AI</GradientText> לשיווק דיגיטלי, ניהול מוניטין ומעקב מתחרים
              </h1>
              <p className="mt-5 text-[16px] leading-relaxed" style={{ color: 'var(--mkt-ink-2)' }}>
                בינה מלאכותית לעסקים קטנים: Cortexi עוקבת אחרי השוק, המתחרים והביקורות שלך מסביב לשעון, ומגישה פעולות מוכנות — בעברית. אתה רק מאשר.
              </p>
            </div>

            <div ref={ctaRef} className="flex flex-col items-center md:items-end gap-3 shrink-0 mx-auto md:mx-0">
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <CtaButton href="/sign-up" variant="gradient">התחל בחינם</CtaButton>
                <CtaButton href="/how-it-works" variant="ghost">איך זה עובד</CtaButton>
              </div>
              <p className="text-[12.5px]" style={{ color: 'var(--mkt-muted)' }}>
                ללא כרטיס אשראי · ביטול בכל עת · תובנה ראשונה תוך 60 שניות
              </p>
            </div>
          </div>

          <div ref={windowRef} className="mt-14">
            <DashboardWindowMockup />
          </div>
        </Container>
      </div>

      {/* ── Daily-brief teaser strip ─────────────────────────────────────── */}
      <Container>
        <a
          href="#daily-brief"
          className="mkt-card mkt-reveal flex items-center justify-between gap-4 px-5 py-4 hover:shadow-md transition-shadow"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-[10.5px] font-bold rounded-full px-2 py-0.5 shrink-0" style={{ color: '#DC2626', background: '#FEF2F2' }}>דחוף</span>
            <span className="text-[13.5px] font-medium truncate" style={{ color: 'var(--mkt-ink-2)' }}>
              ⭐ ביקורת 2 כוכבים חדשה בגוגל — טיוטת תגובה מוכנה לאישור · 3 דק׳
            </span>
          </div>
          <span className="text-[13px] font-bold shrink-0" style={{ color: 'var(--mkt-ink)' }}>כך נראה הבוקר שלך ←</span>
        </a>
      </Container>

      {/* ── Sectors strip ────────────────────────────────────────────────── */}
      <Section className="!py-14">
        <Container className="text-center mkt-reveal">
          <p className="text-[13px] font-bold mb-4" style={{ color: 'var(--mkt-muted)' }}>מותאם ל-44 קטגוריות עסקיות בישראל</p>
          <div className="flex flex-wrap justify-center gap-2.5">
            {SECTORS.map((s) => (
              <span key={s} className="mkt-card px-4 py-2 text-[13.5px] font-medium" style={{ color: 'var(--mkt-ink-2)' }}>{s}</span>
            ))}
            <span className="px-4 py-2 text-[13.5px] font-medium" style={{ color: 'var(--mkt-muted)' }}>ועוד 38 קטגוריות…</span>
          </div>
        </Container>
      </Section>

      {/* ── Feature grid — one card per real module ──────────────────────── */}
      <Section className="!pt-4">
        <Container>
          <SectionHeading
            eyebrow="7 מודולים, מערכת אחת"
            title="כל מה שעסק צריך כדי לדעת — ולפעול"
            sub="כל מודול קיים במוצר בדיוק כפי שהוא מוצג כאן. בלי הבטחות עתידיות."
          />
          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {MODULES.map((m) => {
              const Icon = MODULE_ICONS[m.icon];
              return (
                <a
                  key={m.slug}
                  href={featurePath(m.slug)}
                  className="mkt-card mkt-reveal p-6 flex flex-col hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
                >
                  <span className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#F4F4F6' }}>
                    <Icon size={19} style={{ color: 'var(--mkt-ink)' }} aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 text-[17px]">{m.label}</h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed" style={{ color: 'var(--mkt-muted)' }}>{m.oneLiner}</p>
                  <ul className="mt-4 space-y-2 flex-1">
                    {m.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2 text-[13px]" style={{ color: 'var(--mkt-ink-2)' }}>
                        <Check size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--mkt-ink)' }} aria-hidden="true" />
                        {b}
                      </li>
                    ))}
                  </ul>
                  <span className="mt-5 text-[13px] font-bold" style={{ color: 'var(--mkt-ink)' }}>למודול {m.label} ←</span>
                </a>
              );
            })}
          </div>
        </Container>
      </Section>

      {/* ── Daily-brief deep dive ────────────────────────────────────────── */}
      <Section id="daily-brief" style={{ background: 'var(--mkt-surface)' }} className="border-y" >
        <Container>
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="mkt-reveal">
              <div className="text-[13px] font-bold mb-3 mkt-grad-text">בריף יומי</div>
              <h2 className="text-[28px] md:text-[34px] leading-tight">
                כל בוקר: 3–4 פעולות. לא פיד אינסופי.
              </h2>
              <p className="mt-4 text-[15.5px] leading-relaxed" style={{ color: 'var(--mkt-ink-2)' }}>
                המערכת קוראת בשבילך את הביקורות, הלידים, המתחרים והאותות — ומצמצמת הכל לרשימה קצרה של מה שבאמת דורש אותך היום.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  'כל פעולה עם סיבה קונקרטית ומספר — לא ניסוחים כלליים',
                  'תעדוף קשיח: ביקורת שלילית תמיד ראשונה',
                  'אומדן זמן לכל פעולה — רוב הבוקר נגמר ברבע שעה',
                  'לחיצה אחת מובילה ישר למסך הביצוע',
                ].map((b) => (
                  <li key={b} className="flex items-start gap-2.5 text-[14.5px]" style={{ color: 'var(--mkt-ink-2)' }}>
                    <Check size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--mkt-ink)' }} aria-hidden="true" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mkt-reveal flex justify-center">
              <DailyBriefCard />
            </div>
          </div>
        </Container>
      </Section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <Section>
        <Container>
          <SectionHeading eyebrow="שלושה צעדים" title="מהרשמה לתובנה ראשונה — 60 שניות" />
          <div className="mt-12 grid md:grid-cols-3 gap-5">
            {STEPS.map((s) => (
              <div key={s.n} className="mkt-card mkt-reveal p-6">
                <div className="text-[13px] font-extrabold mkt-grad-text">{s.n}</div>
                <h3 className="mt-3 text-[17px]">{s.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed" style={{ color: 'var(--mkt-ink-2)' }}>{s.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── Dark tech section — the real numbers ─────────────────────────── */}
      <Section style={{ background: 'var(--mkt-ink)' }}>
        <Container>
          <div className="text-center max-w-2xl mx-auto mkt-reveal">
            <div className="text-[13px] font-bold mb-3 mkt-grad-text">מתחת למכסה</div>
            <h2 className="text-[28px] md:text-[36px] leading-tight text-white">
              מנוע מודיעין שעובד גם כשאתה לא
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>
              המספרים כפי שהם במערכת — בלי עיגולים שיווקיים.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-2 lg:grid-cols-4 gap-4">
            {TECH_STATS.map((s) => (
              <div key={s.label} className="mkt-reveal rounded-2xl p-5 border" style={{ borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)' }}>
                <div className="text-[26px] font-extrabold text-white" style={{ letterSpacing: '-0.02em' }}>{s.value}</div>
                <div className="mt-1 text-[13.5px] font-bold" style={{ color: 'rgba(255,255,255,0.85)' }}>{s.label}</div>
                <div className="mt-1 text-[12px] leading-snug" style={{ color: 'rgba(255,255,255,0.45)' }}>{s.sub}</div>
              </div>
            ))}
          </div>
          <div className="mt-10 mkt-reveal">
            <p className="text-center text-[12.5px] font-bold mb-4" style={{ color: 'rgba(255,255,255,0.45)' }}>מתחבר למקומות שבהם העסק שלך כבר חי</p>
            <div className="flex flex-wrap justify-center gap-2.5">
              {INTEGRATIONS.map((name) => (
                <span key={name} className="rounded-full border px-4 py-1.5 text-[13px] font-medium" style={{ borderColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.75)' }}>
                  {name}
                </span>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <Section>
        <Container className="text-center mkt-reveal">
          <h2 className="text-[30px] md:text-[40px] leading-tight">
            תפסיק לנחש. <GradientText>התחל לדעת.</GradientText>
          </h2>
          <p className="mt-4 text-[15.5px]" style={{ color: 'var(--mkt-muted)' }}>
            תוכנית חינם לתמיד. בלי כרטיס אשראי. תובנה ראשונה תוך 60 שניות.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <CtaButton href="/sign-up" variant="gradient">התחל בחינם</CtaButton>
            <CtaButton href="/pricing" variant="ghost">לתוכניות ומחירים</CtaButton>
          </div>
        </Container>
      </Section>
    </div>
  );
}
