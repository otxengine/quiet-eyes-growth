import React from 'react';
import { MODULES, featurePath } from '../content/modules.js';

const COMPANY_LINKS = [
  { label: 'איך זה עובד', href: '/how-it-works' },
  { label: 'מחירים', href: '/pricing' },
  { label: 'בלוג', href: '/blog' },
  { label: 'אודות', href: '/about' },
  { label: 'צור קשר', href: '/contact' },
];

const LEGAL_LINKS = [
  { label: 'תנאי שימוש', href: '/terms' },
  { label: 'מדיניות פרטיות', href: '/privacy' },
  { label: 'מחיקת נתונים', href: '/data-deletion' },
];

function Col({ title, links }) {
  return (
    <div>
      <div className="font-bold text-[13px] mb-3" style={{ color: 'var(--mkt-ink)' }}>{title}</div>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.href}>
            <a href={l.href} className="text-[13.5px] hover:text-black" style={{ color: 'var(--mkt-muted)' }}>
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Footer() {
  return (
    <footer className="border-t" style={{ borderColor: 'var(--mkt-border)', background: 'var(--mkt-surface)' }}>
      <div className="max-w-6xl mx-auto px-6 py-14 grid grid-cols-2 md:grid-cols-4 gap-10">
        <div className="col-span-2 md:col-span-1">
          <a href="/" aria-label="Cortexi — לעמוד הבית">
            <img
              src="/logo/cortexi-logo-nav.png"
              alt="הלוגו של Cortexi"
              width={104}
              height={40}
              loading="lazy"
              className="h-10 w-auto"
            />
          </a>
          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: 'var(--mkt-muted)' }}>
            תוכנת בינה מלאכותית לניהול השיווק והמוניטין של עסקים קטנים — המערכת עוקבת, מנתחת ומכינה פעולות. אתה רק מאשר.
          </p>
          <p className="mt-3 text-[12px]" style={{ color: 'var(--mkt-muted)' }}>
            Inspired by the brain. Built for intelligence.
          </p>
        </div>
        <Col title="מוצר" links={MODULES.map((m) => ({ label: m.label, href: featurePath(m.slug) }))} />
        <Col title="חברה" links={COMPANY_LINKS} />
        <div>
          <Col title="משפטי" links={LEGAL_LINKS} />
          <div className="mt-6">
            <div className="font-bold text-[13px] mb-2" style={{ color: 'var(--mkt-ink)' }}>דברו איתנו</div>
            <a href="mailto:contact@cortexi.ai" className="text-[13.5px] hover:text-black" style={{ color: 'var(--mkt-muted)' }}>
              contact@cortexi.ai
            </a>
          </div>
        </div>
      </div>
      <div className="border-t" style={{ borderColor: 'var(--mkt-border)' }}>
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col md:flex-row items-center justify-between gap-2 text-[12.5px]" style={{ color: 'var(--mkt-muted)' }}>
          <span>© 2026 Cortexi. כל הזכויות שמורות.</span>
          <a href="/sign-up" className="font-bold hover:text-black" style={{ color: 'var(--mkt-ink-2)' }}>
            התחילו בחינם — ללא כרטיס אשראי
          </a>
        </div>
      </div>
    </footer>
  );
}
