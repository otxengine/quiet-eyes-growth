import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/* ─── Design tokens ──────────────────────────────────────── */
const C = {
  bg:        '#F4F4F9',
  white:     '#FFFFFF',
  border:    '#E2E2EE',
  borderHov: '#C8C8DC',
  primary:   '#E8344D',
  primaryD:  '#C9253B',
  purple:    '#7C3AED',
  orange:    '#F97316',
  dark:      '#1A1F36',
  mid:       '#4A5568',
  light:     '#8E8EA8',
  green:     '#059669',
};

/* ─── Hooks ──────────────────────────────────────────────── */
function useInView(threshold = 0.15) {
  const ref = useRef(null);
  const [v, setV] = useState(false);
  useEffect(() => {
    const o = new IntersectionObserver(([e]) => { if (e.isIntersecting) setV(true); }, { threshold });
    if (ref.current) o.observe(ref.current);
    return () => o.disconnect();
  }, [threshold]);
  return [ref, v];
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

/* ─── SVG Icons ──────────────────────────────────────────── */
const Icons = {
  TrendUp: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  Radar: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>
    </svg>
  ),
  Target: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  ),
  Star: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  ),
  Zap: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  Bell: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  ),
  ArrowLeft: () => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
    </svg>
  ),
  Check: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  ChevronDown: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
  Users: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
};

