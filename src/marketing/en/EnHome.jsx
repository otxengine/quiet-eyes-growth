import React from 'react';
import { Check, Minus, Search } from 'lucide-react';
import { Container, Section, GradientText, Badge, CtaButton, Faq } from '../ui/primitives.jsx';
import { EN_PLANS, EN_FAQ, planFeatures } from './plans.js';
import { START_HREF } from './EnChrome.jsx';
import useReveal from '../lib/useReveal.js';

/* English landing page for the competitor report (the only product sold outside Israel).
   Same sections and components as pages/Home.jsx; copy describes only what the report does. */

const STEPS = [
  { n: '01', title: 'Tell us your business', body: 'Name and city. We find it on Google and read what kind of business it is.' },
  { n: '02', title: 'Pick your competitors', body: 'We suggest nearby businesses of the same kind, with the pages we found for each. You choose who to watch.' },
  { n: '03', title: 'Get your report', body: 'The first one covers their last 30 days. After that it arrives by email, with a PDF, at 9am your time. WhatsApp delivery is coming soon.' },
];

const SOURCES = ['Instagram posts', 'Facebook posts', 'Meta ads', 'Instagram stories', 'Google reviews', 'Follower growth'];

// Illustrative example, labelled "Sample" in the window bar. Not a real business.
const SAMPLE_KPIS = [['14', 'New posts'], ['6', 'Active ads'], ['23', 'New reviews']];
const SAMPLE_ROWS = [
  { tag: 'New ad', tone: { color: '#DC2626', background: '#FEF2F2' }, text: 'Competitor A launched a 20% off lunch ad on Instagram.' },
  { tag: 'Reviews', tone: { color: 'var(--mkt-ink-2)', background: '#F4F4F6' }, text: 'Competitor B got 9 new reviews. 4 mention slow delivery.' },
  { tag: 'Offer', tone: { color: '#C2410C', background: '#FFF1E6' }, text: 'Competitor C is running 2-for-1 on Tuesdays, posted Monday.' },
];

function SectionHeading({ eyebrow, title, sub }) {
  return (
    <div className="text-center max-w-2xl mx-auto mkt-reveal">
      {eyebrow && <div className="text-[13px] font-bold mb-3 mkt-grad-text">{eyebrow}</div>}
      <h2 className="text-[28px] md:text-[36px] leading-tight">{title}</h2>
      {sub && <p className="mt-3 text-[15.5px] leading-relaxed" style={{ color: 'var(--mkt-muted)' }}>{sub}</p>}
    </div>
  );
}

