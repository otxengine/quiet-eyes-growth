import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/* ─── hooks ──────────────────────────────────────────────────── */
function useInView(threshold = 0.15) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, visible];
}

function useCounter(target, duration = 2000, active = false) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min((now - t0) / duration, 1);
      setVal(Math.floor((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration, active]);
  return val;
}

/* ─── SVG icon set ───────────────────────────────────────────── */
const Icon = {
  Trend: () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
    </svg>
  ),
  Eye: () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
  Target: () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
    </svg>
  ),
  Star: () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  Zap: () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  Phone: () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  ),
  ArrowLeft: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
    </svg>
  ),
  Check: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Plus: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Bars: () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
};

/* ─── testimonials data ──────────────────────────────────────── */
const TESTIMONIALS = [
  { name: 'יוסי כהן', role: 'בעלים, מסעדת הגרנד', text: 'שבוע אחד עם Cortexi וגיליתי שמתחרה חצי רחוב ממני פתח מנה חדשה ביום שישי. הגבתי לפני שמישהו עזב אליו.', rating: 5 },
  { name: 'מיכל לוי', role: 'מנהלת סטודיו Fit+', text: 'המערכת הזהירה אותי על 3 חברות שעמדו לעזוב — 3 שבועות לפני שזה קרה. שלחתי הצעה ושניים נשארו.', rating: 5 },
  { name: 'אבי שמאי', role: 'בעלים, סלון Style', text: 'הייתי סקפטי. אחרי שבוע ראיתי טרנד "ombre nails" עולה בארה"ב — עשיתי פוסט ראשון בישראל. 47 תורים.', rating: 5 },
];

/* ─── Stat Counter ───────────────────────────────────────────── */
function Stat({ n, suffix, label, active }) {
  const val = useCounter(n, 1800, active);
  return (
    <div className="flex flex-col items-center gap-1 px-6">
      <div className="text-5xl font-black text-white tabular-nums tracking-tight">
        {val.toLocaleString()}{suffix}
      </div>
      <div className="text-sm text-white/40 text-center leading-tight mt-1">{label}</div>
    </div>
  );
}