/* ─── Stat counter ───────────────────────────────────────── */
function Stat({ n, suffix, prefix = '', label, sub, active }) {
  const val = useCounter(n, 1800, active);
  return (
    <div style={{ textAlign: 'center', padding: '0 16px' }}>
      <div style={{ fontSize: 48, fontWeight: 900, color: C.dark, letterSpacing: '-0.04em', lineHeight: 1, fontFamily: 'Heebo, sans-serif' }}>
        {prefix}{val.toLocaleString()}{suffix}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.dark, marginTop: 8 }}>{label}</div>
      {sub && <div style={{ fontSize: 13, color: C.light, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/* ─── Testimonials data ──────────────────────────────────── */
const TESTI = [
  {
    quote: 'שבוע אחד עם Cortexi. גיליתי שהמתחרה מסביב לפינה פתח "ארוחת בוקר" ב-65 שקלים — בדיוק בשעות שלי. הגבתי למחרת עם מבצע. שמרתי על 40 לקוחות.',
    name: 'יוסי כהן',
    role: 'בעלים, מסעדת הגרנד — ת"א',
    initial: 'י',
    color: '#E8344D',
  },
  {
    quote: 'המערכת זיהתה 3 חברות שעמדו לבטל מנוי — 3 שבועות לפני שזה קרה. שלחתי הצעה בפרטי. שניים חזרו. זה שווה 11,400 ₪ בשנה.',
    name: 'מיכל לוי',
    role: 'בעלים, סטודיו Fit+ — רמת גן',
    initial: 'מ',
    color: '#7C3AED',
  },
  {
    quote: 'ראיתי טרנד "ombre nails" ב-TikTok US. Cortexi אמרה שיגיע לישראל בעוד 18 יום. פרסמתי פוסט ראשון בישראל. 47 תורים בשלושה ימים.',
    name: 'אבי שמאי',
    role: 'בעלים, סלון Style — חיפה',
    initial: 'א',
    color: '#F97316',
  },
];

/* ─── Main ───────────────────────────────────────────────── */
export default function LandingMain() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [statsRef, statsV]   = useInView(0.3);
  const [probRef, probV]     = useInView(0.1);
  const [featRef, featV]     = useInView(0.05);
  const [tesiRef, tesiV]     = useInView(0.1);
  const [howRef, howV]       = useInView(0.15);
  const [pricRef, pricV]     = useInView(0.1);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const goSignUp = () => navigate('/sign-up');
  const goSignIn = () => navigate('/sign-in');

  return (
    <div dir="rtl" style={{ background: C.bg, minHeight: '100vh', color: C.dark, fontFamily: 'Heebo, Inter, sans-serif', overflowX: 'hidden' }}>

      {/* ── Fonts + Keyframes ──────────────────────────────── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800;900&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        @keyframes fadeUp   { from{opacity:0;transform:translateY(22px)} to{opacity:1;transform:translateY(0)} }
        @keyframes marquee  { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        @keyframes blink    { 0%,100%{opacity:1} 50%{opacity:0.25} }
        @keyframes shimmer  {
          0%{background-position:-400% center}
          100%{background-position:400% center}
        }
        @keyframes floatA {
          0%,100%{transform:translate(0,0)}
          50%{transform:translate(30px,-20px)}
        }
        @keyframes floatB {
          0%,100%{transform:translate(0,0)}
          50%{transform:translate(-20px,30px)}
        }

        .hero-h1 { animation: fadeUp .65s ease both; }
        .hero-p  { animation: fadeUp .65s .12s ease both; }
        .hero-cta{ animation: fadeUp .65s .22s ease both; }
        .hero-ui { animation: fadeUp .85s .4s ease both; }

        .grad-text {
          background: linear-gradient(110deg, #E8344D 0%, #C026D3 45%, #7C3AED 100%);
          background-size: 300% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer 5s linear infinite;
        }

        .marquee-wrap { overflow: hidden; }
        .marquee-inner { display:flex; gap:12px; width:max-content; animation: marquee 28s linear infinite; }
        .marquee-inner:hover { animation-play-state: paused; }

        .card-lift { transition: transform .22s ease, box-shadow .22s ease; }
        .card-lift:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(0,0,0,0.1) !important; }

        .btn-primary {
          display:inline-flex; align-items:center; gap:10px;
          background: linear-gradient(135deg, #E8344D, #C9253B);
          color:#fff; border:none; border-radius:12px;
          font-family:Heebo,sans-serif; font-weight:800; font-size:16px;
          padding:14px 28px; cursor:pointer;
          box-shadow: 0 4px 20px rgba(232,52,77,0.35);
          transition: transform .15s ease, box-shadow .15s ease;
        }
        .btn-primary:hover { transform:translateY(-2px); box-shadow:0 8px 30px rgba(232,52,77,0.45); }

        .btn-ghost {
          display:inline-flex; align-items:center; gap:8px;
          background:#fff; color:${C.dark}; border:1.5px solid ${C.border};
          border-radius:12px; font-family:Heebo,sans-serif; font-weight:700; font-size:15px;
          padding:14px 24px; cursor:pointer;
          transition: border-color .15s ease, background .15s ease;
        }
        .btn-ghost:hover { border-color:${C.borderHov}; background:#FAFAFA; }

        .dot-blink { animation: blink 2s ease-in-out infinite; }

        ::-webkit-scrollbar { width:5px; }
        ::-webkit-scrollbar-track { background:${C.bg}; }
        ::-webkit-scrollbar-thumb { background:#C8C8DC; border-radius:3px; }

        @media (max-width:768px) { .hide-mobile { display:none !important; } }
        @media (min-width:769px) { .show-mobile { display:none !important; } }
      `}</style>

      {/* ═══════════════════════ NAV ════════════════════════ */}
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        background: scrolled ? 'rgba(244,244,249,0.9)' : C.bg,
        backdropFilter: scrolled ? 'blur(20px)' : 'none',
        borderBottom: `1px solid ${scrolled ? C.border : 'transparent'}`,
        transition: 'all .3s ease',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', height: 66, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>

          {/* Logo */}
          <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0, padding: 0 }}>
            <img src="/logo.jpeg" alt="Cortexi" style={{ height: 42, width: 'auto', display: 'block', borderRadius: 6 }} />
          </button>

          {/* Desktop links */}
          <nav className="hide-mobile" style={{ display: 'flex', gap: 32 }}>
            {[['#features', 'יכולות'], ['#how', 'איך זה עובד'], ['#pricing', 'מחירים'], ['#faq', 'שאלות']].map(([href, label]) => (
              <a key={href} href={href} style={{ fontSize: 15, fontWeight: 600, color: C.mid, textDecoration: 'none', transition: 'color .15s' }}
                onMouseEnter={e => e.target.style.color = C.dark}
                onMouseLeave={e => e.target.style.color = C.mid}>
                {label}
              </a>
            ))}
          </nav>

          {/* CTA */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={goSignIn} className="hide-mobile"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 600, color: C.mid, padding: '8px 12px', fontFamily: 'Heebo, sans-serif', transition: 'color .15s' }}
              onMouseEnter={e => e.target.style.color = C.dark}
              onMouseLeave={e => e.target.style.color = C.mid}>
              התחברות
            </button>
            <button onClick={goSignUp} className="btn-primary" style={{ padding: '9px 22px', fontSize: 15, borderRadius: 10 }}>
              התחל חינם
            </button>
            <button onClick={() => setMenuOpen(o => !o)} className="show-mobile"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.mid, padding: 8 }}>
              <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {menuOpen
                  ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                  : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/>}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: '12px 24px 20px' }}>
            {[['#features', 'יכולות'], ['#how', 'איך זה עובד'], ['#pricing', 'מחירים'], ['#faq', 'שאלות']].map(([href, label]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)}
                style={{ display: 'block', padding: '11px 0', fontSize: 16, fontWeight: 600, color: C.dark, textDecoration: 'none', borderBottom: `1px solid ${C.border}` }}>
                {label}
              </a>
            ))}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={goSignIn} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '12px 0' }}>התחברות</button>
              <button onClick={goSignUp} className="btn-primary" style={{ flex: 1, justifyContent: 'center', padding: '12px 0' }}>התחל חינם</button>
            </div>
          </div>
        )}
      </header>

      {/* ═══════════════════════ HERO ═══════════════════════ */}
      <section style={{ paddingTop: 110, paddingBottom: 80, paddingLeft: 24, paddingRight: 24, textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        {/* Soft gradient blobs */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: -80, right: '15%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(232,52,77,0.08), transparent 70%)', filter: 'blur(50px)', animation: 'floatA 18s ease-in-out infinite' }} />
          <div style={{ position: 'absolute', top: 0, left: '10%', width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle, rgba(124,58,237,0.07), transparent 70%)', filter: 'blur(50px)', animation: 'floatB 22s ease-in-out infinite' }} />
        </div>

        <div style={{ position: 'relative', zIndex: 2, maxWidth: 820, margin: '0 auto' }}>
          {/* Badge */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 16px', borderRadius: 100, background: C.white, border: `1.5px solid ${C.border}`, marginBottom: 28, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <span className="dot-blink" style={{ width: 7, height: 7, borderRadius: '50%', background: C.primary, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: C.mid }}>מערכת ה-AI Growth הראשונה בעברית לעסקים קטנים</span>
          </div>

          {/* H1 */}
          <h1 className="hero-h1" style={{ fontSize: 'clamp(2.8rem, 7vw, 5.4rem)', fontWeight: 900, lineHeight: 1.08, letterSpacing: '-0.03em', marginBottom: 24, color: C.dark }}>
            50 סוכני AI סורקים<br />
            את <span className="grad-text">השוק שלך</span><br />
            כל הלילה
          </h1>

          {/* Sub */}
          <p className="hero-p" style={{ fontSize: 'clamp(1rem, 2vw, 1.2rem)', color: C.mid, lineHeight: 1.7, maxWidth: 600, margin: '0 auto 36px', fontWeight: 400 }}>
            בוקר אחד תתעורר עם לידים חמים, מתחרה שינה מחיר, וטרנד TikTok שאף אחד בישראל עוד לא זיהה. הכל ממתין לאישור שלך — ישירות לנייד.
          </p>

          {/* CTAs */}
          <div className="hero-cta" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
            <button onClick={goSignUp} className="btn-primary" style={{ fontSize: 16 }}>
              התחל ניסיון חינמי — 7 ימים
              <Icons.ArrowLeft />
            </button>
            <button onClick={goSignIn} className="btn-ghost">
              כבר רשום? התחבר
            </button>
          </div>
          <p style={{ fontSize: 13, color: C.light, marginBottom: 56, fontWeight: 500 }}>
            ללא כרטיס אשראי · ביטול בכל עת
          </p>

          {/* Product UI mockup */}
          <div className="hero-ui" style={{
            borderRadius: 20,
            overflow: 'hidden',
            border: `1px solid ${C.border}`,
            boxShadow: '0 32px 80px rgba(26,31,54,0.12), 0 8px 20px rgba(26,31,54,0.06)',
            background: C.white,
            textAlign: 'right',
          }}>
            {/* Window bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', background: '#F9F9FC', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#FC625D' }} />
              <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#FDBC40' }} />
              <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#35CD4B' }} />
              <div style={{ flex: 1, textAlign: 'center' }}>
                <span style={{ fontSize: 12, color: C.light, background: '#EFEFF5', padding: '3px 14px', borderRadius: 6, fontWeight: 500 }}>app.cortexi.ai/dashboard</span>
              </div>
            </div>

            {/* Dashboard */}
            <div style={{ padding: 24, background: C.bg }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: C.dark }}>לוח בקרה — מגה ספורט</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 8, background: 'rgba(232,52,77,0.1)', color: C.primary, border: `1px solid rgba(232,52,77,0.2)` }}>3 פעולות לאישור</span>
                  <span style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 8, background: C.white, color: C.mid, border: `1px solid ${C.border}` }}>עודכן לפני 4 דק'</span>
                </div>
              </div>

              {/* Stats row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                {[
                  { v: '12', l: 'ביקורות חדשות', d: '+3 מאתמול', c: C.primary },
                  { v: '8',  l: 'לידים חמים',    d: '↑62% שבועי', c: C.purple },
                  { v: '4',  l: 'טרנדים זוהו',   d: '3 שבועות מראש', c: C.green },
                  { v: '94%',l: 'ציון מוניטין',  d: '+2% השבוע',  c: C.orange },
                ].map(s => (
                  <div key={s.l} style={{ padding: '14px 16px', borderRadius: 12, background: C.white, border: `1px solid ${C.border}`, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: C.dark, letterSpacing: '-0.5px' }}>{s.v}</div>
                    <div style={{ fontSize: 11, color: C.light, marginTop: 2, fontWeight: 500 }}>{s.l}</div>
                    <div style={{ fontSize: 11, color: s.c, marginTop: 4, fontWeight: 700 }}>{s.d}</div>
                  </div>
                ))}
              </div>

              {/* Signal feed */}
              <div style={{ fontSize: 11, color: C.light, fontWeight: 700, marginBottom: 8, letterSpacing: '0.07em', textTransform: 'uppercase' }}>תובנות אחרונות</div>
              {[
                { dot: C.primary, badge: 'ויראלי', badgeC: C.primary, text: 'TikTok: "before/after fitness" — velocity ×4.7. חלון פעולה: 48 שעות. פוסט מנוסח ממתין לאישורך.' },
                { dot: C.green,   badge: 'טרנד מוקדם', badgeC: C.green,   text: 'Google Trends US: "pilates reformer home" +340% — יגיע לישראל בעוד ~21 יום.' },
                { dot: C.purple,  badge: 'מתחרים',     badgeC: C.purple,  text: 'FitZone פתח "אימון בוקר 06:30" — חסר בלוח זמנים שלך. הצעת פתרון מוכנה.' },
              ].map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 14px', borderRadius: 10, background: C.white, border: `1px solid ${C.border}`, marginBottom: 7, boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: s.dot, marginTop: 5, flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 12.5, color: C.mid, lineHeight: 1.5 }}>{s.text}</div>
                  <span style={{ padding: '3px 9px', borderRadius: 20, background: `${s.badgeC}14`, color: s.badgeC, fontSize: 11, fontWeight: 700, border: `1px solid ${s.badgeC}28`, flexShrink: 0 }}>{s.badge}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ PLATFORM STRIP ════════════ */}
      <div style={{ padding: '18px 0', background: C.white, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.light, textAlign: 'center', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>
          סורק ומחובר לפלטפורמות שלך
        </div>
        <div className="marquee-wrap">
          <div className="marquee-inner">
            {['Google Business', 'Instagram', 'TikTok', 'Facebook Groups', 'WhatsApp', 'Wolt', 'תן ביס', 'Google Trends', 'Google Ads', 'SerpAPI', 'Tavily AI', 'Gemini Vision',
              'Google Business', 'Instagram', 'TikTok', 'Facebook Groups', 'WhatsApp', 'Wolt', 'תן ביס', 'Google Trends', 'Google Ads', 'SerpAPI', 'Tavily AI', 'Gemini Vision'
            ].map((n, i) => (
              <div key={i} style={{ padding: '7px 18px', borderRadius: 100, background: '#F0F0F8', border: `1px solid ${C.border}`, fontSize: 13, color: C.mid, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
                {n}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════════════════ STATS ══════════════════════ */}
      <section ref={statsRef} style={{ padding: '72px 24px', background: C.white, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 0 }}>
          {[
            { n: 50,    suffix: '+',      label: 'סוכני AI פעילים',        sub: 'עובדים בזמן שאתה ישן' },
            { n: 21,    suffix: ' יום',   label: 'זיהוי טרנדים מראש',     sub: 'לפני שמגיע לפיק בישראל' },
            { n: 10000, suffix: '+',      label: 'סריקות שוק יומיות',     sub: 'Google, TikTok, Instagram' },
            { n: 95,    suffix: '%',      label: 'דיוק זיהוי מתחרים',     sub: 'שינויי מחיר, שירות, סושיאל' },
          ].map((s, i) => (
            <div key={i} style={{ borderLeft: i > 0 ? `1px solid ${C.border}` : 'none', padding: '0 24px' }}>
              <Stat {...s} active={statsV} />
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════ PROBLEM ════════════════════ */}
      <section ref={probRef} style={{ padding: '88px 24px', background: C.bg }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52, opacity: probV ? 1 : 0, transform: probV ? 'none' : 'translateY(18px)', transition: 'all .7s ease' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>למה עסקים מפסידים כסף בכל יום</div>
            <h2 style={{ fontSize: 'clamp(1.9rem, 4vw, 3rem)', fontWeight: 900, letterSpacing: '-0.025em', color: C.dark, lineHeight: 1.15 }}>
              המתחרים שלך לא ישנים.<br />
              <span style={{ color: C.mid, fontWeight: 700 }}>ה-AI שלנו גם לא.</span>
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
            {[
              {
                icon: '😰',
                title: 'המתחרה פתח שירות חדש. ידעת?',
                body: 'בלי כלי מעקב — אתה מגלה שבועות אחרי, כשהלקוחות כבר שם. Cortexi שולחת לך התראה עוד באותו לילה.',
                color: C.primary,
                delay: 0,
              },
              {
                icon: '📉',
                title: 'לקוח עומד לעזוב. הוא לא אמר לך.',
                body: '67% מהלקוחות שעוזבים לא מסבירים למה. Cortexi מזהה דפוסי נטישה 3 שבועות לפני — ומציעה מה לעשות.',
                color: C.purple,
                delay: 120,
              },
              {
                icon: '🎯',
                title: 'טרנד TikTok עולה עכשיו. אתה שם?',
                body: 'מה שמפוצץ ב-TikTok US היום מגיע לישראל בעוד 2-3 שבועות. Cortexi מחשבת את הזמן ומכינה לך תוכן.',
                color: C.orange,
                delay: 240,
              },
            ].map((p, i) => (
              <div key={i} className="card-lift"
                style={{
                  padding: '28px', borderRadius: 18, background: C.white, border: `1px solid ${C.border}`,
                  boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
                  opacity: probV ? 1 : 0, transform: probV ? 'none' : 'translateY(24px)',
                  transition: `all .65s ease ${p.delay}ms`,
                }}>
                <div style={{ fontSize: 32, marginBottom: 16 }}>{p.icon}</div>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: C.dark, marginBottom: 10, lineHeight: 1.3 }}>{p.title}</h3>
                <p style={{ fontSize: 14.5, color: C.mid, lineHeight: 1.7, fontWeight: 400 }}>{p.body}</p>
                <div style={{ marginTop: 18, width: 36, height: 3, borderRadius: 2, background: `linear-gradient(90deg, ${p.color}, transparent)` }} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════ FEATURES ═══════════════════ */}
      <section id="features" ref={featRef} style={{ padding: '88px 24px', background: C.white, borderTop: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 1160, margin: '0 auto' }}>
          {/* Header */}
          <div style={{ marginBottom: 52, opacity: featV ? 1 : 0, transform: featV ? 'none' : 'translateY(18px)', transition: 'all .7s ease' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.purple, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>יכולות הליבה</div>
            <h2 style={{ fontSize: 'clamp(1.9rem, 4vw, 3rem)', fontWeight: 900, letterSpacing: '-0.025em', color: C.dark, maxWidth: 560, lineHeight: 1.15 }}>
              כלים שעובדים בשבילך<br />
              <span style={{ color: C.mid, fontWeight: 700 }}>24 שעות, 7 ימים בשבוע</span>
            </h2>
          </div>

          {/* Bento grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 14 }}>

            {/* Large — Trends */}
            <FeatCard
              gridCol="1 / 8" visible={featV} delay={0}
              accent={C.primary} icon={<Icons.TrendUp />}
              label="זיהוי טרנדים"
              title="'pilates reformer' יגיע לישראל בעוד 21 יום. את כבר יודעת?"
              body="מנוע z-score סורק Google Trends US כאינדיקטור מוביל. מה שמפוצץ שם היום — מגיע אלינו בפיגור של 2-6 שבועות. אנחנו מחשבים בדיוק מתי ומכינים לך תוכן."
              tags={['Google Trends IL+US', 'TikTok Viral', 'Instagram Hashtags', 'Facebook Groups']}
              visual={
                <div style={{ marginTop: 20, borderRadius: 12, background: '#F8F8FC', border: `1px solid ${C.border}`, padding: '14px 16px' }}>
                  <div style={{ fontSize: 11, color: C.light, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
                    velocity: "pilates reformer home" → ישראל ~21 יום
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 48 }}>
                    {[14,18,16,20,24,22,26,30,37,44,52,61,72,82,92].map((h, i) => (
                      <div key={i} style={{ flex: 1, height: `${h}%`, borderRadius: 3, background: i >= 10 ? `rgba(232,52,77,${0.3 + i * 0.07})` : '#E2E2EE', transition: 'height .5s ease' }} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                    <span style={{ fontSize: 10, color: C.light, fontWeight: 500 }}>30 ימים אחורה</span>
                    <span style={{ fontSize: 10, color: C.primary, fontWeight: 700 }}>velocity ×4.7 ↑</span>
                  </div>
                </div>
              }
            />

            {/* Medium — Competitors */}
            <FeatCard
              gridCol="8 / 13" visible={featV} delay={100}
              accent={C.purple} icon={<Icons.Radar />}
              label="מעקב מתחרים"
              title="כל שינוי אצל המתחרה — לפני שהלקוחות שלהם הופכים ללקוחות שלך"
              body="Snapshot diff יומי: שינוי מחיר, שירות חדש, פוסט, ביקורת. התראה אוטומטית עם הצעת תגובה."
              tags={['Snapshot diff', 'Price changes', 'Google Maps', 'Social monitor']}
            />

            {/* Medium — WhatsApp */}
            <FeatCard
              gridCol="1 / 6" visible={featV} delay={200}
              accent="#25D366" icon={<Icons.Bell />}
              label="התראות WhatsApp"
              title="אישור בקליק — ישירות מהנייד שלך"
              body="כל פעולה שהמערכת מייצרת ממתינה לאישורך ב-WhatsApp. לחץ אחד — זה יוצא. לא לחצת — לא קרה כלום."
              tags={['WhatsApp alerts', 'One-click approve', 'Semi-auto', 'Full-auto']}
            />

            {/* Large — Lead scoring */}
            <FeatCard
              gridCol="6 / 13" visible={featV} delay={300}
              accent={C.green} icon={<Icons.Target />}
              label="לידים חמים"
              title="8 לידים חמים ממתינים — זה אחד שעומד לקנות עכשיו"
              body="כל ליד מקבל ציון intent ב-0-100: סנטימנט, מילות מפתח רכישה, מיקום, היסטוריה. הלידים הכי חמים עולים ראשונים עם תגובה מוכנה."
              tags={['AI scoring 0-100', 'Intent signals', 'Auto-nurture', 'CRM sync']}
            />

            {/* Small — Reputation */}
            <FeatCard
              gridCol="1 / 5" visible={featV} delay={400}
              accent="#F59E0B" icon={<Icons.Star />}
              label="מוניטין"
              title="ביקורת שלילית? תגובה AI בסגנון שלך תוך 60 שניות"
              body="Google, Wolt, תן ביס — תגובות אוטומטיות שמחכות לאישורך."
              tags={['Google Reviews', 'Wolt', 'Auto-draft']}
            />

            {/* Small — Analytics */}
            <FeatCard
              gridCol="5 / 9" visible={featV} delay={500}
              accent="#0EA5E9" icon={<Icons.Zap />}
              label="ניתוח ויזואלי AI"
              title="Gemini Vision מנתח thumbnails לפני שמדברים עליהם"
              body="מזהה מוצרים, אסתטיקה, פורמטים שעולים — שבועות לפני הפיק."
              tags={['Gemini Flash', 'Visual trends', 'Product detection']}
            />

            {/* Small — Reports */}
            <FeatCard
              gridCol="9 / 13" visible={featV} delay={600}
              accent={C.purple} icon={<Icons.Users />}
              label="דוח שבועי"
              title="ציון ביצועים שבועי עם תחזית לשבוע הבא"
              body="דוח מנוהל AI עם המלצה אחת חדה שמניעה פעולה — ישירות לנייד."
              tags={['Weekly report', 'Forecasting', 'Score 1-10']}
            />
          </div>
        </div>
      </section>

      {/* ═══════════════════════ SOCIAL PROOF ══════════════ */}
      <section ref={tesiRef} style={{ padding: '88px 24px', background: C.bg }}>
        <div style={{ maxWidth: 1160, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48, opacity: tesiV ? 1 : 0, transform: tesiV ? 'none' : 'translateY(18px)', transition: 'all .7s ease' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>תוצאות אמיתיות</div>
            <h2 style={{ fontSize: 'clamp(1.9rem, 4vw, 3rem)', fontWeight: 900, letterSpacing: '-0.025em', color: C.dark }}>
              בעלי עסקים שמדברים במספרים
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
            {TESTI.map((t, i) => (
              <div key={i} className="card-lift"
                style={{
                  padding: '28px', borderRadius: 18, background: C.white, border: `1px solid ${C.border}`,
                  boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
                  opacity: tesiV ? 1 : 0, transform: tesiV ? 'none' : 'translateY(22px)',
                  transition: `all .65s ease ${i * 130}ms`,
                }}>
                {/* Stars */}
                <div style={{ display: 'flex', gap: 3, marginBottom: 16 }}>
                  {[1,2,3,4,5].map(s => <svg key={s} width="16" height="16" viewBox="0 0 24 24" fill={C.primary} stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>)}
                </div>
                <p style={{ fontSize: 15, color: C.mid, lineHeight: 1.7, fontWeight: 400, marginBottom: 22 }}>"{t.quote}"</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: `linear-gradient(135deg, ${t.color}33, ${t.color}66)`, border: `2px solid ${t.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 900, color: t.color, flexShrink: 0 }}>
                    {t.initial}
                  </div>
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

      {/* ═══════════════════════ HOW IT WORKS ══════════════ */}
      <section id="how" ref={howRef} style={{ padding: '88px 24px', background: C.white, borderTop: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56, opacity: howV ? 1 : 0, transform: howV ? 'none' : 'translateY(18px)', transition: 'all .7s ease' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.orange, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>תהליך פשוט</div>
            <h2 style={{ fontSize: 'clamp(1.9rem, 4vw, 3rem)', fontWeight: 900, letterSpacing: '-0.025em', color: C.dark }}>
              מ-0 לתובנה הראשונה — 5 דקות
            </h2>
          </div>

          {[
            { n: '01', color: C.primary,  title: 'ספר לנו על העסק שלך',     body: 'שם, קטגוריה, עיר, מתחרים עיקריים. שיחה בעברית עם Kori — 10 שאלות, 5 דקות. לא צריך ידע טכני.' },
            { n: '02', color: C.purple,   title: '50+ סוכנים נכנסים לפעולה', body: 'בלילה הראשון — Google Trends, TikTok, Instagram, Facebook Groups, Google Maps, Wolt. הכל נסרק אוטומטית.' },
            { n: '03', color: C.green,    title: 'תובנות ופעולות — לנייד שלך', body: 'כל בוקר ב-07:00: ברמת שבוע, לידים חמים, טרנדים, מתחרים שינו, פעולות מוכנות לאישורך ב-WhatsApp.' },
          ].map((s, i) => (
            <div key={i} style={{
              display: 'flex', gap: 24, padding: '28px 0',
              borderBottom: i < 2 ? `1px solid ${C.border}` : 'none',
              opacity: howV ? 1 : 0, transform: howV ? 'none' : 'translateX(20px)',
              transition: `all .65s ease ${i * 150}ms`,
            }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: `${s.color}12`, border: `1.5px solid ${s.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 15, color: s.color, flexShrink: 0, fontFamily: 'Heebo, sans-serif' }}>
                {s.n}
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.dark, marginBottom: 8, letterSpacing: '-0.02em' }}>{s.title}</div>
                <div style={{ fontSize: 15, color: C.mid, lineHeight: 1.7, fontWeight: 400 }}>{s.body}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════ PRICING ═══════════════════ */}
      <section id="pricing" ref={pricRef} style={{ padding: '88px 24px', background: C.bg }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52, opacity: pricV ? 1 : 0, transform: pricV ? 'none' : 'translateY(18px)', transition: 'all .7s ease' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.purple, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>תמחור פשוט</div>
            <h2 style={{ fontSize: 'clamp(1.9rem, 4vw, 3rem)', fontWeight: 900, letterSpacing: '-0.025em', color: C.dark, marginBottom: 10 }}>
              ללא הפתעות. ללא מחויבות.
            </h2>
            <p style={{ fontSize: 16, color: C.mid, fontWeight: 400 }}>התחל חינם, שדרג רק כשאתה מרגיש ערך ממשי.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 16 }}>
            {[
              {
                plan: 'ניסיון חינמי', price: '₪0', period: '7 ימים',
                features: ['7 ימים ללא תשלום', '10 סריקות שוק יומיות', '3 סוכנים פעילים', 'לידים + ביקורות', 'ללא כרטיס אשראי'],
                cta: 'התחל חינם', highlight: false,
              },
              {
                plan: 'Basic', price: '₪300', period: 'לחודש',
                features: ['50 סריקות יומיות', '8 סוכנים פעילים', 'מעקב מתחרים מלא', 'זיהוי טרנדים', 'ניהול ביקורות', 'התראות WhatsApp'],
                cta: 'בחר Basic', highlight: true, badge: 'הכי פופולרי',
              },
              {
                plan: 'Premium', price: '₪600', period: 'לחודש',
                features: ['200 סריקות יומיות', '50+ סוכנים פעילים', 'קמפיינים אוטומטיים', 'TikTok + Instagram AI', 'ניתוח ויזואלי Gemini', 'דוח שבועי + תחזיות'],
                cta: 'בחר Premium', highlight: false,
              },
            ].map((p, i) => (
              <div key={i}
                style={{
                  position: 'relative', borderRadius: 20,
                  background: p.highlight ? C.dark : C.white,
                  border: p.highlight ? 'none' : `1.5px solid ${C.border}`,
                  boxShadow: p.highlight ? '0 16px 48px rgba(26,31,54,0.18)' : '0 2px 12px rgba(0,0,0,0.04)',
                  padding: '28px 24px',
                  opacity: pricV ? 1 : 0, transform: pricV ? 'none' : 'translateY(24px)',
                  transition: `all .65s ease ${i * 120}ms`,
                  display: 'flex', flexDirection: 'column',
                }}>
                {p.badge && (
                  <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: `linear-gradient(135deg, ${C.primary}, ${C.purple})`, color: '#fff', fontSize: 12, fontWeight: 800, padding: '4px 16px', borderRadius: 100, whiteSpace: 'nowrap' }}>
                    {p.badge}
                  </div>
                )}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: p.highlight ? 'rgba(255,255,255,0.5)' : C.light, marginBottom: 8 }}>{p.plan}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 40, fontWeight: 900, color: p.highlight ? '#fff' : C.dark, letterSpacing: '-0.04em' }}>{p.price}</span>
                    <span style={{ fontSize: 14, color: p.highlight ? 'rgba(255,255,255,0.45)' : C.light, fontWeight: 500 }}>{p.period}</span>
                  </div>
                </div>
                <ul style={{ flex: 1, listStyle: 'none', marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {p.features.map(f => (
                    <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, color: p.highlight ? 'rgba(255,255,255,0.75)' : C.mid, fontWeight: 400 }}>
                      <span style={{ width: 20, height: 20, borderRadius: '50%', background: p.highlight ? 'rgba(255,255,255,0.1)' : `${C.primary}14`, border: `1px solid ${p.highlight ? 'rgba(255,255,255,0.2)' : `${C.primary}25`}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: p.highlight ? '#fff' : C.primary, marginTop: 1 }}>
                        <Icons.Check />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <button onClick={goSignUp}
                  style={{
                    width: '100%', padding: '13px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: p.highlight ? `linear-gradient(135deg, ${C.primary}, ${C.primaryD})` : C.bg,
                    color: p.highlight ? '#fff' : C.dark,
                    fontWeight: 800, fontSize: 14.5, fontFamily: 'Heebo, sans-serif',
                    boxShadow: p.highlight ? `0 6px 24px rgba(232,52,77,0.35)` : 'none',
                    border: p.highlight ? 'none' : `1.5px solid ${C.border}`,
                    transition: 'opacity .15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                  {p.cta}
                </button>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', fontSize: 13, color: C.light, marginTop: 22, fontWeight: 500 }}>
            Enterprise?{' '}
            <a href="mailto:hello@cortexi.ai" style={{ color: C.mid, textDecoration: 'underline' }}>צרו קשר לתמחור מותאם אישית</a>
          </p>
        </div>
      </section>

      {/* ═══════════════════════ FAQ ════════════════════════ */}
      <section id="faq" style={{ padding: '88px 24px', background: C.white, borderTop: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontSize: 'clamp(1.9rem, 4vw, 2.8rem)', fontWeight: 900, letterSpacing: '-0.025em', color: C.dark }}>שאלות נפוצות</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { q: 'האם צריך ידע טכני כדי להתחיל?', a: 'בכלל לא. הOnboarding הוא שיחה בעברית עם Kori — 10 שאלות, 5 דקות. לא צריך להכיר APIs, analytics, או כלים דיגיטליים. אם יש לך טלפון — זה מספיק.' },
              { q: 'אילו פלטפורמות מחוברות?', a: 'Google Business, Instagram, TikTok, Facebook Groups, Wolt, תן ביס, WhatsApp. ניטור פסיבי עובד אפילו בלי חיבור OAuth — לא נדרש שתתחבר לכל חשבון.' },
              { q: 'האם המערכת פועלת לחלוטין אוטומטית?', a: 'כן, 24/7. אבל כל פעולה שיוצאת החוצה (תגובה לביקורת, פרסום, הצעה ללקוח) מחכה לאישורך אם בחרת במצב semi-auto. שום דבר לא יוצא בלי שאתה יודע.' },
              { q: 'מה קורה אחרי 7 ימי הניסיון?', a: 'תקבל הודעה 2 ימים לפני שהניסיון מסתיים. לא חייב לשדרג — הנתונים שלך נשמרים 30 יום גם אחרי סיום ניסיון, ללא כרטיס אשראי.' },
              { q: 'האם Cortexi מתאים לסקטור שלי?', a: 'כן — מסעדות, פיטנס, יופי, רפואה, נדל"ן, חנויות. המנוע מתכוונן אוטומטית לסקטור שלך עם benchmark ספציפי ומונחי עסק רלוונטיים.' },
            ].map((item, i) => <FAQItem key={i} q={item.q} a={item.a} />)}
          </div>
        </div>
      </section>

      {/* ═══════════════════════ FINAL CTA ══════════════════ */}
      <section style={{ padding: '0 24px 100px', background: C.white }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ borderRadius: 28, padding: '72px 48px', textAlign: 'center', background: C.dark, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: -60, right: -60, width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(232,52,77,0.2), transparent 70%)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: -60, left: -60, width: 280, height: 280, borderRadius: '50%', background: 'radial-gradient(circle, rgba(124,58,237,0.18), transparent 70%)', pointerEvents: 'none' }} />
            <div style={{ position: 'relative' }}>
              <h2 style={{ fontSize: 'clamp(2rem, 5vw, 3.6rem)', fontWeight: 900, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 20 }}>
                תוך 7 ימים תדע מה<br />
                <span className="grad-text">המתחרים שלך לא יודעים</span>
              </h2>
              <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.55)', marginBottom: 36, maxWidth: 480, margin: '0 auto 36px', lineHeight: 1.6, fontWeight: 400 }}>
                7 ימי ניסיון חינמי. ללא כרטיס אשראי. ביטול בכל עת.
              </p>
              <button onClick={goSignUp} className="btn-primary" style={{ fontSize: 17, padding: '16px 40px', borderRadius: 16 }}>
                התחל ניסיון חינמי — 7 ימים
                <Icons.ArrowLeft />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ FOOTER ══════════════════════ */}
      <footer style={{ borderTop: `1px solid ${C.border}`, padding: '48px 24px 40px', background: C.bg }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 40, justifyContent: 'space-between', marginBottom: 40 }}>
            <div>
              <img src="/logo.jpeg" alt="Cortexi" style={{ height: 40, marginBottom: 12, borderRadius: 6 }} />
              <p style={{ fontSize: 13, color: C.light, maxWidth: 220, lineHeight: 1.7, fontWeight: 400 }}>AI Growth OS לעסקים קטנים-בינוניים בישראל.</p>
            </div>
            <div style={{ display: 'flex', gap: 56, flexWrap: 'wrap' }}>
              {[
                { title: 'מוצר', links: [['#features','יכולות'],['#how','איך זה עובד'],['#pricing','מחירים']] },
                { title: 'לפי עסק', links: [['/restaurants','מסעדות'],['/fitness','פיטנס'],['/beauty','יופי']] },
                { title: 'משפטי', links: [['/terms','תנאי שימוש'],['/privacy','פרטיות']] },
              ].map(col => (
                <div key={col.title} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.dark, marginBottom: 4 }}>{col.title}</span>
                  {col.links.map(([href, label]) => (
                    <a key={href} href={href} style={{ fontSize: 13, color: C.light, textDecoration: 'none', fontWeight: 500, transition: 'color .15s' }}
                      onMouseEnter={e => e.target.style.color = C.dark}
                      onMouseLeave={e => e.target.style.color = C.light}>
                      {label}
                    </a>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, paddingTop: 24, borderTop: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 12, color: C.light, fontWeight: 500 }}>© 2026 Cortexi. כל הזכויות שמורות.</span>
            <span style={{ fontSize: 12, color: C.light, fontWeight: 500 }}>עוצב ופותח בישראל 🇮🇱</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ─── Feature card (bento) ───────────────────────────────── */
function FeatCard({ gridCol, visible, delay = 0, accent, icon, label, title, body, tags, visual }) {
  return (
    <div className="card-lift"
      style={{
        gridColumn: gridCol, borderRadius: 18,
        padding: '28px', background: '#FFFFFF',
        border: `1.5px solid ${C.border}`,
        boxShadow: '0 2px 12px rgba(26,31,54,0.05)',
        opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(26px)',
        transition: `opacity .65s ease ${delay}ms, transform .65s ease ${delay}ms`,
        position: 'relative', overflow: 'hidden',
      }}>
      {/* Accent line top */}
      <div style={{ position: 'absolute', top: 0, right: 0, left: 0, height: 3, background: `linear-gradient(90deg, ${accent}, transparent)`, borderRadius: '18px 18px 0 0' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: `${accent}14`, border: `1px solid ${accent}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent }}>
          {icon}
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, color: accent, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
      </div>

      <h3 style={{ fontSize: 17, fontWeight: 800, color: C.dark, marginBottom: 10, lineHeight: 1.3, letterSpacing: '-0.01em' }}>{title}</h3>
      <p style={{ fontSize: 14, color: C.mid, lineHeight: 1.65, fontWeight: 400, marginBottom: tags?.length ? 14 : 0 }}>{body}</p>

      {tags && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {tags.map(t => (
            <span key={t} style={{ fontSize: 11.5, padding: '4px 10px', borderRadius: 100, background: `${accent}0C`, border: `1px solid ${accent}20`, color: C.mid, fontWeight: 600 }}>{t}</span>
          ))}
        </div>
      )}
      {visual}
    </div>
  );
}

/* ─── FAQ Item ───────────────────────────────────────────── */
function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div onClick={() => setOpen(o => !o)}
      style={{
        borderRadius: 14, overflow: 'hidden', cursor: 'pointer',
        background: C.bg, border: `1.5px solid ${open ? C.primary : C.border}`,
        transition: 'border-color .2s',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '17px 20px' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.dark }}>{q}</span>
        <span style={{ color: C.light, transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none', display: 'flex', flexShrink: 0, marginRight: 10 }}>
          <Icons.ChevronDown />
        </span>
      </div>
      {open && (
        <div style={{ padding: '0 20px 17px', fontSize: 14, color: C.mid, lineHeight: 1.75, fontWeight: 400 }}>{a}</div>
      )}
    </div>
  );
}
