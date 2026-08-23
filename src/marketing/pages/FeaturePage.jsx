import React from 'react';
import { Container, Section, GradientText, Badge, CtaButton, Faq } from '../ui/primitives.jsx';
import { MODULES, featurePath } from '../content/modules.js';
import ModuleMockup from '../mockups/ModuleMockup.jsx';
import useReveal from '../lib/useReveal.js';

/**
 * The single template behind every /features/[module] page. All content comes
 * from FEATURE_PAGES[slug] (content/featurePages.js) — pages stay thin wrappers.
 */
export default function FeaturePage({ slug, data }) {
  const revealRef = useReveal();
  const others = MODULES.filter((m) => m.slug !== slug).slice(0, 3);

  // H1 with the gradient word highlighted, preserving one <h1> per page
  const renderH1Line = (line) => {
    if (!data.gradientWord || !line.includes(data.gradientWord)) return line;
    const [before, after] = line.split(data.gradientWord);
    return (
      <>
        {before}
        <GradientText>{data.gradientWord}</GradientText>
        {after}
      </>
    );
  };

  return (
    <div ref={revealRef}>
      {/* Hero */}
      <div className="relative">
        <div className="absolute inset-0 mkt-dotgrid mkt-dotgrid-fade" aria-hidden="true" />
        <Container className="relative pt-16 md:pt-24 pb-14">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="text-center lg:text-right">
              <Badge>מודול {data.label}</Badge>
              <h1 className="mt-5 text-[30px] md:text-[42px] leading-[1.15]">
                {data.h1.map((line, i) => (
                  <span key={line} className="block">{i === 0 ? renderH1Line(line) : line}</span>
                ))}
              </h1>
              <p className="mt-5 text-[15.5px] leading-relaxed max-w-lg mx-auto lg:mx-0" style={{ color: 'var(--mkt-ink-2)' }}>
                {data.sub}
              </p>
              <div className="mt-8 flex flex-col sm:flex-row items-center lg:justify-start justify-center gap-3">
                <CtaButton href="/sign-up" variant="gradient">התחל בחינם</CtaButton>
                <CtaButton href="/pricing" variant="ghost">לתוכניות ומחירים</CtaButton>
              </div>
            </div>
            <div className="flex justify-center">
              <ModuleMockup spec={data.mockup} />
            </div>
          </div>
        </Container>
      </div>

      {/* Benefits */}
      <Section style={{ background: 'var(--mkt-surface)' }} className="border-y">
        <Container>
          <div className="grid md:grid-cols-2 gap-5">
            {data.benefits.map((b, i) => (
              <div key={b.title} className="mkt-reveal p-6 rounded-2xl" style={{ background: 'var(--mkt-canvas)', border: '1px solid var(--mkt-border)' }}>
                <div className="text-[13px] font-extrabold mkt-grad-text">{String(i + 1).padStart(2, '0')}</div>
                <h2 className="mt-2 text-[17px]">{b.title}</h2>
                <p className="mt-2 text-[14px] leading-relaxed" style={{ color: 'var(--mkt-ink-2)' }}>{b.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* FAQ */}
      <Section>
        <Container className="max-w-3xl">
          <h2 className="mkt-reveal text-center text-[24px] md:text-[30px] mb-8">שאלות נפוצות</h2>
          <div className="mkt-reveal">
            <Faq items={data.faq} />
          </div>
        </Container>
      </Section>

      {/* Cross-links + CTA */}
      <Section className="!pt-0 pb-24">
        <Container>
          <div className="mkt-card mkt-reveal p-8 md:p-10 text-center">
            <h2 className="text-[24px] md:text-[28px]">
              {data.label} הוא מודול אחד מתוך שבעה
            </h2>
            <p className="mt-2 text-[14px]" style={{ color: 'var(--mkt-muted)' }}>
              אותה מערכת מכסה גם:
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {others.map((m) => (
                <a key={m.slug} href={featurePath(m.slug)} className="rounded-full border bg-white px-4 py-2 text-[13px] font-bold hover:shadow-sm" style={{ borderColor: 'var(--mkt-border-strong)', color: 'var(--mkt-ink)' }}>
                  {m.label}
                </a>
              ))}
              <a href="/features" className="rounded-full px-4 py-2 text-[13px] font-bold" style={{ color: 'var(--mkt-ink-2)' }}>
                כל היכולות ←
              </a>
            </div>
            <div className="mt-8">
              <CtaButton href="/sign-up" variant="gradient">התחל בחינם</CtaButton>
            </div>
            <p className="mt-3 text-[12px]" style={{ color: 'var(--mkt-muted)' }}>ללא כרטיס אשראי · תובנה ראשונה תוך 60 שניות</p>
          </div>
        </Container>
      </Section>
    </div>
  );
}
