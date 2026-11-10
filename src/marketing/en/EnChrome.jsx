import React from 'react';
import { CtaButton } from '../ui/primitives.jsx';

/* English nav + footer for the /en pages. Same look as layout/Nav.jsx and Footer.jsx, left-to-right. */

const LINKS = [
  { label: 'How it works', href: '/en#how' },
  { label: 'Sample report', href: '/en#sample' },
  { label: 'Pricing', href: '/en#pricing' },
];

export const START_HREF = '/sign-up?briefing=1';

function Wordmark({ height = 30 }) {
  return (
    <a href="/en" aria-label="Cortexi — home">
      <img src="/logo/cortexi-logo-nav.png" alt="Cortexi" width={Math.round(height * 2.6)} height={height} style={{ height, width: 'auto' }} />
    </a>
  );
}

export function EnNav() {
  return (
    <header
      className="sticky top-0 z-50 border-b"
      style={{ background: 'rgba(250,250,251,0.82)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderColor: 'var(--mkt-border)' }}
    >
      <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between" aria-label="Main">
        <div className="flex items-center gap-8">
          <Wordmark />
          <div className="hidden md:flex items-center gap-6 text-[14px] font-medium" style={{ color: 'var(--mkt-ink-2)' }}>
            {LINKS.map((l) => <a key={l.href} href={l.href} className="hover:text-black">{l.label}</a>)}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a href="/sign-in" className="hidden sm:block text-[14px] font-medium hover:text-black" style={{ color: 'var(--mkt-ink-2)' }}>Sign in</a>
          <CtaButton href={START_HREF} variant="gradient" className="!h-10 !px-5 text-[14px]">Start free</CtaButton>
        </div>
      </nav>
    </header>
  );
}

export function EnFooter() {
  return (
    <footer className="border-t" style={{ borderColor: 'var(--mkt-border)', background: 'var(--mkt-surface)' }}>
      <div className="max-w-6xl mx-auto px-6 py-12 flex flex-col md:flex-row gap-8 md:items-start md:justify-between">
        <div className="max-w-sm">
          <Wordmark height={36} />
          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: 'var(--mkt-muted)' }}>
            A short report on what your competitors posted, advertised and offered, and what their customers said.
          </p>
          <p className="mt-3 text-[12px]" style={{ color: 'var(--mkt-muted)' }}>Inspired by the brain. Built for intelligence.</p>
        </div>
        <div className="flex gap-14 text-[13.5px]">
          <div>
            <div className="font-bold text-[13px] mb-3" style={{ color: 'var(--mkt-ink)' }}>Product</div>
            <ul className="space-y-2">
              {LINKS.map((l) => <li key={l.href}><a href={l.href} className="hover:text-black" style={{ color: 'var(--mkt-muted)' }}>{l.label}</a></li>)}
            </ul>
          </div>
          <div>
            <div className="font-bold text-[13px] mb-3" style={{ color: 'var(--mkt-ink)' }}>Contact</div>
            <a href="mailto:contact@cortexi.ai" className="hover:text-black" style={{ color: 'var(--mkt-muted)' }}>contact@cortexi.ai</a>
          </div>
        </div>
      </div>
      <div className="border-t" style={{ borderColor: 'var(--mkt-border)' }}>
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col md:flex-row items-center justify-between gap-2 text-[12.5px]" style={{ color: 'var(--mkt-muted)' }}>
          <span>© 2026 Cortexi. All rights reserved.</span>
          <a href={START_HREF} className="font-bold hover:text-black" style={{ color: 'var(--mkt-ink-2)' }}>Get your first report free — no card</a>
        </div>
      </div>
    </footer>
  );
}