/* ─── Main ───────────────────────────────────────────────────── */
export default function LandingMain() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [statsRef, statsVis] = useInView(0.3);
  const [featRef, featVis] = useInView(0.05);
  const [tesiRef, tesiVis] = useInView(0.1);
  const [pricRef, pricVis] = useInView(0.1);
  const [howRef, howVis] = useInView(0.15);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const go = (path) => navigate(path);

  return (
    <div
      dir="rtl"
      style={{
        background: '#060609',
        minHeight: '100vh',
        color: '#F4F4F6',
        fontFamily: "'Inter', 'Noto Sans Hebrew', system-ui, sans-serif",
        overflowX: 'hidden',
      }}
    >
      {/* ── Google Font + keyframes ─────────────────────────────── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

        *, *::before, *::after { box-sizing: border-box; }

        @keyframes orbit1 {
          0%,100% { transform: translate(0,0) scale(1); }
          40%     { transform: translate(60px,-40px) scale(1.06); }
          70%     { transform: translate(-30px,30px) scale(0.96); }
        }
        @keyframes orbit2 {
          0%,100% { transform: translate(0,0) scale(1); }
          35%     { transform: translate(-70px,35px) scale(1.04); }
          70%     { transform: translate(40px,-50px) scale(0.97); }
        }
        @keyframes fadein { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer {
          0%   { background-position: -300% center; }
          100% { background-position: 300% center; }
        }
        @keyframes marquee { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        @keyframes pulse-ring {
          0%   { box-shadow: 0 0 0 0 rgba(232,52,77,0.4); }
          70%  { box-shadow: 0 0 0 14px rgba(232,52,77,0); }
          100% { box-shadow: 0 0 0 0 rgba(232,52,77,0); }
        }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }

        .orb1 { animation: orbit1 20s ease-in-out infinite; }
        .orb2 { animation: orbit2 26s ease-in-out infinite; }

        .grad-text {
          background: linear-gradient(100deg, #ffffff 0%, #E8344D 40%, #9333ea 80%, #ffffff 100%);
          background-size: 300% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer 6s linear infinite;
        }

        .card-hover {
          transition: transform 0.25s ease, box-shadow 0.25s ease;
        }
        .card-hover:hover {
          transform: translateY(-4px);
          box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        }

        .marquee-track { animation: marquee 24s linear infinite; }
        .marquee-track:hover { animation-play-state: paused; }

        .cta-pulse { animation: pulse-ring 2.5s ease-out infinite; }

        .blink { animation: blink 2s ease-in-out infinite; }

        .grid-bg {
          background-image:
            linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px);
          background-size: 72px 72px;
        }

        .noise-overlay::after {
          content: '';
          position: absolute;
          inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
          pointer-events: none;
          border-radius: inherit;
        }

        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #060609; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
      `}</style>

      {/* ═══════════════════════ NAV ═════════════════════════════ */}
      <header
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
          background: scrolled ? 'rgba(6,6,9,0.85)' : 'transparent',
          backdropFilter: scrolled ? 'blur(24px)' : 'none',
          borderBottom: scrolled ? '1px solid rgba(255,255,255,0.05)' : 'none',
          transition: 'all 0.3s ease',
        }}
      >
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', height: 68, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Logo */}
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <div style={{
              width: 34, height: 34, borderRadius: 9,
              background: 'linear-gradient(135deg, #E8344D 0%, #9333ea 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(232,52,77,0.35)',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <span style={{ fontWeight: 800, fontSize: 17, color: '#fff', letterSpacing: '-0.3px' }}>Cortexi</span>
          </button>

          {/* Desktop nav */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
            {[['#features', 'יכולות'], ['#how', 'איך זה עובד'], ['#pricing', 'מחירים'], ['#faq', 'שאלות']].map(([href, label]) => (
              <a key={href} href={href} style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', textDecoration: 'none', transition: 'color 0.2s' }}
                onMouseEnter={e => e.target.style.color = '#fff'}
                onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.55)'}
                className="hidden-mobile"
              >
                {label}
              </a>
            ))}
          </nav>

          {/* CTA group */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => go('/sign-in')}
              style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', background: 'none', border: 'none', cursor: 'pointer', padding: '8px 12px' }}
              className="hidden-mobile"
            >
              התחברות
            </button>
            <button onClick={() => go('/sign-up')}
              className="cta-pulse"
              style={{
                fontSize: 14, fontWeight: 700, color: '#fff',
                background: 'linear-gradient(135deg, #E8344D 0%, #c2185b 100%)',
                border: 'none', borderRadius: 10, padding: '9px 20px', cursor: 'pointer',
                boxShadow: '0 4px 20px rgba(232,52,77,0.35)',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              }}
              onMouseEnter={e => { e.target.style.transform = 'scale(1.04)'; }}
              onMouseLeave={e => { e.target.style.transform = 'scale(1)'; }}
            >
              התחל חינם
            </button>
            {/* Mobile hamburger */}
            <button onClick={() => setMenuOpen(o => !o)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', padding: 8 }}
              className="show-mobile"
            >
              <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {menuOpen
                  ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div style={{ background: 'rgba(6,6,9,0.98)', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '16px 24px 24px' }}>
            {[['#features', 'יכולות'], ['#how', 'איך זה עובד'], ['#pricing', 'מחירים'], ['#faq', 'שאלות נפוצות']].map(([href, label]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)}
                style={{ display: 'block', padding: '12px 0', fontSize: 16, color: 'rgba(255,255,255,0.7)', textDecoration: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                {label}
              </a>
            ))}
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button onClick={() => go('/sign-in')} style={{ flex: 1, padding: '12px 0', borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>התחברות</button>
              <button onClick={() => go('/sign-up')} style={{ flex: 1, padding: '12px 0', borderRadius: 10, background: 'linear-gradient(135deg, #E8344D, #c2185b)', border: 'none', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>התחל חינם</button>
            </div>
          </div>
        )}
      </header>

      {/* ═══════════════════════ HERO ════════════════════════════ */}
      <section
        className="grid-bg noise-overlay"
        style={{
          position: 'relative',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '120px 24px 80px',
          textAlign: 'center',
          overflow: 'hidden',
        }}
      >
        {/* Background glow orbs */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          <div className="orb1" style={{ position: 'absolute', top: '18%', right: '22%', width: 480, height: 480, borderRadius: '50%', background: 'radial-gradient(circle, rgba(232,52,77,0.18), transparent 70%)', filter: 'blur(80px)' }} />
          <div className="orb2" style={{ position: 'absolute', bottom: '20%', left: '18%', width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle, rgba(147,51,234,0.16), transparent 70%)', filter: 'blur(80px)' }} />
        </div>

        <div style={{ position: 'relative', zIndex: 2, maxWidth: 960, width: '100%' }}>
          {/* Live badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '6px 16px', borderRadius: 100,
            background: 'rgba(232,52,77,0.1)', border: '1px solid rgba(232,52,77,0.25)',
            marginBottom: 32, animation: 'fadein 0.6s ease both',
          }}>
            <span className="blink" style={{ width: 7, height: 7, borderRadius: '50%', background: '#E8344D', display: 'inline-block' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.75)' }}>
              מערכת ה-AI Growth הראשונה בעברית לעסקים
            </span>
          </div>

          {/* Main headline */}
          <h1 style={{
            fontSize: 'clamp(3rem, 8vw, 6.2rem)',
            fontWeight: 900,
            lineHeight: 1.0,
            letterSpacing: '-0.03em',
            margin: '0 0 28px',
            animation: 'fadein 0.6s 0.1s ease both',
            opacity: 0,
            animationFillMode: 'forwards',
          }}>
            <span style={{ display: 'block', color: '#FAFAFA' }}>עשרות סוכני AI</span>
            <span className="grad-text" style={{ display: 'block', lineHeight: 1.1 }}>עובדים בשקט</span>
            <span style={{ display: 'block', color: '#FAFAFA' }}>בזמן שאתה ישן</span>
          </h1>

          {/* Subheadline */}
          <p style={{
            fontSize: 'clamp(1rem, 2.2vw, 1.25rem)',
            color: 'rgba(255,255,255,0.5)',
            maxWidth: 580, margin: '0 auto 40px',
            lineHeight: 1.7,
            animation: 'fadein 0.6s 0.2s ease both',
            opacity: 0,
            animationFillMode: 'forwards',
          }}>
            בוקר אחד תתעורר עם תובנות שוק, לידים חמים, וטרנדים שזוהו 3 שבועות מראש — ישירות לנייד שלך. לפני שהמתחרים פתחו עיניים.
          </p>

          {/* CTAs */}
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap', animation: 'fadein 0.6s 0.3s ease both', opacity: 0, animationFillMode: 'forwards' }}>
            <button onClick={() => go('/sign-up')}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '15px 32px', borderRadius: 14, border: 'none',
                background: 'linear-gradient(135deg, #E8344D 0%, #c2185b 100%)',
                color: '#fff', fontWeight: 800, fontSize: 15.5, cursor: 'pointer',
                boxShadow: '0 8px 40px rgba(232,52,77,0.4)',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 12px 50px rgba(232,52,77,0.5)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 8px 40px rgba(232,52,77,0.4)'; }}
            >
              התחל ניסיון חינמי — 7 ימים
              <Icon.ArrowLeft />
            </button>
            <button onClick={() => go('/sign-in')}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '15px 28px', borderRadius: 14,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.75)', fontWeight: 600, fontSize: 15, cursor: 'pointer',
                transition: 'background 0.2s ease, border-color 0.2s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
            >
              כבר רשום? התחבר
            </button>
          </div>

          {/* Trust note */}
          <p style={{ marginTop: 20, fontSize: 13, color: 'rgba(255,255,255,0.25)', animation: 'fadein 0.6s 0.4s ease both', opacity: 0, animationFillMode: 'forwards' }}>
            ללא כרטיס אשראי · ביטול בכל עת · ניסיון מלא 7 ימים
          </p>

          {/* Product preview */}
          <div style={{
            marginTop: 64,
            borderRadius: 20,
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.07)',
            boxShadow: '0 60px 120px rgba(0,0,0,0.7), 0 0 80px rgba(232,52,77,0.06)',
            animation: 'fadein 0.9s 0.5s ease both',
            opacity: 0,
            animationFillMode: 'forwards',
          }}>
            {/* Window chrome */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', background: '#111118', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#E8344D', opacity: 0.9 }} />
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#f59e0b', opacity: 0.9 }} />
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#22c55e', opacity: 0.9 }} />
              <div style={{ flex: 1, textAlign: 'center' }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', padding: '3px 14px', borderRadius: 6 }}>app.cortexi.ai/dashboard</span>
              </div>
            </div>

            {/* Dashboard content */}
            <div style={{ background: '#0a0a10', padding: 24 }}>
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>לוח בקרה — מגה ספורט</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>עודכן לפני 4 דקות</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ padding: '6px 14px', borderRadius: 8, background: 'rgba(232,52,77,0.12)', border: '1px solid rgba(232,52,77,0.25)', fontSize: 12, color: '#E8344D', fontWeight: 600 }}>3 פעולות לאישור</div>
                </div>
              </div>

              {/* Stats row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
                {[
                  { v: '12', l: 'ביקורות חדשות', d: '+3 מאתמול', c: '#E8344D' },
                  { v: '8', l: 'לידים חמים', d: '↑ 62% שבועי', c: '#9333ea' },
                  { v: '4', l: 'טרנדים זוהו', d: '3 שבועות מראש', c: '#22c55e' },
                  { v: '94%', l: 'ציון מוניטין', d: '+2% מהשבוע', c: '#f59e0b' },
                ].map(s => (
                  <div key={s.l} style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px' }}>{s.v}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{s.l}</div>
                    <div style={{ fontSize: 11, color: s.c, marginTop: 4, fontWeight: 600 }}>{s.d}</div>
                  </div>
                ))}
              </div>

              {/* Signal cards */}
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', fontWeight: 600, marginBottom: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>תובנות אחרונות</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { dot: '#E8344D', badge: 'ויראלי', badgeBg: 'rgba(232,52,77,0.12)', badgeBorder: 'rgba(232,52,77,0.3)', text: 'TikTok: "before/after fitness" — velocity exploding. חלון פעולה: 48 שעות. פוסט מנוסח ממתין לאישורך.' },
                  { dot: '#22c55e', badge: 'טרנד מוקדם', badgeBg: 'rgba(34,197,94,0.1)', badgeBorder: 'rgba(34,197,94,0.25)', text: 'Google Trends US: "pilates reformer home" +340%. מגיע לישראל בעוד ~3 שבועות. מחכה לך.' },
                  { dot: '#9333ea', badge: 'מתחרים', badgeBg: 'rgba(147,51,234,0.1)', badgeBorder: 'rgba(147,51,234,0.25)', text: 'FitZone פתח "אימון בוקר 06:30" — השירות שלך חסר את החריץ הזה. הצעת תגובה מוכנה.' },
                ].map((sig, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: sig.dot, marginTop: 5, flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 12.5, color: 'rgba(255,255,255,0.65)', lineHeight: 1.55, textAlign: 'right' }}>{sig.text}</div>
                    <div style={{ padding: '3px 10px', borderRadius: 20, background: sig.badgeBg, border: `1px solid ${sig.badgeBorder}`, fontSize: 11, color: sig.dot, fontWeight: 600, flexShrink: 0 }}>{sig.badge}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ PLATFORM STRIP ═════════════════ */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '20px 0', overflow: 'hidden' }}>
        <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.25)', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 14 }}>
          סורק ומחובר לפלטפורמות שלך
        </div>
        <div style={{ overflow: 'hidden' }}>
          <div className="marquee-track" style={{ display: 'flex', gap: 14, width: 'max-content' }}>
            {['Google Business', 'Instagram', 'TikTok', 'Facebook Groups', 'WhatsApp', 'Wolt', 'תן ביס', 'Google Trends', 'Google Ads', 'SerpAPI', 'Tavily AI', 'Gemini Vision',
              'Google Business', 'Instagram', 'TikTok', 'Facebook Groups', 'WhatsApp', 'Wolt', 'תן ביס', 'Google Trends', 'Google Ads', 'SerpAPI', 'Tavily AI', 'Gemini Vision'
            ].map((name, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 18px', borderRadius: 100, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', fontSize: 13, color: 'rgba(255,255,255,0.45)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                {name}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════════════════ STATS ═══════════════════════════ */}
      <section ref={statsRef} style={{ padding: '80px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 0 }}>
          {[
            { n: 30, suffix: ' יום', label: 'חלון זיהוי טרנדים' },
            { n: 10000, suffix: '+', label: 'סריקות שוק יומיות' },
            { n: 95, suffix: '%', label: 'דיוק זיהוי שינויי מתחרים' },
            { n: 7, suffix: ' שניות', label: 'זמן לתובנה ראשונה' },
          ].map((s, i) => (
            <div key={i} style={{ borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
              <Stat n={s.n} suffix={s.suffix} label={s.label} active={statsVis} />
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════ FEATURES (BENTO) ════════════════ */}
      <section id="features" ref={featRef} style={{ padding: '80px 24px 100px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          {/* Section header */}
          <div style={{ marginBottom: 56, opacity: featVis ? 1 : 0, transform: featVis ? 'none' : 'translateY(20px)', transition: 'all 0.7s ease' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 14px', borderRadius: 100, background: 'rgba(147,51,234,0.1)', border: '1px solid rgba(147,51,234,0.25)', marginBottom: 16 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#a855f7', letterSpacing: '0.08em', textTransform: 'uppercase' }}>יכולות הליבה</span>
            </div>
            <h2 style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.1, margin: 0, color: '#FAFAFA' }}>
              כלים שעובדים<br />
              <span style={{ color: 'rgba(255,255,255,0.35)' }}>24 שעות, 7 ימים בשבוע</span>
            </h2>
          </div>

          {/* Bento grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gridAutoRows: 'auto', gap: 14 }}>

            {/* Large card — Trend detection */}
            <BentoCard
              span="col-span-7" gridCol="1 / 8" gridRow="1"
              visible={featVis} delay={0}
              accent="#E8344D"
              icon={<Icon.Trend />}
              label="זיהוי טרנדים"
              title="לפני כולם — 2-6 שבועות מראש"
              desc="מנוע z-score עם חלון גלילה של 30 יום. Google Trends US משמש כאינדיקטור מוביל — מה שקורה שם היום יגיע לישראל בעוד שבועות."
              tags={['Google Trends IL+US', 'TikTok Viral', 'Z-score detection', 'Seasonal patterns']}
              visual={
                <div style={{ marginTop: 20, borderRadius: 12, overflow: 'hidden', background: 'rgba(0,0,0,0.3)', padding: 16 }}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>טרנד מזוהה: "pilates reformer home" — ישראל בעוד ~21 ימים</div>
                  {/* Mini chart bars */}
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 52 }}>
                    {[18, 22, 19, 24, 28, 26, 32, 38, 45, 52, 61, 70, 82, 88, 95].map((h, i) => (
                      <div key={i} style={{ flex: 1, height: `${h}%`, borderRadius: 4, background: i >= 10 ? `rgba(232,52,77,${0.4 + i * 0.06})` : 'rgba(255,255,255,0.1)', transition: 'height 0.5s ease' }} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>30 ימים</span>
                    <span style={{ fontSize: 10, color: '#E8344D', fontWeight: 600 }}>↑ velocity ×4.7</span>
                  </div>
                </div>
              }
            />

            {/* Medium card — Competitor watch */}
            <BentoCard
              span="col-span-5" gridCol="8 / 13" gridRow="1"
              visible={featVis} delay={100}
              accent="#9333ea"
              icon={<Icon.Eye />}
              label="מעקב מתחרים"
              title="כל שינוי — תדע ראשון"
              desc="Snapshot diff יומי של כל מתחרה — מחיר, שירות חדש, פוסט, ביקורת. התראה מיידית כשמשהו משתנה."
              tags={['Price tracking', 'Google Maps diff', 'Social monitor']}
            />

            {/* Medium card — Lead scoring */}
            <BentoCard
              span="col-span-5" gridCol="1 / 6" gridRow="2"
              visible={featVis} delay={200}
              accent="#22c55e"
              icon={<Icon.Target />}
              label="לידים חמים"
              title="ניקוד AI 0-100"
              desc="כל ליד מקבל ציון intent. ניתוח סנטימנט, מילות מפתח רכישה, מיקום, היסטוריה. הלידים החמים עולים קודם."
              tags={['AI scoring', 'Intent signals', 'Auto-nurture']}
            />

            {/* Large card — WhatsApp */}
            <BentoCard
              span="col-span-7" gridCol="6 / 13" gridRow="2"
              visible={featVis} delay={300}
              accent="#25d366"
              icon={<Icon.Phone />}
              label="פעולות לנייד"
              title="אישור בקליק מה-WhatsApp שלך"
              desc="כל תובנה מגיעה עם פעולה מוכנה — פוסט מנוסח, תגובה לביקורת, script לסרטון. כל פעולה שיוצאת החוצה ממתינה לאישורך."
              tags={['WhatsApp alerts', 'One-click approve', 'Semi-auto mode', 'Full-auto mode']}
              visual={
                <div style={{ marginTop: 20, borderRadius: 14, overflow: 'hidden', background: '#111b21', border: '1px solid rgba(255,255,255,0.07)', maxWidth: 300 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#1f2c34' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #E8344D, #9333ea)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#fff' }}>C</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Cortexi</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>online · Agent active</div>
                    </div>
                  </div>
                  <div style={{ padding: '12px 14px', background: '#0b141a', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ background: '#1f2c34', borderRadius: 10, padding: '9px 12px', fontSize: 12, color: 'rgba(255,255,255,0.75)', lineHeight: 1.5, maxWidth: '90%', alignSelf: 'flex-end' }}>
                      🔥 OTX: טרנד TikTok "before/after" — velocity ×4. פוסט מנוסח מוכן. חלון 48 שעות.{'\n'}
                      <span style={{ color: '#25d366' }}>app.cortexi.ai/approvals</span>
                    </div>
                    <div style={{ background: '#005c4b', borderRadius: 10, padding: '9px 12px', fontSize: 12, color: 'rgba(255,255,255,0.8)', maxWidth: '60%', alignSelf: 'flex-start' }}>
                      אישרתי ✓
                    </div>
                  </div>
                </div>
              }
            />

            {/* Small card — Reputation */}
            <BentoCard
              span="col-span-4" gridCol="1 / 5" gridRow="3"
              visible={featVis} delay={400}
              accent="#f59e0b"
              icon={<Icon.Star />}
              label="מוניטין"
              title="תגובות AI לביקורות"
              desc="Google, Wolt, תן ביס — תגובות בסגנון הקול שלך. אישור מהנייד לפני שעולה."
              tags={['Google Reviews', 'Wolt', 'Auto-draft']}
            />

            {/* Small card — Analytics */}
            <BentoCard
              span="col-span-4" gridCol="5 / 9" gridRow="3"
              visible={featVis} delay={500}
              accent="#06b6d4"
              icon={<Icon.Bars />}
              label="ניתוח שוק"
              title="דוח שבועי + תחזיות"
              desc="דוח שבועי אוטומטי עם ציון ביצועים, המלצות, ותחזית לשבוע הבא — ישירות לנייד."
              tags={['Weekly report', 'Forecasting', 'Score 1-10']}
            />

            {/* Small card — Visual AI */}
            <BentoCard
              span="col-span-4" gridCol="9 / 13" gridRow="3"
              visible={featVis} delay={600}
              accent="#a855f7"
              icon={<Icon.Zap />}
              label="AI ויזואלי"
              title="Gemini Vision מנתח תמונות"
              desc="מזהה מוצרים, אסתטיקה ופורמטים שעולים ב-Instagram ו-TikTok — לפני שמדברים עליהם."
              tags={['Gemini Flash', 'Visual trends', 'Product detection']}
            />
          </div>
        </div>
      </section>

      {/* ═══════════════════════ SOCIAL PROOF ════════════════════ */}
      <section ref={tesiRef} style={{ padding: '80px 24px', background: 'rgba(255,255,255,0.015)', borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48, opacity: tesiVis ? 1 : 0, transform: tesiVis ? 'none' : 'translateY(16px)', transition: 'all 0.6s ease' }}>
            <h2 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 900, letterSpacing: '-0.025em', margin: 0, color: '#FAFAFA' }}>
              מה שבעלי עסקים אומרים
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
            {TESTIMONIALS.map((t, i) => (
              <div key={i}
                className="card-hover"
                style={{
                  padding: '28px 28px 24px', borderRadius: 18,
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                  opacity: tesiVis ? 1 : 0, transform: tesiVis ? 'none' : 'translateY(24px)',
                  transition: `all 0.65s ease ${i * 120}ms`,
                }}
              >
                <div style={{ display: 'flex', gap: 2, marginBottom: 16 }}>
                  {Array.from({ length: t.rating }).map((_, j) => (
                    <svg key={j} width="15" height="15" viewBox="0 0 24 24" fill="#E8344D" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                  ))}
                </div>
                <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.7)', lineHeight: 1.65, margin: '0 0 20px' }}>
                  "{t.text}"
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, rgba(232,52,77,0.4), rgba(147,51,234,0.4))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: '#fff' }}>
                    {t.name[0]}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════ HOW IT WORKS ════════════════════ */}
      <section id="how" ref={howRef} style={{ padding: '100px 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 60, opacity: howVis ? 1 : 0, transform: howVis ? 'none' : 'translateY(16px)', transition: 'all 0.6s ease' }}>
            <div style={{ display: 'inline-block', fontSize: 12, fontWeight: 700, color: '#E8344D', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>מ-0 לתובנה ראשונה</div>
            <h2 style={{ fontSize: 'clamp(2rem, 4.5vw, 3.2rem)', fontWeight: 900, letterSpacing: '-0.025em', margin: 0, color: '#FAFAFA' }}>
              תהליך אחד. 5 דקות.
            </h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
              { n: '01', title: 'מלא פרופיל עסקי', desc: 'שם עסק, קטגוריה, עיר, מתחרים עיקריים. שיחה עם Kori — המערכת שואלת, אתה עונה. 5 דקות.', color: '#E8344D' },
              { n: '02', title: '50+ סוכנים מתחילים', desc: 'בלילה הראשון — Google Trends, TikTok, Instagram, Facebook Groups, Google Maps, Wolt. הכל נסרק אוטומטית.', color: '#9333ea' },
              { n: '03', title: 'בוקר — תובנות בנייד', desc: 'ב-07:00 מגיע לנייד שלך: ברמת שבוע, לידים חמים, טרנדים שזוהו, מתחרים שינו, פעולות מוכנות לאישור.', color: '#22c55e' },
            ].map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: 28, padding: '32px 0', borderBottom: i < 2 ? '1px solid rgba(255,255,255,0.05)' : 'none', opacity: howVis ? 1 : 0, transform: howVis ? 'none' : 'translateX(20px)', transition: `all 0.65s ease ${i * 150}ms` }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: `${step.color}18`, border: `1px solid ${step.color}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 900, fontSize: 16, color: step.color }}>
                  {step.n}
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#FAFAFA', marginBottom: 8, letterSpacing: '-0.02em' }}>{step.title}</div>
                  <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', lineHeight: 1.65 }}>{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════ PRICING ═════════════════════════ */}
      <section id="pricing" ref={pricRef} style={{ padding: '80px 24px 100px', background: 'rgba(255,255,255,0.015)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52, opacity: pricVis ? 1 : 0, transform: pricVis ? 'none' : 'translateY(16px)', transition: 'all 0.6s ease' }}>
            <div style={{ display: 'inline-block', fontSize: 12, fontWeight: 700, color: '#a855f7', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>תמחור פשוט</div>
            <h2 style={{ fontSize: 'clamp(2rem, 4.5vw, 3.2rem)', fontWeight: 900, letterSpacing: '-0.025em', margin: '0 0 12px', color: '#FAFAFA' }}>
              ללא הפתעות
            </h2>
            <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)', margin: 0 }}>התחל חינם, שדרג רק כשאתה מרגיש ערך.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {[
              {
                plan: 'ניסיון חינמי',
                price: null,
                priceLabel: 'חינם',
                period: '7 ימים',
                features: ['7 ימים ללא תשלום', '10 סריקות יומיות', '3 סוכנים פעילים', 'לידים + ביקורות', 'ללא כרטיס אשראי'],
                cta: 'התחל חינם',
                highlight: false,
              },
              {
                plan: 'Basic',
                price: '₪300',
                period: '/חודש',
                features: ['50 סריקות יומיות', '8 סוכנים פעילים', 'מעקב מתחרים', 'טרנדים + לידים', 'ניהול ביקורות', 'WhatsApp התראות'],
                cta: 'בחר Basic',
                highlight: true,
                badge: 'הכי פופולרי',
              },
              {
                plan: 'Premium',
                price: '₪600',
                period: '/חודש',
                features: ['200 סריקות יומיות', 'כל הסוכנים (50+)', 'קמפיינים אוטומטיים', 'TikTok + Instagram', 'ניתוח ויזואלי AI', 'דוח שבועי + תחזיות'],
                cta: 'בחר Premium',
                highlight: false,
              },
            ].map((p, i) => (
              <div key={i}
                className="card-hover"
                style={{
                  position: 'relative', borderRadius: 20, padding: '1px',
                  background: p.highlight ? 'linear-gradient(135deg, #E8344D, #9333ea)' : 'rgba(255,255,255,0.07)',
                  opacity: pricVis ? 1 : 0, transform: pricVis ? 'none' : 'translateY(24px)',
                  transition: `all 0.65s ease ${i * 120}ms`,
                }}
              >
                {p.badge && (
                  <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: 'linear-gradient(135deg, #E8344D, #9333ea)', color: '#fff', fontSize: 12, fontWeight: 800, padding: '4px 14px', borderRadius: 100, whiteSpace: 'nowrap' }}>
                    {p.badge}
                  </div>
                )}
                <div style={{ borderRadius: 19, padding: '28px 24px', background: p.highlight ? '#110a12' : '#0e0e16', height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontWeight: 600, marginBottom: 8 }}>{p.plan}</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontSize: 38, fontWeight: 900, color: '#FAFAFA', letterSpacing: '-0.03em' }}>{p.priceLabel || p.price}</span>
                      {p.period && <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.35)' }}>{p.period}</span>}
                    </div>
                  </div>
                  <ul style={{ flex: 1, listStyle: 'none', padding: 0, margin: '0 0 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {p.features.map(f => (
                      <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, color: 'rgba(255,255,255,0.65)' }}>
                        <span style={{ width: 20, height: 20, borderRadius: '50%', background: p.highlight ? 'rgba(232,52,77,0.18)' : 'rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: p.highlight ? '#E8344D' : 'rgba(255,255,255,0.5)', marginTop: 1 }}>
                          <Icon.Check />
                        </span>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <button onClick={() => go('/sign-up')}
                    style={{
                      width: '100%', padding: '13px 0', borderRadius: 12, border: 'none',
                      background: p.highlight ? 'linear-gradient(135deg, #E8344D, #c2185b)' : 'rgba(255,255,255,0.07)',
                      color: '#fff', fontWeight: 700, fontSize: 14.5, cursor: 'pointer',
                      boxShadow: p.highlight ? '0 6px 24px rgba(232,52,77,0.35)' : 'none',
                      transition: 'opacity 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                  >
                    {p.cta}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <p style={{ textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.25)', marginTop: 24 }}>
            Enterprise?{' '}
            <a href="mailto:hello@cortexi.ai" style={{ color: 'rgba(255,255,255,0.45)', textDecoration: 'underline' }}>צרו קשר לתמחור מותאם</a>
          </p>
        </div>
      </section>

      {/* ═══════════════════════ FAQ ══════════════════════════════ */}
      <section id="faq" style={{ padding: '80px 24px 100px' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 900, letterSpacing: '-0.025em', margin: 0, color: '#FAFAFA' }}>
              שאלות נפוצות
            </h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { q: 'האם צריך ידע טכני?', a: 'בכלל לא. הOnboarding הוא שיחה בעברית עם Kori — 10 שאלות. לא צריך להכיר APIs, analytics, או כלים דיגיטליים.' },
              { q: 'אילו פלטפורמות מחוברות?', a: 'Google Business, Instagram, TikTok, Facebook Groups, Wolt, תן ביס, WhatsApp. ניטור פסיבי עובד אפילו בלי חיבור OAuth.' },
              { q: 'האם המערכת פועלת אוטומטית?', a: 'כן, 24/7. אבל כל פעולה שיוצאת החוצה (תגובה לביקורת, פרסום, WhatsApp) מחכה לאישורך אם בחרת במצב semi-auto.' },
              { q: 'מה קורה אחרי 7 הימים?', a: 'תקבל הודעה לפני שהניסיון מסתיים. לא חייב לשדרג — הנתונים נשמרים 30 יום גם אחרי סיום ניסיון.' },
              { q: 'האם Cortexi מתאים לכל סוגי העסקים?', a: 'כן — מסעדות, פיטנס, יופי, רפואה, נדל"ן, חנויות. המנוע מתאים את עצמו לסקטור שלך אוטומטית עם נתוני benchmark.' },
            ].map((item, i) => <FAQItem key={i} q={item.q} a={item.a} />)}
          </div>
        </div>
      </section>

      {/* ═══════════════════════ FINAL CTA ═══════════════════════ */}
      <section style={{ padding: '0 24px 100px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ position: 'relative', borderRadius: 28, padding: '72px 48px', textAlign: 'center', overflow: 'hidden', background: 'linear-gradient(135deg, rgba(232,52,77,0.12) 0%, rgba(147,51,234,0.1) 100%)', border: '1px solid rgba(232,52,77,0.18)' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 0%, rgba(232,52,77,0.15) 0%, transparent 65%)', pointerEvents: 'none' }} />
            <div style={{ position: 'relative' }}>
              <h2 style={{ fontSize: 'clamp(2rem, 5vw, 3.8rem)', fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.05, margin: '0 0 20px', color: '#FAFAFA' }}>
                תוך שבוע תדע מה<br />
                <span className="grad-text">המתחרים לא יודעים</span>
              </h2>
              <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.5)', margin: '0 0 36px', maxWidth: 500, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
                7 ימים חינם. ללא כרטיס אשראי. ביטול בכל עת.
              </p>
              <button onClick={() => go('/sign-up')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 12,
                  padding: '16px 40px', borderRadius: 16, border: 'none',
                  background: 'linear-gradient(135deg, #E8344D 0%, #c2185b 100%)',
                  color: '#fff', fontWeight: 800, fontSize: 17, cursor: 'pointer',
                  boxShadow: '0 10px 50px rgba(232,52,77,0.45)',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 16px 60px rgba(232,52,77,0.55)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 10px 50px rgba(232,52,77,0.45)'; }}
              >
                התחל ניסיון חינמי — 7 ימים
                <Icon.ArrowLeft />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ FOOTER ══════════════════════════ */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '48px 24px 40px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 40, justifyContent: 'space-between', marginBottom: 40 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #E8344D, #9333ea)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
                  </svg>
                </div>
                <span style={{ fontWeight: 800, fontSize: 16, color: '#fff' }}>Cortexi</span>
              </div>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', maxWidth: 220, lineHeight: 1.6 }}>AI Growth OS לעסקים קטנים-בינוניים בישראל. עברית בלבד.</p>
            </div>
            <div style={{ display: 'flex', gap: 60, flexWrap: 'wrap' }}>
              {[
                { title: 'מוצר', links: [['#features', 'יכולות'], ['#how', 'איך זה עובד'], ['#pricing', 'מחירים']] },
                { title: 'לפי עסק', links: [['/restaurants', 'מסעדות'], ['/fitness', 'פיטנס'], ['/beauty', 'יופי']] },
                { title: 'משפטי', links: [['/terms', 'תנאי שימוש'], ['/privacy', 'פרטיות']] },
              ].map(col => (
                <div key={col.title} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>{col.title}</span>
                  {col.links.map(([href, label]) => (
                    <a key={href} href={href} style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', textDecoration: 'none', transition: 'color 0.2s' }}
                      onMouseEnter={e => e.target.style.color = '#fff'}
                      onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.35)'}
                    >{label}</a>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>© 2026 Cortexi. כל הזכויות שמורות.</span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>עוצב ופותח בישראל 🇮🇱</span>
          </div>
        </div>
      </footer>

      <style>{`
        @media (max-width: 768px) {
          .hidden-mobile { display: none !important; }
        }
        @media (min-width: 769px) {
          .show-mobile { display: none !important; }
        }
      `}</style>
    </div>
  );
}

/* ─── Bento Card ─────────────────────────────────────────────── */
function BentoCard({ gridCol, gridRow, visible, delay = 0, accent, icon, label, title, desc, tags, visual }) {
  return (
    <div
      className="card-hover"
      style={{
        gridColumn: gridCol,
        gridRow: gridRow,
        borderRadius: 18,
        padding: '28px 28px 24px',
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.06)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'none' : 'translateY(28px)',
        transition: `opacity 0.65s ease ${delay}ms, transform 0.65s ease ${delay}ms`,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Accent glow top-right */}
      <div style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, borderRadius: '50%', background: `radial-gradient(circle, ${accent}22, transparent 70%)`, pointerEvents: 'none' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: `${accent}18`, border: `1px solid ${accent}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent }}>
          {icon}
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: accent, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{label}</span>
      </div>

      <h3 style={{ fontSize: 19, fontWeight: 800, color: '#FAFAFA', margin: '0 0 10px', lineHeight: 1.25, letterSpacing: '-0.02em' }}>{title}</h3>
      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', margin: '0 0 16px', lineHeight: 1.65 }}>{desc}</p>

      {tags && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {tags.map(t => (
            <span key={t} style={{ fontSize: 11.5, padding: '4px 10px', borderRadius: 100, background: `${accent}10`, border: `1px solid ${accent}22`, color: 'rgba(255,255,255,0.55)', fontWeight: 500 }}>
              {t}
            </span>
          ))}
        </div>
      )}

      {visual}
    </div>
  );
}

/* ─── FAQ Item ───────────────────────────────────────────────── */
function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      onClick={() => setOpen(o => !o)}
      style={{
        borderRadius: 14, overflow: 'hidden', cursor: 'pointer',
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${open ? 'rgba(232,52,77,0.25)' : 'rgba(255,255,255,0.06)'}`,
        transition: 'border-color 0.2s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#FAFAFA' }}>{q}</span>
        <span style={{ color: 'rgba(255,255,255,0.4)', transition: 'transform 0.25s', transform: open ? 'rotate(45deg)' : 'none', display: 'flex', flexShrink: 0, marginRight: 8 }}>
          <Icon.Plus size={18} />
        </span>
      </div>
      {open && (
        <div style={{ padding: '0 22px 18px', fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7 }}>
          {a}
        </div>
      )}
    </div>
  );
}
