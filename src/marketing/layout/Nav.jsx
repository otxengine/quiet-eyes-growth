import React, { useState } from 'react';
import { ChevronDown, Menu, X } from 'lucide-react';
import { MODULES, featurePath } from '../content/modules.js';
import { SparkIcon, CtaButton } from '../ui/primitives.jsx';

const NAV_LINKS = [
  { label: 'מחירים', href: '/pricing' },
  { label: 'איך זה עובד', href: '/how-it-works' },
  { label: 'אודות', href: '/about' },
  { label: 'צור קשר', href: '/contact' },
];

function Wordmark() {
  return (
    <a href="/" className="flex items-center gap-2 font-extrabold text-[19px] tracking-tight" style={{ color: 'var(--mkt-ink)' }}>
      <SparkIcon size={20} />
      Cortexi
    </a>
  );
}

export default function Nav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header
      className="sticky top-0 z-50 border-b"
      style={{
        background: 'rgba(250,250,251,0.82)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderColor: 'var(--mkt-border)',
      }}
    >
      <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between" aria-label="ניווט ראשי">
        <div className="flex items-center gap-8">
          <Wordmark />

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-6 text-[14px] font-medium" style={{ color: 'var(--mkt-ink-2)' }}>
            {/* מוצר dropdown — open on hover/focus, pure CSS visibility via group */}
            <div className="relative group">
              <button
                type="button"
                className="flex items-center gap-1 py-5 hover:text-black"
                aria-haspopup="true"
              >
                מוצר
                <ChevronDown size={14} className="transition-transform group-hover:rotate-180" aria-hidden="true" />
              </button>
              <div className="absolute right-0 top-full pt-1 hidden group-hover:block group-focus-within:block">
                <div className="mkt-card shadow-xl p-2 w-64">
                  {MODULES.map((m) => (
                    <a
                      key={m.slug}
                      href={featurePath(m.slug)}
                      className="block rounded-lg px-3 py-2.5 hover:bg-[#F4F4F6]"
                    >
                      <span className="block font-bold text-[13.5px]" style={{ color: 'var(--mkt-ink)' }}>{m.label}</span>
                      <span className="block text-[12px] leading-snug mt-0.5" style={{ color: 'var(--mkt-muted)' }}>{m.oneLiner}</span>
                    </a>
                  ))}
                  <a href="/features" className="block rounded-lg px-3 py-2.5 text-[13px] font-bold hover:bg-[#F4F4F6]" style={{ color: 'var(--mkt-ink-2)' }}>
                    כל היכולות ←
                  </a>
                </div>
              </div>
            </div>

            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="hover:text-black">{l.label}</a>
            ))}
          </div>
        </div>

        <div className="hidden md:flex items-center gap-3">
          <a href="/sign-in" className="text-[14px] font-medium hover:text-black" style={{ color: 'var(--mkt-ink-2)' }}>
            התחברות
          </a>
          <CtaButton href="/sign-up" variant="gradient" className="!h-10 !px-5 text-[14px]">
            התחל בחינם
          </CtaButton>
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          className="md:hidden p-2 -m-2"
          aria-label={mobileOpen ? 'סגור תפריט' : 'פתח תפריט'}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </nav>

      {/* Mobile panel */}
      {mobileOpen && (
        <div className="md:hidden border-t px-6 py-4 space-y-1 bg-white" style={{ borderColor: 'var(--mkt-border)' }}>
          <div className="text-[12px] font-bold uppercase py-2" style={{ color: 'var(--mkt-muted)' }}>מוצר</div>
          {MODULES.map((m) => (
            <a key={m.slug} href={featurePath(m.slug)} className="block py-2 text-[15px] font-medium" style={{ color: 'var(--mkt-ink)' }}>
              {m.label}
            </a>
          ))}
          <div className="h-px my-2" style={{ background: 'var(--mkt-border)' }} />
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="block py-2 text-[15px] font-medium" style={{ color: 'var(--mkt-ink)' }}>
              {l.label}
            </a>
          ))}
          <div className="pt-3 flex items-center gap-3">
            <CtaButton href="/sign-up" variant="gradient" className="flex-1 !h-11 text-[14px]">התחל בחינם</CtaButton>
            <CtaButton href="/sign-in" variant="ghost" className="flex-1 !h-11 text-[14px]">התחברות</CtaButton>
          </div>
        </div>
      )}
    </header>
  );
}
