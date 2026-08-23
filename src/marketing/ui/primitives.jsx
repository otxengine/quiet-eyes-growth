import React from 'react';

/* Shared marketing primitives. Nothing here may import app code (@/components, @/lib, @/pages) —
   this tree must stay SSR-safe and bundle-lean for the standalone marketing entry. */

export function Container({ className = '', children }) {
  return <div className={`max-w-6xl mx-auto px-6 ${className}`}>{children}</div>;
}

export function Section({ className = '', children, ...rest }) {
  return (
    <section className={`py-16 md:py-24 ${className}`} {...rest}>
      {children}
    </section>
  );
}

export function GradientText({ children }) {
  return <span className="mkt-grad-text">{children}</span>;
}

export function SparkIcon({ size = 16, className = '' }) {
  // Four-point spark, filled with the accent gradient via SVG defs
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="mkt-spark-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#C1257F" />
          <stop offset="45%" stopColor="#EC1E63" />
          <stop offset="100%" stopColor="#F8793A" />
        </linearGradient>
      </defs>
      <path
        fill="url(#mkt-spark-grad)"
        d="M12 2c.6 4.8 2.4 6.9 7.5 7.5-5.1.6-6.9 2.7-7.5 7.5-.6-4.8-2.4-6.9-7.5-7.5C9.6 8.9 11.4 6.8 12 2Zm7 12c.3 2.4 1.2 3.4 3.7 3.7-2.5.3-3.4 1.3-3.7 3.7-.3-2.4-1.2-3.4-3.7-3.7 2.5-.3 3.4-1.3 3.7-3.7Z"
      />
    </svg>
  );
}

export function Badge({ children, className = '' }) {
  return (
    <span
      dir="ltr"
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[13px] font-medium bg-white ${className}`}
      style={{ borderColor: 'var(--mkt-border)', color: 'var(--mkt-ink-2)' }}
    >
      <SparkIcon size={14} />
      {children}
    </span>
  );
}

/**
 * CTA button. variant: 'gradient' (the one primary CTA), 'black', 'ghost'.
 * Renders an <a> — marketing pages navigate with real links so every target
 * works as a prerendered static file.
 */
export function CtaButton({ href, variant = 'black', className = '', children }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-full px-7 h-12 text-[15px] font-bold transition-transform duration-150 hover:scale-[1.02] active:scale-[0.99]';
  const styles = {
    gradient: { background: 'var(--mkt-grad)', color: '#fff' },
    black: { background: 'var(--mkt-ink)', color: '#fff' },
    ghost: { background: 'var(--mkt-surface)', color: 'var(--mkt-ink)', border: '1px solid var(--mkt-border-strong)' },
  };
  return (
    <a href={href} className={`${base} ${className}`} style={styles[variant]}>
      {children}
    </a>
  );
}

/** FAQ list built on <details> — works with zero JS, keyboard accessible. */
export function Faq({ items }) {
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <details key={it.q} className="mkt-card px-5 py-4 group">
          <summary className="cursor-pointer list-none flex items-center justify-between font-bold text-[15px]">
            {it.q}
            <span
              className="text-xl leading-none transition-transform duration-200 group-open:rotate-45"
              style={{ color: 'var(--mkt-muted)' }}
              aria-hidden="true"
            >
              +
            </span>
          </summary>
          <p className="mt-3 text-[14px] leading-relaxed" style={{ color: 'var(--mkt-ink-2)' }}>
            {it.a}
          </p>
        </details>
      ))}
    </div>
  );
}
