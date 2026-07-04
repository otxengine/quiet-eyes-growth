/**
 * Cortexi — Premium Marketing Landing Page v4
 * Design: Floating Pill Nav · Glassmorphism · Bento Grid · Heebo 900
 * Palette: #F0F0F7 bg · #E8344D red · #7C3AED purple · #1A1F36 dark
 * Benchmark: Gumloop · Wonderful.ai · ElevenLabs · Google Labs
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/* ──────────────────────────────────────────────────────────────
   DESIGN TOKENS
────────────────────────────────────────────────────────────── */
const C = {
  bg:       '#F2F2F9',
  white:    '#FFFFFF',
  red:      '#E8344D',
  redD:     '#C9253B',
  purple:   '#7C3AED',
  purpleL:  '#9F5FFF',
  dark:     '#111827',
  mid:      '#4B5563',
  light:    '#9CA3AF',
  border:   'rgba(17,24,39,0.07)',
  glass:    'rgba(255,255,255,0.72)',
  green:    '#10B981',
  orange:   '#F59E0B',
};

/* ──────────────────────────────────────────────────────────────
   HOOKS
────────────────────────────────────────────────────────────── */
function useInView(threshold = 0.12) {
  const ref = useRef(null);
  const [v, setV] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setV(true); }, { threshold });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, v];
}

function useCounter(target, dur = 2000, active = false) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min((now - t0) / dur, 1);
      setVal(Math.floor((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, dur, active]);
  return val;
}

