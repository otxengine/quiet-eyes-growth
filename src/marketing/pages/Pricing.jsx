import React from 'react';
import { Check } from 'lucide-react';
import { Container, Section, GradientText, CtaButton, Faq } from '../ui/primitives.jsx';
import { PLANS, ENTERPRISE, QUOTA_ROWS, PRICING_FAQ } from '../content/pricing.js';
import useReveal from '../lib/useReveal.js';

export default function Pricing() {
  const revealRef = useReveal();

  return (
    <div ref={revealRef}>
      {/* Hero */}
      <div className="relative">
        <div className="absolute inset-0 mkt-dotgrid mkt-dotgrid-fade" aria-hidden="true" />
        <Container className="relative pt-16 md:pt-20 pb-10 text-center">
          <h1 className="text-[32px] md:text-[44px] leading-tight">
            תמחור פשוט. <GradientText>לפי סניף.</GradientText>
          </h1>
          <p className="mt-4 text-[15.5px] max-w-xl mx-auto" style={{ color: 'var(--mkt-ink-2)' }}>
            מתחילים בחינם — בלי כרטיס אשראי ובלי הגבלת זמן. משדרגים כשהעסק צריך יותר. חיוב חודשי, ביטול בכל עת.
          </p>
        </Container>
      </div>

      {/* Plan cards */}
      <Container>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`mkt-card mkt-reveal p-6 flex flex-col relative ${plan.highlighted ? 'shadow-[0_20px_50px_-20px_rgba(236,30,99,0.25)]' : ''}`}
              style={plan.highlighted ? { borderColor: '#EC1E63', borderWidth: 1.5 } : undefined}
            >
              {plan.highlighted && (
                <span className="absolute -top-3 right-6 text-[11px] font-bold text-white rounded-full px-3 py-1" style={{ background: 'var(--mkt-grad)' }}>
                  הכי פופולרי
                </span>
              )}
              <h2 className="text-[18px]">{plan.name}</h2>
              <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--mkt-muted)' }}>{plan.description}</p>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-[34px] font-extrabold" style={{ letterSpacing: '-0.02em' }}>{plan.price}</span>
                <span className="text-[12px]" style={{ color: 'var(--mkt-muted)' }}>{plan.period}</span>
              </div>
              <ul className="mt-5 space-y-2.5 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[13px]" style={{ color: 'var(--mkt-ink-2)' }}>
                    <Check size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--mkt-ink)' }} aria-hidden="true" />
                    {f}
                  </li>
                ))}
              </ul>
              <CtaButton
                href="/sign-up"
                variant={plan.highlighted ? 'gradient' : 'ghost'}
                className="mt-6 w-full !h-11 text-[14px]"
              >
                {plan.cta}
              </CtaButton>
            </div>
          ))}
        </div>

        {/* Enterprise strip */}
        <div className="mkt-card mkt-reveal mt-4 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4" style={{ background: 'var(--mkt-ink)', borderColor: 'var(--mkt-ink)' }}>
          <div>
            <h2 className="text-[18px] text-white">{ENTERPRISE.name}</h2>
            <p className="text-[13px] mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>{ENTERPRISE.description}</p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {ENTERPRISE.bullets.map((b) => (
                <span key={b} className="text-[12.5px] flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  <Check size={13} aria-hidden="true" /> {b}
                </span>
              ))}
            </div>
          </div>
          <CtaButton href={ENTERPRISE.mailto} variant="ghost" className="!h-11 text-[14px] shrink-0">
            דברו איתנו
          </CtaButton>
        </div>

        <p className="mkt-reveal text-center mt-6 text-[12.5px]" style={{ color: 'var(--mkt-muted)' }}>
          המחיר הוא לסניף — עסק עם כמה סניפים משלם לפי מספר הסניפים · ללא התחייבות · קופוני הנחה נתמכים בתשלום
        </p>
      </Container>

      {/* What's included — quota comparison */}
      <Section>
        <Container>
          <h2 className="mkt-reveal text-center text-[26px] md:text-[32px]">מה כלול בכל תוכנית</h2>
          <div className="mkt-card mkt-reveal mt-8 overflow-x-auto">
            <table className="w-full text-[13px]" style={{ minWidth: 640 }}>
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--mkt-border)' }}>
                  <th className="text-right p-4 font-bold" style={{ color: 'var(--mkt-muted)' }}>יכולת</th>
                  {PLANS.map((p) => (
                    <th key={p.id} className="p-4 font-extrabold text-center" style={{ color: 'var(--mkt-ink)' }}>{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {QUOTA_ROWS.map((row, i) => (
                  <tr key={row.label} className={i % 2 ? '' : 'bg-[#FAFAFB]'}>
                    <td className="p-4 font-medium" style={{ color: 'var(--mkt-ink-2)' }}>{row.label}</td>
                    {row.values.map((v, j) => (
                      <td key={j} className="p-4 text-center" style={{ color: v === '—' ? 'var(--mkt-muted)' : 'var(--mkt-ink)' }}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </Section>

      {/* FAQ */}
      <Section className="!pt-0">
        <Container className="max-w-3xl">
          <h2 className="mkt-reveal text-center text-[26px] md:text-[32px] mb-8">שאלות על תמחור</h2>
          <div className="mkt-reveal">
            <Faq items={PRICING_FAQ} />
          </div>
        </Container>
      </Section>

      {/* CTA */}
      <Section className="!pt-0 pb-24">
        <Container className="text-center mkt-reveal">
          <h2 className="text-[26px] md:text-[32px]">מתחילים בחינם — עכשיו</h2>
          <p className="mt-3 text-[14.5px]" style={{ color: 'var(--mkt-muted)' }}>בלי כרטיס אשראי. תובנה ראשונה תוך 60 שניות.</p>
          <div className="mt-6">
            <CtaButton href="/sign-up" variant="gradient">התחילו בחינם</CtaButton>
          </div>
        </Container>
      </Section>
    </div>
  );
}