function SampleReport() {
  return (
    <div
      id="sample"
      className="mkt-card overflow-hidden max-w-2xl mx-auto shadow-[0_30px_80px_-40px_rgba(16,16,20,0.35)]"
      role="img"
      aria-label="Sample weekly report: three numbers, three competitor moves and one recommended action"
    >
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b" style={{ borderColor: 'var(--mkt-border)', background: '#F4F4F6' }}>
        {[0, 1, 2].map((i) => <span key={i} className="w-2.5 h-2.5 rounded-full" style={{ background: '#DCDCE1' }} />)}
        <span className="ml-2 text-[12px]" style={{ color: 'var(--mkt-muted)' }}>Sample · Weekly report · Mar 2–8</span>
      </div>
      <div className="p-5 md:p-6 text-left">
        <div className="text-[11px] font-bold tracking-wide" style={{ color: 'var(--mkt-muted)' }}>IN ONE LINE</div>
        <h3 className="mt-1 text-[19px] leading-snug">Two competitors pushed discounts this week; one is losing reviews over delivery.</h3>
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          {SAMPLE_KPIS.map(([v, l]) => (
            <div key={l} className="rounded-xl px-3.5 py-3" style={{ background: '#F4F4F6' }}>
              <div className="text-[24px] font-extrabold" style={{ letterSpacing: '-0.02em' }}>{v}</div>
              <div className="text-[12px]" style={{ color: 'var(--mkt-muted)' }}>{l}</div>
            </div>
          ))}
        </div>
        <ul className="mt-4">
          {SAMPLE_ROWS.map((r) => (
            <li key={r.tag} className="flex items-start gap-2.5 py-2.5 border-t text-[13.5px]" style={{ borderColor: 'var(--mkt-border)', color: 'var(--mkt-ink-2)' }}>
              <span className="text-[10.5px] font-bold rounded-full px-2 py-0.5 shrink-0 mt-0.5" style={r.tone}>{r.tag}</span>
              {r.text}
            </li>
          ))}
          <li className="flex items-start gap-2.5 py-2.5 border-t text-[13.5px]" style={{ borderColor: 'var(--mkt-border)' }}>
            <span className="text-[12px] font-bold shrink-0 mt-0.5 mkt-grad-text">What to do</span>
            <span style={{ color: 'var(--mkt-ink)' }}>Post your delivery times this week, and answer the lunch discount with a combo of your own.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

export default function EnHome() {
  const revealRef = useReveal();

  return (
    <div ref={revealRef}>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="relative">
        <div className="absolute inset-0 mkt-dotgrid mkt-dotgrid-fade" aria-hidden="true" />
        <Container className="relative pt-16 md:pt-20 pb-16 text-center">
          <Badge>Competitor report for local businesses</Badge>
          <h1 className="mt-6 text-[34px] md:text-[50px] leading-[1.1] max-w-3xl mx-auto">
            Know what your <GradientText>competitors</GradientText> did this week
          </h1>
          <p className="mt-5 text-[16.5px] leading-relaxed max-w-xl mx-auto" style={{ color: 'var(--mkt-ink-2)' }}>
            Their new posts, ads, stories and Google reviews, in one short email — with what to do about it.
          </p>

          {/* Plain GET form: works on the prerendered page with no JavaScript. */}
          <form action="/sign-up" method="get" className="mt-8 max-w-xl mx-auto">
            <input type="hidden" name="briefing" value="1" />
            <div className="flex items-center gap-2 rounded-full border bg-white pl-5 pr-1.5 h-14" style={{ borderColor: 'var(--mkt-border-strong)' }}>
              <Search size={18} style={{ color: 'var(--mkt-muted)' }} aria-hidden="true" />
              <input
                type="text"
                name="business"
                aria-label="Your business name and city"
                placeholder="Joe's Pizza, Austin TX"
                maxLength={120}
                className="flex-1 min-w-0 bg-transparent outline-none text-[15px]"
                style={{ color: 'var(--mkt-ink)' }}
              />
              <button
                type="submit"
                className="shrink-0 rounded-full px-5 sm:px-6 h-11 text-[14.5px] font-bold text-white transition-transform duration-150 hover:scale-[1.02] active:scale-[0.99]"
                style={{ background: 'var(--mkt-grad)' }}
              >
                Find my competitors
              </button>
            </div>
          </form>
          <p className="mt-3 text-[12.5px]" style={{ color: 'var(--mkt-muted)' }}>
            First report free · No credit card · Cancel anytime
          </p>

          <div className="mt-14"><SampleReport /></div>
        </Container>
      </div>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <Section id="how" className="!pt-8">
        <Container>
          <SectionHeading eyebrow="Three steps" title="From sign-up to your first report in minutes" />
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

      {/* ── What we watch (dark) ─────────────────────────────────────────── */}
      <Section style={{ background: 'var(--mkt-ink)' }}>
        <Container>
          <div className="text-center max-w-2xl mx-auto mkt-reveal">
            <div className="text-[13px] font-bold mb-3 mkt-grad-text">What we watch</div>
            <h2 className="text-[28px] md:text-[36px] leading-tight text-white">Six sources, one short email</h2>
            <p className="mt-3 text-[15px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Built from public pages. Nothing to connect, nothing to install.
            </p>
          </div>
          <div className="mt-10 flex flex-wrap justify-center gap-2.5 mkt-reveal">
            {SOURCES.map((name) => (
              <span key={name} className="rounded-full border px-4 py-1.5 text-[13.5px] font-medium" style={{ borderColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.8)' }}>
                {name}
              </span>
            ))}
          </div>
          <p className="mt-8 text-center text-[13px] mkt-reveal" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Offers and promos are found in posts, ads and stories and summarized by AI.
          </p>
        </Container>
      </Section>

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <Section id="pricing">
        <Container>
          <SectionHeading
            eyebrow="Pricing"
            title="Start free. Upgrade when it pays off."
            sub="Every plan starts with a free report on the last 30 days. Prices are in USD, billed monthly."
          />
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 items-stretch">
            {EN_PLANS.map((plan) => (
              <div
                key={plan.id}
                className={`mkt-card mkt-reveal p-6 flex flex-col relative ${plan.highlighted ? 'shadow-[0_20px_50px_-20px_rgba(236,30,99,0.25)]' : ''}`}
                style={plan.highlighted ? { borderColor: '#EC1E63', borderWidth: 1.5 } : undefined}
              >
                {plan.highlighted && (
                  <span className="absolute -top-3 left-6 text-[11px] font-bold text-white rounded-full px-3 py-1" style={{ background: 'var(--mkt-grad)' }}>
                    Most popular
                  </span>
                )}
                <h3 className="text-[18px]">{plan.name}</h3>
                <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--mkt-muted)' }}>{plan.cadence}</p>
                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="text-[36px] font-extrabold" style={{ letterSpacing: '-0.02em' }}>{plan.price}</span>
                  <span className="text-[12.5px]" style={{ color: 'var(--mkt-muted)' }}>/month</span>
                </div>
                <ul className="mt-5 space-y-2.5 flex-1 text-[13px]" style={{ color: 'var(--mkt-ink-2)' }}>
                  {planFeatures(plan).map((f) => (
                    <li key={f.text} className="flex items-start gap-2" style={f.on ? undefined : { color: 'var(--mkt-muted)' }}>
                      {f.on
                        ? <Check size={14} className="mt-0.5 shrink-0" style={{ color: f.accent ? '#EC1E63' : 'var(--mkt-ink)' }} aria-hidden="true" />
                        : <Minus size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
                      {f.text}
                    </li>
                  ))}
                </ul>
                <CtaButton href={START_HREF} variant={plan.highlighted ? 'gradient' : 'ghost'} className="mt-6 w-full !h-11 !px-3 text-[13.5px] whitespace-nowrap">
                  {plan.cta}
                </CtaButton>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-[13px] mkt-reveal" style={{ color: 'var(--mkt-muted)' }}>
            Stories disappear after 24 hours, so on paid plans they are collected every day. Reports arrive by email at 9am
            in your time zone; WhatsApp delivery is coming soon.
          </p>
        </Container>
      </Section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <Section className="!pt-0">
        <Container className="max-w-3xl">
          <SectionHeading title="Questions" />
          <div className="mt-8 mkt-reveal"><Faq items={EN_FAQ} /></div>
        </Container>
      </Section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <Section style={{ background: 'var(--mkt-surface)' }} className="border-t">
        <Container className="text-center mkt-reveal">
          <h2 className="text-[30px] md:text-[40px] leading-tight">
            Stop guessing. <GradientText>Start knowing.</GradientText>
          </h2>
          <p className="mt-4 text-[15.5px]" style={{ color: 'var(--mkt-muted)' }}>
            Your first report is free and covers the last 30 days.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <CtaButton href={START_HREF} variant="gradient">Find my competitors</CtaButton>
            <CtaButton href="/en#sample" variant="ghost">See a sample report</CtaButton>
          </div>
        </Container>
      </Section>
    </div>
  );
}
