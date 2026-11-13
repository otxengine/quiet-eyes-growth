import React, { useEffect } from 'react';
import '../marketing/styles/tokens.css';
import { base44 } from '@/api/base44Client';

/* Shell and small controls for the English report-only screens. Same tokens and card style as the
   English landing page (src/marketing/en), left-to-right. */

export function BriefingShell({ children, nav, signOut = true }) {
  // The app document is lang="he" dir="rtl"; these screens flip it while they are mounted.
  useEffect(() => {
    const el = document.documentElement;
    const prev = { lang: el.lang, dir: el.dir, title: document.title };
    el.lang = 'en';
    el.dir = 'ltr';
    document.title = 'Cortexi — Competitor report';
    return () => { el.lang = prev.lang; el.dir = prev.dir; document.title = prev.title; };
  }, []);

  return (
    <div className="mkt-root min-h-screen flex flex-col" dir="ltr" lang="en">
      <header className="border-b bg-white" style={{ borderColor: 'var(--mkt-border)' }}>
        <div className="max-w-4xl mx-auto px-6 min-h-16 py-2 sm:py-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <a href="/en" aria-label="Cortexi — home">
            <img src="/logo/cortexi-logo-nav.png" alt="Cortexi" width={78} height={30} className="h-[30px] w-auto" />
          </a>
          {nav}
          {signOut && (
            <button type="button" onClick={() => base44.auth.logout('/en')} className="text-[13.5px] font-medium whitespace-nowrap hover:text-black" style={{ color: 'var(--mkt-muted)' }}>
              Sign out
            </button>
          )}
        </div>
      </header>
      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-10">{children}</main>
    </div>
  );
}

export function Card({ className = '', children, ...rest }) {
  return <div className={`mkt-card p-5 md:p-6 ${className}`} {...rest}>{children}</div>;
}

export function Button({ variant = 'black', className = '', disabled, children, ...rest }) {
  const styles = {
    gradient: { background: 'var(--mkt-grad)', color: '#fff' },
    black: { background: 'var(--mkt-ink)', color: '#fff' },
    ghost: { background: 'var(--mkt-surface)', color: 'var(--mkt-ink)', border: '1px solid var(--mkt-border-strong)' },
  };
  return (
    <button
      type="button"
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 h-11 text-[14px] font-bold transition-transform duration-150 enabled:hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      style={styles[variant]}
      {...rest}
    >
      {children}
    </button>
  );
}

export function TextInput({ className = '', ...rest }) {
  return (
    <input
      className={`w-full h-11 rounded-xl border bg-white px-3.5 text-[14.5px] outline-none focus:border-black ${className}`}
      style={{ borderColor: 'var(--mkt-border-strong)', color: 'var(--mkt-ink)' }}
      {...rest}
    />
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return <p role="alert" className="text-[13.5px] font-medium" style={{ color: '#B42318' }}>{children}</p>;
}

export function Spinner({ label }) {
  return (
    <div className="flex items-center gap-3 text-[14px]" style={{ color: 'var(--mkt-ink-2)' }} role="status">
      <span className="w-5 h-5 rounded-full border-2 border-[#E8E8EC] border-t-[#101014] animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

export function StepHeading({ step, title, sub }) {
  return (
    <div className="mb-6">
      {step && <div className="text-[13px] font-extrabold mkt-grad-text">{step}</div>}
      <h1 className="mt-1 text-[26px] md:text-[30px] leading-tight">{title}</h1>
      {sub && <p className="mt-2 text-[15px]" style={{ color: 'var(--mkt-ink-2)' }}>{sub}</p>}
    </div>
  );
}