/* ──────────────────────────────────────────────────────────────
   SVG ICONS
────────────────────────────────────────────────────────────── */
const Ic = {
  Arrow: () => (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
    </svg>
  ),
  Check: ({ c = C.green }) => (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  Chev: ({ open }) => (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .25s ease' }}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
  Menu: () => (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  ),
  X: () => (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  TrendUp: ({ size = 20, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
    </svg>
  ),
  Radar: ({ size = 20, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="6" strokeDasharray="2 3"/><circle cx="12" cy="12" r="10"/>
    </svg>
  ),
  Target: ({ size = 20, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  ),
  Mobile: ({ size = 20, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2.5"/><circle cx="12" cy="17.5" r="0.8" fill={color}/>
    </svg>
  ),
  Star: ({ size = 20, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  ),
  Zap: ({ size = 20, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  Bar: ({ size = 20, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  ),
};

/* ──────────────────────────────────────────────────────────────
   MICRO COMPONENTS
────────────────────────────────────────────────────────────── */
function StatNum({ n, suffix, label, sub, active }) {
  const val = useCounter(n, 2200, active);
  return (
    <div style={{ textAlign: 'center', padding: '24px 36px' }}>
      <div style={{ fontSize: 44, fontWeight: 900, color: C.dark, letterSpacing: '-0.045em', lineHeight: 1, fontFamily: 'Heebo,sans-serif' }}>
        {n >= 1000 ? val.toLocaleString() : val}{suffix}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginTop: 10 }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: C.light, marginTop: 4, fontWeight: 500 }}>{sub}</div>}
    </div>
  );
}

function Badge({ icon, color }) {
  return (
    <div style={{
      width: 40, height: 40, borderRadius: 11, flexShrink: 0,
      background: `${color}12`, border: `1.5px solid ${color}22`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>{icon}</div>
  );
}

function Chip({ label }) {
  return (
    <span style={{
      display: 'inline-block', fontSize: 11, fontWeight: 700,
      padding: '3.5px 10px', borderRadius: 6,
      background: 'rgba(17,24,39,0.04)', color: C.mid,
      border: '1px solid rgba(17,24,39,0.07)',
    }}>{label}</span>
  );
}

/* ──────────────────────────────────────────────────────────────
   BENTO CARD
────────────────────────────────────────────────────────────── */
function BCard({ col, row, vis, delay = 0, accent, badge, title, body, tags, extra }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        gridColumn: col, gridRow: row,
        borderRadius: 22,
        padding: '26px',
        background: hov ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.66)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: `1.5px solid ${hov ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.80)'}`,
        boxShadow: hov
          ? `0 20px 50px rgba(17,24,39,0.10), 0 1px 0 rgba(255,255,255,0.9) inset`
          : '0 4px 20px rgba(17,24,39,0.055), 0 1px 0 rgba(255,255,255,0.8) inset',
        opacity: vis ? 1 : 0,
        transform: vis ? (hov ? 'translateY(-4px)' : 'translateY(0)') : 'translateY(28px)',
        transition: `opacity .6s ease ${delay}ms, transform .22s ease, box-shadow .22s ease, background .18s ease, border .18s ease`,
        position: 'relative', overflow: 'hidden',
      }}
    >
      {/* Accent top line */}
      <div style={{ position: 'absolute', top: 0, right: 0, left: 0, height: 3, background: `linear-gradient(90deg, transparent, ${accent}90, transparent)`, borderRadius: '22px 22px 0 0', opacity: hov ? 1 : 0, transition: 'opacity .25s ease' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>{badge}</div>
      <h3 style={{ fontSize: 17, fontWeight: 800, color: C.dark, lineHeight: 1.35, marginBottom: 10, letterSpacing: '-0.02em' }}>{title}</h3>
      <p style={{ fontSize: 14, color: C.mid, lineHeight: 1.72, fontWeight: 400, marginBottom: tags?.length ? 16 : 0 }}>{body}</p>
      {tags?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {tags.map(t => <Chip key={t} label={t} />)}
        </div>
      )}
      {extra}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   FAQ ITEM
────────────────────────────────────────────────────────────── */
function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      onClick={() => setOpen(o => !o)}
      style={{
        borderBottom: `1px solid ${C.border}`,
        cursor: 'pointer',
        transition: 'background .18s',
        borderRadius: open ? '12px 12px 0 0' : 0,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 4px', gap: 16 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: C.dark, lineHeight: 1.4 }}>{q}</span>
        <span style={{ color: C.light, flexShrink: 0 }}><Ic.Chev open={open} /></span>
      </div>
      {open && (
        <div style={{ padding: '0 4px 20px', fontSize: 15, color: C.mid, lineHeight: 1.75, fontWeight: 400, animation: 'faqOpen .25s ease' }}>
          {a}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   TESTIMONIAL DATA
────────────────────────────────────────────────────────────── */
const TESTI = [
  { q: 'שבוע אחד עם Cortexi. המתחרה מסביב לפינה פתח "ארוחת בוקר" ב-65 ₪ בדיוק בשעות שלי. הגבתי למחרת. שמרתי על 40 לקוחות קבועים.', name: 'יוסי כהן', role: 'בעלים, מסעדת הגרנד — ת"א', init: 'י', color: C.red },
  { q: 'המערכת זיהתה 3 חברות שעמדו לבטל מנוי — 3 שבועות לפני שזה קרה. שלחתי הצעה אישית. שניים חזרו. שווה 11,400 ₪ בשנה.', name: 'מיכל לוי', role: 'בעלים, סטודיו Fit+ — רמת גן', init: 'מ', color: C.purple },
  { q: 'Cortexi אמרה שטרנד "ombre nails" יגיע לישראל בעוד 18 יום. פרסמתי ראשון. 47 תורים בשלושה ימים.', name: 'אבי שמאי', role: 'בעלים, סלון Style — חיפה', init: 'א', color: C.orange },
];

/* ──────────────────────────────────────────────────────────────
   MAIN COMPONENT
────────────────────────────────────────────────────────────── */
export default function LandingMain() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);

  const [statsRef, statsV] = useInView(0.25);
  const [probRef,  probV]  = useInView(0.08);
  const [featRef,  featV]  = useInView(0.04);
  const [testiRef, testiV] = useInView(0.08);
  const [howRef,   howV]   = useInView(0.12);
  const [pricRef,  pricV]  = useInView(0.08);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const go = (p) => { navigate(p); setMenu(false); };

  /* ── NAV LINKS ── */
  const NAV = [
    { label: 'יכולות',      href: '#features' },
    { label: 'איך זה עובד', href: '#how' },
    { label: 'מחירים',      href: '#pricing' },
    { label: 'שאלות',       href: '#faq' },
  ];

  return (
    <div dir="rtl" style={{ background: C.bg, minHeight: '100vh', fontFamily: 'Heebo, system-ui, sans-serif', color: C.dark, overflowX: 'hidden' }}>

      {/* ════════ GLOBAL CSS ════════ */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800;900&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        html { scroll-behavior: smooth; }
        a { text-decoration: none; }

        /* Keyframes */
        @keyframes fadeUp   { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:none} }
        @keyframes fadeIn   { from{opacity:0} to{opacity:1} }
        @keyframes orbA     { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-28px,-36px) scale(1.04)} }
        @keyframes orbB     { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(32px,22px) scale(1.03)} }
        @keyframes orbC     { 0%,100%{transform:translate(0,0)} 50%{transform:translate(14px,-18px)} }
        @keyframes marquee  { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        @keyframes blink    { 0%,100%{opacity:1} 50%{opacity:0.25} }
        @keyframes slideDown{ from{opacity:0;transform:translateY(-10px)} to{opacity:1;transform:none} }
        @keyframes faqOpen  { from{opacity:0;transform:translateY(-5px)} to{opacity:1;transform:none} }
        @keyframes uiFade   { from{opacity:0;transform:translateY(32px)} to{opacity:1;transform:none} }

        /* Hero enter animations */
        .h-in1 { animation: fadeUp .75s .00s ease both; }
        .h-in2 { animation: fadeUp .75s .10s ease both; }
        .h-in3 { animation: fadeUp .75s .20s ease both; }
        .h-in4 { animation: fadeUp .75s .30s ease both; }
        .h-ui  { animation: uiFade .95s .42s ease both; }

        /* Marquee */
        .mq-wrap { overflow:hidden; -webkit-mask-image:linear-gradient(to left,transparent,black 14%,black 86%,transparent); mask-image:linear-gradient(to left,transparent,black 14%,black 86%,transparent); }
        .mq-track { display:flex; gap:10px; width:max-content; animation:marquee 38s linear infinite; }
        .mq-track:hover { animation-play-state:paused; }

        /* Glass utility */
        .glass {
          background: rgba(255,255,255,0.70);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1.5px solid rgba(255,255,255,0.85);
          box-shadow: 0 4px 24px rgba(17,24,39,0.06), 0 1px 3px rgba(17,24,39,0.03);
        }

        /* Floating navbar pill */
        .nav-pill {
          background: rgba(255,255,255,0.86);
          backdrop-filter: blur(28px);
          -webkit-backdrop-filter: blur(28px);
          border: 1px solid rgba(255,255,255,0.95);
          box-shadow: 0 2px 16px rgba(17,24,39,0.06), 0 1px 4px rgba(17,24,39,0.04);
          transition: box-shadow .3s ease, background .3s ease;
        }
        .nav-pill-scrolled {
          box-shadow: 0 4px 28px rgba(17,24,39,0.10), 0 1px 6px rgba(17,24,39,0.06);
          background: rgba(255,255,255,0.96);
        }

        /* Primary CTA button */
        .btn-cta {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 13px 26px;
          background: linear-gradient(135deg, #E8344D 0%, #C9253B 100%);
          color: #fff; font-weight: 800; font-size: 15px; font-family: Heebo,sans-serif;
          border: none; border-radius: 12px; cursor: pointer;
          box-shadow: 0 3px 12px rgba(232,52,77,0.28), inset 0 1px 0 rgba(255,255,255,0.16);
          transition: box-shadow .2s ease, transform .2s ease;
          letter-spacing: .01em; white-space: nowrap;
        }
        .btn-cta:hover {
          box-shadow: 0 6px 22px rgba(232,52,77,0.45), inset 0 1px 0 rgba(255,255,255,0.22);
          transform: translateY(-1px);
        }
        .btn-cta:active { transform: none; }
        .btn-cta-lg { font-size: 16px; padding: 15px 32px; border-radius: 13px; }

        /* Ghost button */
        .btn-ghost {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 13px 22px;
          background: rgba(255,255,255,0.85); color: #111827;
          font-weight: 700; font-size: 15px; font-family: Heebo,sans-serif;
          border: 1.5px solid rgba(17,24,39,0.10); border-radius: 12px; cursor: pointer;
          box-shadow: 0 1px 6px rgba(17,24,39,0.06);
          transition: all .2s ease; white-space: nowrap;
        }
        .btn-ghost:hover {
          background: #fff; border-color: rgba(17,24,39,0.18);
          box-shadow: 0 3px 14px rgba(17,24,39,0.09);
          transform: translateY(-1px);
        }

        /* Nav link */
        .nav-link {
          font-size: 14.5px; font-weight: 600; color: #6B7280;
          padding: 7px 13px; border-radius: 9px; transition: all .17s ease;
          display: inline-flex; align-items: center; white-space: nowrap;
        }
        .nav-link:hover { background: rgba(17,24,39,0.05); color: #111827; }

        /* Lift on hover */
        .lift { transition: transform .24s ease, box-shadow .24s ease; }
        .lift:hover { transform: translateY(-4px); box-shadow: 0 16px 40px rgba(17,24,39,0.09) !important; }

        /* Purple headline gradient — static, no animation */
        .purple-grad {
          background: linear-gradient(125deg, #7C3AED 0%, #A855F7 55%, #9F5FFF 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        /* Section header eyebrow */
        .eyebrow {
          display: inline-block; font-size: 12px; font-weight: 800;
          letter-spacing: .1em; text-transform: uppercase; margin-bottom: 14px;
        }

        .dot-live { animation: blink 2.2s ease-in-out infinite; }

        @media (max-width: 900px) {
          .nav-center, .nav-right { display: none !important; }
          .nav-burger { display: flex !important; }
        }
        @media (max-width: 640px) {
          .sm-col1 { grid-template-columns: 1fr !important; }
          .sm-col2 { grid-template-columns: 1fr 1fr !important; }
          .sm-full { grid-column: 1 / -1 !important; }
        }
      `}</style>

      {/* ════════════════════════════════════════════════════════
          AMBIENT BACKGROUND ORBS
      ════════════════════════════════════════════════════════ */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-15%', right: '-10%', width: 750, height: 750, borderRadius: '50%', background: 'radial-gradient(circle at 40% 40%, rgba(232,52,77,0.09), transparent 62%)', animation: 'orbA 20s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', top: '10%', left: '-8%', width: 650, height: 650, borderRadius: '50%', background: 'radial-gradient(circle at 60% 55%, rgba(124,58,237,0.08), transparent 62%)', animation: 'orbB 25s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', bottom: '5%', right: '25%', width: 520, height: 520, borderRadius: '50%', background: 'radial-gradient(circle at 50% 50%, rgba(249,115,22,0.06), transparent 62%)', animation: 'orbC 32s ease-in-out infinite' }} />
      </div>

      {/* ════════════════════════════════════════════════════════
          FLOATING PILL NAVBAR
      ════════════════════════════════════════════════════════ */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, padding: '14px 24px' }}>
        <nav
          className={`nav-pill${scrolled ? ' nav-pill-scrolled' : ''}`}
          style={{ maxWidth: 1120, margin: '0 auto', height: 60, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 18px' }}
        >
          {/* Logo — RIGHT in RTL (DOM first = visually right) */}
          <div onClick={() => go('/')} style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', flexShrink: 0 }}>
            <img src="/logo.jpeg" alt="Cortexi" style={{ height: 32, width: 32, borderRadius: 8, objectFit: 'contain', flexShrink: 0 }} />
            <span style={{ fontSize: 17, fontWeight: 900, color: C.dark, letterSpacing: '-0.025em', fontFamily: 'Heebo,sans-serif' }}>Cortexi</span>
          </div>

          {/* Center nav links */}
          <div className="nav-center" style={{ display: 'flex', gap: 2 }}>
            {NAV.map(({ label, href }) => (
              <a key={href} href={href} className="nav-link">{label}</a>
            ))}
          </div>

          {/* CTA buttons — LEFT in RTL */}
          <div className="nav-right" style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <button onClick={() => go('/sign-in')} className="btn-ghost" style={{ padding: '9px 18px', fontSize: 14 }}>התחברות</button>
            <button onClick={() => go('/sign-up')} className="btn-cta" style={{ padding: '9px 18px', fontSize: 14 }}>התחל חינם</button>
          </div>

          {/* Mobile burger */}
          <button
            className="nav-burger"
            style={{ display: 'none', background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: C.dark }}
            onClick={() => setMenu(m => !m)}
          >
            {menu ? <Ic.X /> : <Ic.Menu />}
          </button>
        </nav>

        {/* Mobile drawer */}
        {menu && (
          <div style={{
            maxWidth: 1120, margin: '8px auto 0', borderRadius: 16,
            background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(28px)',
            border: '1px solid rgba(255,255,255,0.95)',
            boxShadow: '0 8px 32px rgba(17,24,39,0.1)',
            padding: '16px 20px 20px',
            animation: 'slideDown .2s ease',
          }}>
            {NAV.map(({ label, href }) => (
              <a key={href} href={href} onClick={() => setMenu(false)}
                style={{ display: 'block', padding: '13px 8px', fontSize: 16, fontWeight: 700, color: C.dark, borderBottom: `1px solid ${C.border}` }}
              >{label}</a>
            ))}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={() => go('/sign-in')} className="btn-ghost" style={{ flex: 1, justifyContent: 'center' }}>התחברות</button>
              <button onClick={() => go('/sign-up')} className="btn-cta" style={{ flex: 1, justifyContent: 'center' }}>התחל חינם</button>
            </div>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════
          HERO
      ════════════════════════════════════════════════════════ */}
      <section style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '130px 28px 80px', textAlign: 'center' }}>
        <div style={{ maxWidth: 820, width: '100%' }}>

          {/* Live badge pill */}
          <div className="h-in1 glass" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 18px', borderRadius: 100, marginBottom: 36 }}>
            <span className="dot-live" style={{ width: 7, height: 7, borderRadius: '50%', background: C.red, flexShrink: 0, display: 'inline-block' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: C.mid }}>מערכת ה-AI Growth הראשונה בעברית לעסקים קטנים</span>
          </div>

          {/* Main headline */}
          <h1 className="h-in2" style={{ fontSize: 'clamp(2.8rem,7.2vw,5.5rem)', fontWeight: 900, lineHeight: 1.06, letterSpacing: '-0.04em', marginBottom: 28, color: C.dark, fontFamily: 'Heebo,sans-serif' }}>
            50 סוכני AI סורקים<br />
            את <span className="purple-grad">השוק שלך</span><br />
            כל הלילה
          </h1>

          {/* Subheadline */}
          <p className="h-in3" style={{ fontSize: 'clamp(1rem,2.2vw,1.2rem)', color: C.mid, lineHeight: 1.75, maxWidth: 560, margin: '0 auto 40px', fontWeight: 400 }}>
            בוקר אחד תתעורר עם לידים חמים, מתחרה שינה מחיר, וטרנד TikTok שאף אחד בישראל עוד לא זיהה — הכל ממתין לאישורך ישירות בנייד.
          </p>

          {/* CTA row */}
          <div className="h-in4" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
            <button onClick={() => go('/sign-up')} className="btn-cta btn-cta-lg">
              התחל ניסיון חינמי — 7 ימים <Ic.Arrow />
            </button>
            <button onClick={() => go('/sign-in')} className="btn-ghost" style={{ fontSize: 16, padding: '15px 28px', borderRadius: 13 }}>
              כבר רשום? התחבר
            </button>
          </div>
          <p className="h-in4" style={{ fontSize: 13, color: C.light, marginBottom: 64, fontWeight: 500 }}>ללא כרטיס אשראי · ביטול בכל עת</p>

          {/* Dashboard mockup */}
          <div className="h-ui glass lift" style={{ borderRadius: 22, overflow: 'hidden', boxShadow: '0 36px 72px rgba(17,24,39,0.13), 0 8px 24px rgba(17,24,39,0.06)', textAlign: 'right' }}>
            {/* Window chrome */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '11px 18px', background: 'rgba(255,255,255,0.55)', borderBottom: '1px solid rgba(17,24,39,0.07)' }}>
              <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#FC625D' }} />
              <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#FDBC40' }} />
              <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#35CD4B' }} />
              <div style={{ flex: 1, textAlign: 'center' }}>
                <span style={{ fontSize: 12, color: C.light, background: 'rgba(17,24,39,0.05)', padding: '3px 14px', borderRadius: 6, fontWeight: 500 }}>app.cortexi.ai/dashboard</span>
              </div>
            </div>

            {/* Dashboard body */}
            <div style={{ padding: '20px 22px', background: 'rgba(242,242,249,0.65)', backdropFilter: 'blur(8px)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.dark }}>לוח בקרה — מגה ספורט</div>
                <span style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 8, background: 'rgba(232,52,77,0.08)', color: C.red, border: '1px solid rgba(232,52,77,0.15)' }}>3 פעולות לאישור</span>
              </div>

              {/* KPI row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 12 }}>
                {[
                  { v: '12', l: 'ביקורות חדשות', d: '+3 מאתמול', c: C.red },
                  { v: '8',  l: 'לידים חמים',    d: '↑62% שבועי', c: C.purple },
                  { v: '4',  l: 'טרנדים זוהו',   d: '~21 יום מראש', c: C.green },
                  { v: '94%',l: 'ציון מוניטין',  d: '+2% השבוע',  c: C.orange },
                ].map(s => (
                  <div key={s.l} className="glass" style={{ padding: '11px 13px', borderRadius: 11 }}>
                    <div style={{ fontSize: 20, fontWeight: 900, color: C.dark, letterSpacing: '-0.04em' }}>{s.v}</div>
                    <div style={{ fontSize: 10.5, color: C.light, marginTop: 2, fontWeight: 500 }}>{s.l}</div>
                    <div style={{ fontSize: 11, color: s.c, marginTop: 4, fontWeight: 700 }}>{s.d}</div>
                  </div>
                ))}
              </div>

              {/* Signal feed */}
              <div style={{ fontSize: 10, color: C.light, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 7 }}>תובנות אחרונות</div>
              {[
                { dot: C.red,    badge: 'ויראלי',     t: 'TikTok: "before/after fitness" — velocity ×4.7. חלון פעולה: 48 שעות.' },
                { dot: C.green,  badge: 'טרנד מוקדם', t: 'Google Trends US: "pilates reformer" +340% — יגיע לישראל בעוד ~21 יום.' },
                { dot: C.purple, badge: 'מתחרים',     t: 'FitZone פתח "אימון 06:30" — חסר בלוח שלך. הצעת פתרון מוכנה.' },
              ].map((s, i) => (
                <div key={i} className="glass" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderRadius: 10, marginBottom: 5 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot, flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 12, color: C.mid, lineHeight: 1.45 }}>{s.t}</div>
                  <span style={{ padding: '2px 9px', borderRadius: 20, background: `${s.dot}12`, color: s.dot, fontSize: 11, fontWeight: 700, border: `1px solid ${s.dot}22`, flexShrink: 0 }}>{s.badge}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════
          PLATFORM MARQUEE STRIP
      ════════════════════════════════════════════════════════ */}
      <div style={{ position: 'relative', zIndex: 1, padding: '18px 0', background: 'rgba(255,255,255,0.52)', backdropFilter: 'blur(14px)', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.light, textAlign: 'center', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 12 }}>סורק ומחובר לפלטפורמות שלך</div>
        <div className="mq-wrap">
          <div className="mq-track">
            {['Google Business', 'Instagram', 'TikTok', 'Facebook Groups', 'WhatsApp', 'Wolt', 'תן ביס', 'Google Trends', 'SerpAPI', 'Tavily AI', 'Gemini Vision', 'Google Ads',
              'Google Business', 'Instagram', 'TikTok', 'Facebook Groups', 'WhatsApp', 'Wolt', 'תן ביס', 'Google Trends', 'SerpAPI', 'Tavily AI', 'Gemini Vision', 'Google Ads',
            ].map((n, i) => (
              <div key={i} className="glass" style={{ padding: '6px 16px', borderRadius: 100, fontSize: 13, color: C.mid, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>{n}</div>
            ))}
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════
          STATS BAR
      ════════════════════════════════════════════════════════ */}
      <section ref={statsRef} style={{ position: 'relative', zIndex: 1, padding: '64px 28px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div className="sm-col2" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 0 }}>
            {[
              { n: 50,    suf: '+',    label: 'סוכני AI פעילים',    sub: 'עובדים 24/7' },
              { n: 21,    suf: ' יום', label: 'זיהוי טרנדים מראש', sub: 'לפני הפיק בישראל' },
              { n: 10000, suf: '+',    label: 'סריקות שוק יומיות', sub: 'Google · TikTok · Instagram' },
              { n: 95,    suf: '%',    label: 'דיוק זיהוי מתחרים', sub: 'שינוי מחיר · שירות · סושיאל' },
            ].map((s, i) => (
              <div key={i} style={{ borderRight: i < 3 ? `1px solid rgba(17,24,39,0.09)` : 'none' }}>
                <StatNum n={s.n} suffix={s.suf} label={s.label} sub={s.sub} active={statsV} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════
          PROBLEM SECTION
      ════════════════════════════════════════════════════════ */}
      <section ref={probRef} style={{ position: 'relative', zIndex: 1, padding: '16px 28px 88px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52, opacity: probV ? 1 : 0, transform: probV ? 'none' : 'translateY(18px)', transition: 'all .7s ease' }}>
            <div className="eyebrow" style={{ color: C.red }}>למה עסקים מפסידים כסף כל יום</div>
            <h2 style={{ fontSize: 'clamp(1.9rem,4.2vw,3rem)', fontWeight: 900, letterSpacing: '-0.035em', color: C.dark, lineHeight: 1.1 }}>
              המתחרים שלך לא ישנים.<br />
              <span style={{ color: C.mid, fontWeight: 700 }}>ה-AI שלנו גם לא.</span>
            </h2>
          </div>

          <div className="sm-col1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 14 }}>
            {[
              { emoji: '😰', title: 'המתחרה פתח שירות חדש. ידעת?', body: 'בלי כלי מעקב אתה מגלה שבועות אחרי, כשהלקוחות כבר שם. Cortexi שולחת התראה עוד באותו לילה — עם הצעת תגובה מוכנה.', accent: C.red, delay: 0 },
              { emoji: '📉', title: 'לקוח עומד לעזוב. הוא לא אמר לך.', body: '67% מהלקוחות שעוזבים לא מסבירים למה. Cortexi מזהה דפוסי נטישה 3 שבועות מראש ומציעה מה לעשות — לפני שזה קורה.', accent: C.purple, delay: 110 },
              { emoji: '🎯', title: 'טרנד TikTok עולה. אתה עוד לא שם.', body: 'מה שמפוצץ ב-TikTok US מגיע לישראל בעוד 2-3 שבועות. Cortexi מחשבת את הזמן ומכינה לך פוסט — כדי שתהיה ראשון.', accent: C.orange, delay: 220 },
            ].map((p, i) => (
              <div key={i} className="glass lift" style={{
                padding: '30px', borderRadius: 22,
                boxShadow: '0 4px 20px rgba(17,24,39,0.065)',
                opacity: probV ? 1 : 0, transform: probV ? 'none' : 'translateY(24px)',
                transition: `opacity .65s ease ${p.delay}ms, transform .65s ease ${p.delay}ms`,
              }}>
                <div style={{ fontSize: 36, marginBottom: 18, lineHeight: 1 }}>{p.emoji}</div>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: C.dark, marginBottom: 10, lineHeight: 1.3, letterSpacing: '-0.02em' }}>{p.title}</h3>
                <p style={{ fontSize: 14.5, color: C.mid, lineHeight: 1.75, fontWeight: 400 }}>{p.body}</p>
                <div style={{ marginTop: 22, width: 36, height: 3, borderRadius: 2, background: `linear-gradient(90deg,${p.accent},transparent)` }} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════
          BENTO FEATURES
      ════════════════════════════════════════════════════════ */}
      <section id="features" ref={featRef} style={{ position: 'relative', zIndex: 1, padding: '16px 28px 96px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ marginBottom: 52, opacity: featV ? 1 : 0, transform: featV ? 'none' : 'translateY(18px)', transition: 'all .7s ease' }}>
            <div className="eyebrow" style={{ color: C.purple }}>יכולות הליבה</div>
            <h2 style={{ fontSize: 'clamp(1.9rem,4.2vw,3rem)', fontWeight: 900, letterSpacing: '-0.035em', color: C.dark, maxWidth: 480, lineHeight: 1.1 }}>
              כלים שעובדים בשבילך<br />
              <span style={{ color: C.mid, fontWeight: 700 }}>24 שעות, 7 ימים בשבוע</span>
            </h2>
          </div>

          {/* 12-column bento */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', gap: 14 }}>

            {/* Large: Market Intelligence */}
            <BCard col="1/8" vis={featV} delay={0} accent={C.red}
              badge={<><Badge icon={<Ic.TrendUp size={18} color={C.red}/>} color={C.red}/><span style={{fontSize:11,fontWeight:800,color:C.red,letterSpacing:'.08em',textTransform:'uppercase'}}>זיהוי טרנדים</span></>}
              title="'pilates reformer' יגיע לישראל בעוד 21 יום. כבר יודעת?"
              body="מנוע z-score סורק Google Trends US כאינדיקטור מוביל — 2-6 שבועות לפני הפיק בישראל. אנחנו מחשבים מתי ומכינים לך תוכן מוכן."
              tags={['Google Trends IL+US','TikTok Viral','Instagram Hashtags','Facebook Groups']}
              extra={
                <div style={{ marginTop: 18, borderRadius: 14, background: 'rgba(242,242,249,0.65)', border: `1px solid ${C.border}`, padding: '13px 15px', backdropFilter: 'blur(8px)' }}>
                  <div style={{ fontSize: 10, color: C.light, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10 }}>velocity "pilates reformer" → ישראל ~21 יום</div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 48 }}>
                    {[12,15,13,17,21,19,23,27,34,41,51,61,73,83,93].map((h, i) => (
                      <div key={i} style={{ flex: 1, height: `${h}%`, borderRadius: 3, background: i >= 10 ? `rgba(232,52,77,${0.25 + i * 0.07})` : 'rgba(17,24,39,0.1)', transition: 'height .6s ease' }} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                    <span style={{ fontSize: 10, color: C.light, fontWeight: 500 }}>30 ימים אחורה</span>
                    <span style={{ fontSize: 10, color: C.red, fontWeight: 800 }}>velocity ×4.7 ↑</span>
                  </div>
                </div>
              }
            />

            {/* Medium: Competitor Radar */}
            <BCard col="8/13" vis={featV} delay={100} accent={C.purple}
              badge={<><Badge icon={<Ic.Radar size={18} color={C.purple}/>} color={C.purple}/><span style={{fontSize:11,fontWeight:800,color:C.purple,letterSpacing:'.08em',textTransform:'uppercase'}}>מעקב מתחרים</span></>}
              title="כל שינוי אצל המתחרה — לפני שהלקוחות שלהם הופכים ללקוחות שלך"
              body="Snapshot diff יומי: שינוי מחיר, שירות חדש, פוסט, ביקורת. התראה עם הצעת תגובה מוכנה."
              tags={['Snapshot diff','Price changes','Google Maps','Social monitor']}
            />

            {/* Medium: Lead Scoring */}
            <BCard col="1/6" vis={featV} delay={200} accent={C.green}
              badge={<><Badge icon={<Ic.Target size={18} color={C.green}/>} color={C.green}/><span style={{fontSize:11,fontWeight:800,color:C.green,letterSpacing:'.08em',textTransform:'uppercase'}}>לידים חמים</span></>}
              title="8 לידים ממתינים — זה אחד עומד לקנות עכשיו"
              body="כל ליד מקבל ציון intent ב-0-100: סנטימנט, מילות מפתח רכישה, מיקום, היסטוריה. הכי חמים עולים ראשונים."
              tags={['AI scoring 0-100','Intent signals','Auto-nurture','CRM sync']}
            />

            {/* Large: WhatsApp Approval */}
            <BCard col="6/13" vis={featV} delay={300} accent="#25D366"
              badge={<><Badge icon={<Ic.Mobile size={18} color="#25D366"/>} color="#25D366"/><span style={{fontSize:11,fontWeight:800,color:'#1DA851',letterSpacing:'.08em',textTransform:'uppercase'}}>אישור WhatsApp</span></>}
              title="כל פעולה ממתינה לאישורך — לחץ אחד בנייד"
              body="שום פוסט, תגובה, או הצעה לא יוצאת ללא אישורך. מצב semi-auto שומר אותך בשליטה מלאה."
              tags={['WhatsApp alerts','One-click approve','Semi-auto','Full-auto']}
              extra={
                <div style={{ marginTop: 18, borderRadius: 14, overflow: 'hidden', border: `1px solid ${C.border}`, maxWidth: 295, boxShadow: '0 4px 16px rgba(17,24,39,0.09)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(31,44,52,0.92)' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#E8344D,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900, color: '#fff' }}>C</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Cortexi</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)' }}>online · Agent active</div>
                    </div>
                  </div>
                  <div style={{ padding: '12px 14px', background: 'rgba(11,20,26,0.88)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ background: 'rgba(31,44,52,0.9)', borderRadius: 10, padding: '9px 12px', fontSize: 12, color: 'rgba(255,255,255,0.82)', lineHeight: 1.5, maxWidth: '90%', alignSelf: 'flex-end' }}>
                      🔥 OTX: טרנד "before/after" — velocity ×4. פוסט מנוסח מוכן. חלון 48 שעות.<br/>
                      <span style={{ color: '#25D366' }}>app.cortexi.ai/approvals</span>
                    </div>
                    <div style={{ background: 'rgba(0,92,75,0.92)', borderRadius: 10, padding: '9px 12px', fontSize: 12, color: 'rgba(255,255,255,0.88)', maxWidth: '52%', alignSelf: 'flex-start' }}>
                      אישרתי ✓
                    </div>
                  </div>
                </div>
              }
            />

            {/* Bottom row: 3 small cards */}
            <BCard col="1/5" vis={featV} delay={400} accent={C.orange}
              badge={<><Badge icon={<Ic.Star size={18} color={C.orange}/>} color={C.orange}/><span style={{fontSize:11,fontWeight:800,color:'#D97706',letterSpacing:'.08em',textTransform:'uppercase'}}>מוניטין</span></>}
              title="ביקורת שלילית? תגובה AI בסגנון שלך תוך 60 שניות"
              body="Google, Wolt, תן ביס — אוטומטי, ממתין לאישורך."
              tags={['Google Reviews','Wolt','Auto-draft']}
            />
            <BCard col="5/9" vis={featV} delay={500} accent={C.red}
              badge={<><Badge icon={<Ic.Zap size={18} color={C.red}/>} color={C.red}/><span style={{fontSize:11,fontWeight:800,color:C.red,letterSpacing:'.08em',textTransform:'uppercase'}}>AI ויזואלי</span></>}
              title="Gemini Vision מנתח thumbnails לפני שמדברים עליהם"
              body="מזהה מוצרים, אסתטיקה, פורמטים שעולים — שבועות לפני הפיק."
              tags={['Gemini Flash','Visual trends','Product detection']}
            />
            <BCard col="9/13" vis={featV} delay={600} accent={C.purple}
              badge={<><Badge icon={<Ic.Bar size={18} color={C.purple}/>} color={C.purple}/><span style={{fontSize:11,fontWeight:800,color:C.purple,letterSpacing:'.08em',textTransform:'uppercase'}}>דוח שבועי</span></>}
              title="ציון ביצועים שבועי + תחזית לשבוע הבא"
              body="דוח AI עם המלצה אחת חדה שמניעה פעולה — ישירות לנייד."
              tags={['Weekly report','Forecasting','Score 1-10']}
            />
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════
          TESTIMONIALS
      ════════════════════════════════════════════════════════ */}
      <section ref={testiRef} style={{ position: 'relative', zIndex: 1, padding: '16px 28px 88px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52, opacity: testiV ? 1 : 0, transform: testiV ? 'none' : 'translateY(18px)', transition: 'all .7s ease' }}>
            <div className="eyebrow" style={{ color: C.red }}>תוצאות אמיתיות</div>
            <h2 style={{ fontSize: 'clamp(1.9rem,4vw,2.9rem)', fontWeight: 900, letterSpacing: '-0.035em', color: C.dark }}>בעלי עסקים שמדברים במספרים</h2>
          </div>
          <div className="sm-col1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 14 }}>
            {TESTI.map((t, i) => (
              <div key={i} className="glass lift" style={{
                padding: '28px', borderRadius: 22,
                boxShadow: '0 4px 20px rgba(17,24,39,0.065)',
                opacity: testiV ? 1 : 0, transform: testiV ? 'none' : 'translateY(22px)',
                transition: `opacity .65s ease ${i * 120}ms, transform .65s ease ${i * 120}ms`,
              }}>
                <div style={{ display: 'flex', gap: 3, marginBottom: 16 }}>
                  {[1,2,3,4,5].map(s => (
                    <svg key={s} width={14} height={14} viewBox="0 0 24 24" fill={C.red} stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  ))}
                </div>
                <p style={{ fontSize: 15, color: C.mid, lineHeight: 1.72, fontWeight: 400, marginBottom: 22 }}>"{t.q}"</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 42, height: 42, borderRadius: '50%', background: `${t.color}18`, border: `1.5px solid ${t.color}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 900, color: t.color, flexShrink: 0 }}>{t.init}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: C.dark }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: C.light, fontWeight: 500 }}>{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════
          HOW IT WORKS
      ════════════════════════════════════════════════════════ */}
      <section id="how" ref={howRef} style={{ position: 'relative', zIndex: 1, padding: '16px 28px 88px' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 54, opacity: howV ? 1 : 0, transform: howV ? 'none' : 'translateY(18px)', transition: 'all .7s ease' }}>
            <div className="eyebrow" style={{ color: C.orange }}>תהליך פשוט</div>
            <h2 style={{ fontSize: 'clamp(1.9rem,4vw,2.9rem)', fontWeight: 900, letterSpacing: '-0.035em', color: C.dark }}>מ-0 לתובנה הראשונה — 5 דקות</h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { n: '01', color: C.red,    title: 'ספר לנו על העסק שלך',      body: 'שם, קטגוריה, עיר, מתחרים עיקריים. שיחה בעברית עם Kori — 10 שאלות, 5 דקות. לא צריך ידע טכני.', delay: 0 },
              { n: '02', color: C.purple, title: '50+ סוכנים נכנסים לפעולה', body: 'בלילה הראשון — Google Trends, TikTok, Instagram, Facebook Groups, Google Maps, Wolt. הכל נסרק אוטומטית.', delay: 130 },
              { n: '03', color: C.green,  title: 'תובנות ופעולות — לנייד שלך', body: 'כל בוקר ב-07:00: לידים חמים, טרנדים, מתחרים שינו — ופעולות מוכנות לאישורך ב-WhatsApp.', delay: 260 },
            ].map((s, i) => (
              <div key={i} className="glass" style={{
                display: 'flex', gap: 20, padding: '24px 26px', borderRadius: 18,
                boxShadow: '0 2px 14px rgba(17,24,39,0.055)',
                opacity: howV ? 1 : 0, transform: howV ? 'none' : 'translateX(16px)',
                transition: `opacity .65s ease ${s.delay}ms, transform .65s ease ${s.delay}ms`,
              }}>
                <div style={{ width: 50, height: 50, borderRadius: 14, background: `${s.color}10`, border: `1.5px solid ${s.color}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 14, color: s.color, flexShrink: 0 }}>
                  {s.n}
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.dark, marginBottom: 7, letterSpacing: '-0.02em' }}>{s.title}</div>
                  <div style={{ fontSize: 15, color: C.mid, lineHeight: 1.7, fontWeight: 400 }}>{s.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════
          PRICING
      ════════════════════════════════════════════════════════ */}
      <section id="pricing" ref={pricRef} style={{ position: 'relative', zIndex: 1, padding: '16px 28px 96px' }}>
        <div style={{ maxWidth: 1060, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52, opacity: pricV ? 1 : 0, transform: pricV ? 'none' : 'translateY(18px)', transition: 'all .7s ease' }}>
            <div className="eyebrow" style={{ color: C.purple }}>תמחור פשוט</div>
            <h2 style={{ fontSize: 'clamp(1.9rem,4vw,2.9rem)', fontWeight: 900, letterSpacing: '-0.035em', color: C.dark, marginBottom: 10 }}>ללא הפתעות. ללא מחויבות.</h2>
            <p style={{ fontSize: 16, color: C.mid, fontWeight: 400 }}>התחל חינם, שדרג רק כשאתה מרגיש ערך ממשי.</p>
          </div>

          <div className="sm-col1" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, alignItems: 'start' }}>
            {[
              { plan: 'ניסיון חינמי', price: '₪0',   period: '7 ימים',  features: ['7 ימים ללא תשלום','10 סריקות יומיות','3 סוכנים פעילים','לידים + ביקורות','ללא כרטיס אשראי'], cta: 'התחל חינם',    dark: false, badge: null },
              { plan: 'Basic',        price: '₪300', period: 'לחודש',  features: ['50 סריקות יומיות','8 סוכנים פעילים','מעקב מתחרים מלא','זיהוי טרנדים','ניהול ביקורות','התראות WhatsApp'], cta: 'בחר Basic',  dark: true,  badge: 'הכי פופולרי' },
              { plan: 'Premium',      price: '₪600', period: 'לחודש',  features: ['200 סריקות יומיות','50+ סוכנים','קמפיינים אוטומטיים','TikTok + Instagram AI','Gemini Vision','דוח שבועי + תחזיות'], cta: 'בחר Premium', dark: false, badge: null },
            ].map((p, i) => (
              <div key={i} style={{
                position: 'relative', borderRadius: 22,
                background: p.dark ? 'linear-gradient(145deg,#111827 0%,#1f2a52 100%)' : C.glass,
                backdropFilter: p.dark ? 'none' : 'blur(20px)',
                WebkitBackdropFilter: p.dark ? 'none' : 'blur(20px)',
                border: p.dark ? '1px solid rgba(255,255,255,0.08)' : '1.5px solid rgba(255,255,255,0.85)',
                boxShadow: p.dark ? '0 24px 64px rgba(17,24,39,0.28)' : '0 4px 20px rgba(17,24,39,0.065)',
                padding: '28px 24px', display: 'flex', flexDirection: 'column',
                opacity: pricV ? 1 : 0, transform: pricV ? (p.dark ? 'scale(1.02)' : 'none') : 'translateY(24px)',
                transition: `opacity .65s ease ${i * 110}ms, transform .65s ease ${i * 110}ms`,
              }}>
                {p.badge && (
                  <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: `linear-gradient(135deg,${C.red},${C.purple})`, color: '#fff', fontSize: 12, fontWeight: 800, padding: '5px 18px', borderRadius: 100, whiteSpace: 'nowrap' }}>{p.badge}</div>
                )}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: p.dark ? 'rgba(255,255,255,0.4)' : C.light, marginBottom: 8 }}>{p.plan}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 42, fontWeight: 900, color: p.dark ? '#fff' : C.dark, letterSpacing: '-0.045em', fontFamily: 'Heebo,sans-serif' }}>{p.price}</span>
                    <span style={{ fontSize: 14, color: p.dark ? 'rgba(255,255,255,0.38)' : C.light, fontWeight: 500 }}>{p.period}</span>
                  </div>
                </div>
                <ul style={{ flex: 1, listStyle: 'none', marginBottom: 26, display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {p.features.map(f => (
                    <li key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: p.dark ? 'rgba(255,255,255,0.7)' : C.mid, fontWeight: 400 }}>
                      <span style={{ width: 20, height: 20, borderRadius: '50%', background: p.dark ? 'rgba(255,255,255,0.08)' : `${C.red}10`, border: `1px solid ${p.dark ? 'rgba(255,255,255,0.14)' : `${C.red}22`}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Ic.Check c={p.dark ? '#fff' : C.red} />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => go('/sign-up')}
                  className={p.dark ? 'btn-cta' : 'btn-ghost'}
                  style={{ width: '100%', justifyContent: 'center', borderRadius: 12, fontSize: 14.5 }}
                >
                  {p.cta}
                </button>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', fontSize: 13, color: C.light, marginTop: 22, fontWeight: 500 }}>
            Enterprise?{' '}<a href="mailto:hello@cortexi.ai" style={{ color: C.mid, textDecoration: 'underline' }}>צרו קשר לתמחור מותאם</a>
          </p>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════
          FAQ
      ════════════════════════════════════════════════════════ */}
      <section id="faq" style={{ position: 'relative', zIndex: 1, padding: '16px 28px 88px' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontSize: 'clamp(1.9rem,4vw,2.7rem)', fontWeight: 900, letterSpacing: '-0.035em', color: C.dark }}>שאלות נפוצות</h2>
          </div>
          {[
            { q: 'האם צריך ידע טכני?', a: 'בכלל לא. הOnboarding הוא שיחה בעברית עם Kori — 10 שאלות, 5 דקות. לא צריך להכיר APIs, analytics, או כלים דיגיטליים.' },
            { q: 'אילו פלטפורמות מחוברות?', a: 'Google Business, Instagram, TikTok, Facebook Groups, Wolt, תן ביס, WhatsApp. ניטור פסיבי עובד אפילו ללא חיבור OAuth.' },
            { q: 'האם המערכת פועלת אוטומטית לחלוטין?', a: 'כן, 24/7. אבל כל פעולה שיוצאת החוצה ממתינה לאישורך אם בחרת מצב semi-auto. שום דבר לא יוצא בלי שאתה יודע.' },
            { q: 'מה קורה אחרי 7 ימי הניסיון?', a: 'תקבל הודעה 2 ימים לפני הסיום. הנתונים שלך נשמרים 30 יום גם אחרי הניסיון — ללא כרטיס אשראי.' },
            { q: 'האם מתאים לסקטור שלי?', a: 'כן — מסעדות, פיטנס, יופי, רפואה, נדל"ן, חנויות. המנוע מתכוונן אוטומטית לסקטור שלך עם benchmark ספציפי.' },
          ].map((item, i) => <FAQItem key={i} q={item.q} a={item.a} />)}
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════
          FINAL CTA
      ════════════════════════════════════════════════════════ */}
      <section style={{ position: 'relative', zIndex: 1, padding: '0 28px 96px' }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          <div style={{ borderRadius: 28, padding: '72px 48px', textAlign: 'center', background: C.dark, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: -90, right: -90, width: 380, height: 380, borderRadius: '50%', background: 'radial-gradient(circle,rgba(232,52,77,0.2),transparent 65%)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: -90, left: -90, width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle,rgba(124,58,237,0.18),transparent 65%)', pointerEvents: 'none' }} />
            <div style={{ position: 'relative' }}>
              <h2 style={{ fontSize: 'clamp(2.1rem,5.5vw,3.8rem)', fontWeight: 900, color: '#fff', letterSpacing: '-0.04em', lineHeight: 1.06, marginBottom: 20 }}>
                תוך 7 ימים תדע מה<br />
                <span style={{ background: 'linear-gradient(125deg,#E8344D,#C026D3,#7C3AED)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>המתחרים שלך לא יודעים</span>
              </h2>
              <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.5)', marginBottom: 36, maxWidth: 460, margin: '0 auto 36px', lineHeight: 1.65, fontWeight: 400 }}>
                7 ימי ניסיון חינמי. ללא כרטיס אשראי. ביטול בכל עת.
              </p>
              <button onClick={() => go('/sign-up')} className="btn-cta" style={{ fontSize: 17, padding: '16px 42px', borderRadius: 14 }}>
                התחל ניסיון חינמי — 7 ימים <Ic.Arrow />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════
          FOOTER
      ════════════════════════════════════════════════════════ */}
      <footer style={{ position: 'relative', zIndex: 1, borderTop: `1px solid ${C.border}`, padding: '48px 28px 40px', background: 'rgba(255,255,255,0.45)', backdropFilter: 'blur(14px)' }}>
        <div style={{ maxWidth: 1160, margin: '0 auto' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 40, justifyContent: 'space-between', marginBottom: 40 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
                <img src="/logo.jpeg" alt="Cortexi" style={{ height: 34, width: 34, borderRadius: 8, objectFit: 'contain' }} />
                <span style={{ fontSize: 17, fontWeight: 900, color: C.dark, letterSpacing: '-0.02em', fontFamily: 'Heebo,sans-serif' }}>Cortexi</span>
              </div>
              <p style={{ fontSize: 13, color: C.light, maxWidth: 210, lineHeight: 1.7, fontWeight: 400 }}>AI Growth OS לעסקים קטנים-בינוניים בישראל.</p>
            </div>
            <div style={{ display: 'flex', gap: 52, flexWrap: 'wrap' }}>
              {[
                { title: 'מוצר',    links: [['#features','יכולות'],['#how','איך זה עובד'],['#pricing','מחירים']] },
                { title: 'לפי עסק', links: [['/restaurants','מסעדות'],['/fitness','פיטנס'],['/beauty','יופי']] },
                { title: 'משפטי',   links: [['/terms','תנאי שימוש'],['/privacy','פרטיות']] },
              ].map(col => (
                <div key={col.title} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.dark, marginBottom: 4 }}>{col.title}</span>
                  {col.links.map(([href, label]) => (
                    <a key={href} href={href} style={{ fontSize: 13, color: C.light, fontWeight: 500, transition: 'color .15s' }}
                      onMouseEnter={e => e.target.style.color = C.dark}
                      onMouseLeave={e => e.target.style.color = C.light}
                    >{label}</a>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, paddingTop: 24, borderTop: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 12, color: C.light, fontWeight: 500 }}>© 2026 Cortexi. כל הזכויות שמורות.</span>
            <span style={{ fontSize: 12, color: C.light, fontWeight: 500 }}>עוצב ופותח בישראל</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
