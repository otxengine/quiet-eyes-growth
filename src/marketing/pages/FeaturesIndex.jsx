import React from 'react';
import { Star, Eye, Lightbulb, Megaphone, Users, Percent, Calendar, Check } from 'lucide-react';
import { Container, Section, GradientText, CtaButton } from '../ui/primitives.jsx';
import { MODULES, featurePath } from '../content/modules.js';
import useReveal from '../lib/useReveal.js';

const ICONS = { star: Star, eye: Eye, lightbulb: Lightbulb, megaphone: Megaphone, users: Users, percent: Percent, calendar: Calendar };

export default function FeaturesIndex() {
  const revealRef = useReveal();

  return (
    <div ref={revealRef}>
      <div className="relative">
        <div className="absolute inset-0 mkt-dotgrid mkt-dotgrid-fade" aria-hidden="true" />
        <Container className="relative pt-16 md:pt-24 pb-12 text-center">
          <h1 className="text-[32px] md:text-[44px] leading-tight">
            7 מודולים. <GradientText>מערכת אחת.</GradientText>
          </h1>
          <p className="mt-4 text-[15.5px] max-w-xl mx-auto" style={{ color: 'var(--mkt-ink-2)' }}>
            כל מודול פותר כאב אמיתי של עסק קטן — וכולם מזינים זה את זה באותו מוח.
          </p>
        </Container>
      </div>

      <Section className="!pt-4 pb-24">
        <Container>
          <div className="grid md:grid-cols-2 gap-5">
            {MODULES.map((m) => {
              const Icon = ICONS[m.icon];
              return (
                <a
                  key={m.slug}
                  href={featurePath(m.slug)}
                  className="mkt-card mkt-reveal p-7 flex flex-col hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: '#F4F4F6' }}>
                      <Icon size={20} style={{ color: 'var(--mkt-ink)' }} aria-hidden="true" />
                    </span>
                    <h2 className="text-[19px]">{m.label}</h2>
                  </div>
                  <p className="mt-3 text-[14px] leading-relaxed" style={{ color: 'var(--mkt-muted)' }}>{m.oneLiner}</p>
                  <ul className="mt-4 space-y-2 flex-1">
                    {m.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2 text-[13.5px]" style={{ color: 'var(--mkt-ink-2)' }}>
                        <Check size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--mkt-ink)' }} aria-hidden="true" />
                        {b}
                      </li>
                    ))}
                  </ul>
                  <span className="mt-5 text-[13.5px] font-bold" style={{ color: 'var(--mkt-ink)' }}>לעמוד המלא ←</span>
                </a>
              );
            })}
          </div>

          <div className="text-center mt-14 mkt-reveal">
            <CtaButton href="/sign-up" variant="gradient">התחל בחינם</CtaButton>
          </div>
        </Container>
      </Section>
    </div>
  );
}
