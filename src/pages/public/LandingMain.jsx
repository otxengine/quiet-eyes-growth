/**
 * Cortexi — Premium Marketing Landing Page
 * Design: Glassmorphism · Bento Grid · Heebo · Micro-animations
 * Palette: #F4F4F9 bg · #E8344D red · #7C3AED purple · #1A1F36 dark
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/* ─── Design tokens ──────────────────────────────────────── */
const T = {
  bg:       '#F0F0F7',
  glass:    'rgba(255,255,255,0.62)',
  glassDk:  'rgba(255,255,255,0.45)',
  glassB:   'rgba(255,255,255,0.85)',
  white:    '#FFFFFF',
  border:   'rgba(255,255,255,0.75)',
  borderSm: 'rgba(200,200,220,0.5)',
  red:      '#E8344D',
  redD:     '#C9253B',
  redG:     'linear-gradient(135deg,#E8344D,#C9253B)',
  purple:   '#7C3AED',
  purpleL:  '#A78BFA',
  orange:   '#F97316',
  dark:     '#1A1F36',
  mid:      '#4A5568',
  light:    '#8E8EA8',
  green:    '#059669',
};

/* ─── Hooks ──────────────────────────────────────────────── */
function useInView(threshold = 0.12) {
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
    const raf = (now) => {
      const p = Math.min((now - t0) / duration, 1);
      setVal(Math.floor((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
  }, [target, duration, active]);
  return val;
}

/* ─── Custom SVG Line Icons ──────────────────────────────── */
const Icon = {
  // Market intelligence radar
  Radar: ({ size = 22, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="5.5" strokeDasharray="2 3"/><circle cx="12" cy="12" r="9"/>
      <line x1="12" y1="3" x2="12" y2="1"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="3" y1="12" x2="1" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
    </svg>
  ),
  // Trend line up
  TrendUp: ({ size = 22, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
    </svg>
  ),
  // Shield check
  Shield: ({ size = 22, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>
    </svg>
  ),
  // Target / leads
  Target: ({ size = 22, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  ),
  // Phone / mobile approval
  Mobile: ({ size = 22, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="2.5"/>
    </svg>
  ),
  // Star review
  Star: ({ size = 22, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  ),
  // Zap / speed
  Zap: ({ size = 22, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  // Chart bar
  BarChart: ({ size = 22, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  ),
  // Arrow left (RTL primary)
  ArrowLeft: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
    </svg>
  ),
  Check: ({ size = 13 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  ChevDown: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
  Menu: () => (
    <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
    </svg>
  ),
  X: () => (
    <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
    </svg>
  ),
};

/* ─── Animated stat ──────────────────────────────────────── */
function StatNum({ n, suffix = '', label, sub, active }) {
  const val = useCounter(n, 2000, active);
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 46, fontWeight: 900, color: T.dark, letterSpacing: '-0.04em', lineHeight: 1, fontFamily: 'Heebo,sans-serif' }}>
        {val.toLocaleString()}{suffix}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.dark, marginTop: 8 }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: T.light, marginTop: 3, fontWeight: 500 }}>{sub}</div>}
    </div>
  );
}

/* ─── Icon badge ─────────────────────────────────────────── */
function IconBadge({ icon, color, bg }) {
  return (
    <div style={{
      width: 42, height: 42, borderRadius: 12,
      background: bg || `${color}18`,
      border: `1.5px solid ${color}30`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      boxShadow: `0 2px 8px ${color}20`,
    }}>
      {icon}
    </div>
  );
}

/* ─── Testimonials ───────────────────────────────────────── */
const TESTI = [
  { q: 'שבוע אחד עם Cortexi. המתחרה מסביב לפינה פתח "ארוחת בוקר" ב-65 ₪ בדיוק בשעות שלי. הגבתי למחרת. שמרתי על 40 לקוחות קבועים.', name: 'יוסי כהן', role: 'בעלים, מסעדת הגרנד — ת"א', init: 'י', color: T.red },
  { q: 'המערכת זיהתה 3 חברות שעמדו לבטל מנוי — 3 שבועות לפני שזה קרה. שלחתי הצעה אישית. שניים חזרו. שווה 11,400 ₪ בשנה.', name: 'מיכל לוי', role: 'בעלים, סטודיו Fit+ — רמת גן', init: 'מ', color: T.purple },
  { q: 'Cortexi אמרה שטרנד "ombre nails" יגיע לישראל בעוד 18 יום. פרסמתי ראשון. 47 תורים בשלושה ימים.', name: 'אבי שמאי', role: 'בעלים, סלון Style — חיפה', init: 'א', color: T.orange },
];

/* ─── Main component ─────────────────────────────────────── */
export default function LandingMain() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const [hovCard, setHovCard] = useState(null);

  const [heroRef, heroV]   = useInView(0.1);
  const [statsRef, statsV] = useInView(0.3);
  const [probRef, probV]   = useInView(0.1);
  const [bentRef, bentV]   = useInView(0.04);
  const [tesiRef, tesiV]   = useInView(0.1);
  const [howRef, howV]     = useInView(0.15);
  const [pricRef, pricV]   = useInView(0.1);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 48);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const go = useCallback((p) => navigate(p), [navigate]);

  return (
    <div dir="rtl" style={{ background: T.bg, minHeight: '100vh', color: T.dark, fontFamily: 'Heebo, system-ui, sans-serif', overflowX: 'hidden' }}>

      {/* ── Global styles ─────────────────────────────────── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800;900&display=swap');
        *, *::before, *::after { box-sizing: border-box; }

        /* Background mesh */
        body { background: #F0F0F7; }

        /* Keyframes */
        @keyframes fadeUp   { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn   { from{opacity:0} to{opacity:1} }
        @keyframes floatA   { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(40px,-30px) scale(1.04)} }
        @keyframes floatB   { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-30px,35px) scale(1.02)} }
        @keyframes floatC   { 0%,100%{transform:translate(0,0)} 50%{transform:translate(20px,-20px)} }
        @keyframes marquee  { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        @keyframes shimmer  { 0%{background-position:-400% center} 100%{background-position:400% center} }
        @keyframes blink    { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes pulseRed { 0%,100%{box-shadow:0 4px 20px rgba(232,52,77,0.35)} 50%{box-shadow:0 4px 32px rgba(232,52,77,0.6)} }
        @keyframes slideIn  { from{opacity:0;transform:translateX(12px)} to{opacity:1;transform:translateX(0)} }

        .grad-text {
          background: linear-gradient(110deg, #E8344D 0%, #C026D3 50%, #7C3AED 100%);
          background-size: 300% auto;
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer 5s linear infinite;
        }

        .hero-in   { animation: fadeUp .7s ease both; }
        .hero-in-2 { animation: fadeUp .7s .15s ease both; }
        .hero-in-3 { animation: fadeUp .7s .28s ease both; }
        .hero-ui   { animation: fadeUp .9s .45s ease both; }

        .marquee-wrap { overflow:hidden; }
        .marquee-inner{ display:flex; gap:12px; width:max-content; animation:marquee 30s linear infinite; }
        .marquee-inner:hover { animation-play-state:paused; }

        /* Glass card */
        .glass {
          background: rgba(255,255,255,0.60);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1.5px solid rgba(255,255,255,0.80);
          box-shadow: 0 4px 24px rgba(26,31,54,0.07), 0 1px 4px rgba(26,31,54,0.04);
        }

        /* Hover lift */
        .lift {
          transition: transform .22s ease, box-shadow .22s ease;
          cursor: default;
        }
        .lift:hover {
          transform: translateY(-5px);
          box-shadow: 0 16px 48px rgba(26,31,54,0.11), 0 4px 12px rgba(26,31,54,0.07) !important;
        }

        /* Primary button */
        .btn-red {
          display:inline-flex; align-items:center; gap:10px;
          background: linear-gradient(135deg,#E8344D,#C9253B);
          color:#fff; border:none; border-radius:12px;
          font-family:Heebo,sans-serif; font-weight:800; font-size:16px;
          padding:15px 30px; cursor:pointer;
          box-shadow: 0 4px 20px rgba(232,52,77,0.35);
          transition: transform .15s ease, box-shadow .15s ease;
          animation: pulseRed 3s ease-in-out infinite;
        }
        .btn-red:hover { transform:translateY(-2px); box-shadow:0 8px 32px rgba(232,52,77,0.5); animation:none; }

        /* Ghost button */
        .btn-ghost {
          display:inline-flex; align-items:center; gap:8px;
          background: rgba(255,255,255,0.7);
          backdrop-filter: blur(12px);
          color:${T.dark}; border:1.5px solid rgba(200,200,220,0.6);
          border-radius:12px; font-family:Heebo,sans-serif; font-weight:700; font-size:15px;
          padding:15px 24px; cursor:pointer;
          transition: background .15s ease, border-color .15s ease;
        }
        .btn-ghost:hover { background:rgba(255,255,255,0.9); border-color:rgba(180,180,210,0.8); }

        .dot-blink { animation: blink 2s ease-in-out infinite; }

        ::-webkit-scrollbar { width:5px; }
        ::-webkit-scrollbar-track { background:${T.bg}; }
        ::-webkit-scrollbar-thumb { background:rgba(124,58,237,0.2); border-radius:3px; }

        @media(max-width:768px){ .hide-mob{display:none!important;} }
        @media(min-width:769px){ .show-mob{display:none!important;} }

        /* Bento responsive */
        @media(max-width:900px) {
          .bento-grid { grid-template-columns:1fr!important; }
          .bento-grid > * { grid-column:1!important; grid-row:auto!important; }
        }
        @media(max-width:640px) {
          .stats-grid { grid-template-columns:1fr 1fr!important; }
          .pricing-grid { grid-template-columns:1fr!important; }
        }
      `}</style>

      {/* ── Ambient background orbs ────────────────────────── */}
      <div aria-hidden style={{ position:'fixed', inset:0, pointerEvents:'none', zIndex:0, overflow:'hidden' }}>
        <div style={{ position:'absolute', top:'-10%', right:'-5%', width:700, height:700, borderRadius:'50%', background:'radial-gradient(circle, rgba(232,52,77,0.07) 0%, transparent 65%)', filter:'blur(60px)', animation:'floatA 22s ease-in-out infinite' }} />
        <div style={{ position:'absolute', bottom:'-5%', left:'-8%', width:600, height:600, borderRadius:'50%', background:'radial-gradient(circle, rgba(124,58,237,0.07) 0%, transparent 65%)', filter:'blur(60px)', animation:'floatB 28s ease-in-out infinite' }} />
        <div style={{ position:'absolute', top:'45%', left:'38%', width:400, height:400, borderRadius:'50%', background:'radial-gradient(circle, rgba(249,115,22,0.04) 0%, transparent 65%)', filter:'blur(50px)', animation:'floatC 18s ease-in-out infinite' }} />
      </div>

      {/* ═══════════════ NAV ══════════════════════════════════ */}
      <header style={{
        position:'fixed', top:0, left:0, right:0, zIndex:200,
        background: scrolled ? 'rgba(240,240,247,0.85)' : 'transparent',
        backdropFilter: scrolled ? 'blur(24px)' : 'none',
        borderBottom: scrolled ? '1px solid rgba(200,200,220,0.4)' : 'none',
        transition:'all .3s ease',
      }}>
        <div style={{ maxWidth:1200, margin:'0 auto', padding:'0 28px', height:68, display:'flex', alignItems:'center', justifyContent:'space-between', position:'relative', zIndex:1 }}>
          {/* Logo */}
          <button onClick={() => window.scrollTo({ top:0, behavior:'smooth' })} style={{ background:'none', border:'none', cursor:'pointer', padding:0, display:'flex', alignItems:'center' }}>
            <img src="/logo.jpeg" alt="Cortexi" style={{ height:44, width:'auto', borderRadius:8, display:'block' }} />
          </button>

          {/* Desktop nav */}
          <nav className="hide-mob" style={{ display:'flex', gap:36 }}>
            {[['#features','יכולות'],['#how','איך זה עובד'],['#pricing','מחירים'],['#faq','שאלות']].map(([href,label]) => (
              <a key={href} href={href} style={{ fontSize:15, fontWeight:600, color:T.mid, textDecoration:'none', transition:'color .15s' }}
                onMouseEnter={e=>e.target.style.color=T.dark} onMouseLeave={e=>e.target.style.color=T.mid}>{label}</a>
            ))}
          </nav>

          {/* CTA pair */}
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <button onClick={() => go('/sign-in')} className="hide-mob"
              style={{ background:'none', border:'none', cursor:'pointer', fontSize:15, fontWeight:600, color:T.mid, padding:'8px 12px', fontFamily:'Heebo,sans-serif', transition:'color .15s' }}
              onMouseEnter={e=>e.target.style.color=T.dark} onMouseLeave={e=>e.target.style.color=T.mid}>
              התחברות
            </button>
            <button onClick={() => go('/sign-up')} className="btn-red" style={{ padding:'10px 22px', fontSize:14.5, borderRadius:10, animation:'none', boxShadow:'0 4px 16px rgba(232,52,77,0.35)' }}>
              התחל חינם
            </button>
            <button className="show-mob" onClick={() => setMenu(o=>!o)} style={{ background:'none', border:'none', cursor:'pointer', color:T.mid, padding:8 }}>
              {menu ? <Icon.X /> : <Icon.Menu />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menu && (
          <div className="glass" style={{ borderTop:'1px solid rgba(200,200,220,0.4)', padding:'12px 28px 20px', animation:'slideIn .2s ease' }}>
            {[['#features','יכולות'],['#how','איך זה עובד'],['#pricing','מחירים'],['#faq','שאלות']].map(([href,label]) => (
              <a key={href} href={href} onClick={() => setMenu(false)}
                style={{ display:'block', padding:'12px 0', fontSize:16, fontWeight:600, color:T.dark, textDecoration:'none', borderBottom:'1px solid rgba(200,200,220,0.3)' }}>{label}</a>
            ))}
            <div style={{ display:'flex', gap:10, marginTop:16 }}>
              <button onClick={() => go('/sign-in')} className="btn-ghost" style={{ flex:1, justifyContent:'center', padding:'12px 0' }}>התחברות</button>
              <button onClick={() => go('/sign-up')} className="btn-red" style={{ flex:1, justifyContent:'center', padding:'12px 0', animation:'none' }}>התחל חינם</button>
            </div>
          </div>
        )}
      </header>

      {/* ═══════════════ HERO ═════════════════════════════════ */}
      <section ref={heroRef} style={{ position:'relative', zIndex:1, minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'120px 28px 80px', textAlign:'center' }}>

        <div style={{ maxWidth:860, width:'100%' }}>
          {/* Live badge */}
          <div className="hero-in glass" style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'7px 18px', borderRadius:100, marginBottom:32 }}>
            <span className="dot-blink" style={{ width:7, height:7, borderRadius:'50%', background:T.red, display:'inline-block', flexShrink:0 }} />
            <span style={{ fontSize:13, fontWeight:700, color:T.mid }}>מערכת ה-AI Growth הראשונה בעברית לעסקים קטנים</span>
          </div>

          {/* H1 */}
          <h1 className="hero-in-2" style={{ fontSize:'clamp(3rem,7.5vw,5.8rem)', fontWeight:900, lineHeight:1.05, letterSpacing:'-0.035em', marginBottom:26, color:T.dark }}>
            50 סוכני AI סורקים<br />
            את <span className="grad-text">השוק שלך</span><br />
            כל הלילה
          </h1>

          {/* Subheadline */}
          <p className="hero-in-3" style={{ fontSize:'clamp(1rem,2.2vw,1.22rem)', color:T.mid, lineHeight:1.72, maxWidth:580, margin:'0 auto 38px', fontWeight:400 }}>
            בוקר אחד תתעורר עם לידים חמים, מתחרה שינה מחיר, וטרנד TikTok שאף אחד בישראל עוד לא זיהה — הכל ממתין לאישורך ישירות בנייד.
          </p>

          {/* CTAs */}
          <div className="hero-in-3" style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap', marginBottom:14 }}>
            <button onClick={() => go('/sign-up')} className="btn-red" style={{ fontSize:16 }}>
              התחל ניסיון חינמי — 7 ימים <Icon.ArrowLeft />
            </button>
            <button onClick={() => go('/sign-in')} className="btn-ghost">
              כבר רשום? התחבר
            </button>
          </div>
          <p className="hero-in-3" style={{ fontSize:13, color:T.light, marginBottom:60, fontWeight:500 }}>ללא כרטיס אשראי · ביטול בכל עת</p>

          {/* Dashboard preview — glass card */}
          <div className="hero-ui glass lift" style={{ borderRadius:22, overflow:'hidden', boxShadow:'0 40px 80px rgba(26,31,54,0.14), 0 8px 24px rgba(26,31,54,0.07)', textAlign:'right' }}>
            {/* Window chrome */}
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 18px', background:'rgba(255,255,255,0.5)', borderBottom:'1px solid rgba(200,200,220,0.3)' }}>
              <div style={{ width:11, height:11, borderRadius:'50%', background:'#FC625D' }} />
              <div style={{ width:11, height:11, borderRadius:'50%', background:'#FDBC40' }} />
              <div style={{ width:11, height:11, borderRadius:'50%', background:'#35CD4B' }} />
              <div style={{ flex:1, textAlign:'center' }}>
                <span style={{ fontSize:12, color:T.light, background:'rgba(200,200,220,0.35)', padding:'3px 14px', borderRadius:6, fontWeight:500 }}>app.cortexi.ai/dashboard</span>
              </div>
            </div>

            {/* Dashboard body */}
            <div style={{ padding:24, background:'rgba(244,244,249,0.6)', backdropFilter:'blur(8px)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                <div style={{ fontSize:17, fontWeight:800, color:T.dark }}>לוח בקרה — מגה ספורט</div>
                <div style={{ display:'flex', gap:8 }}>
                  <span style={{ fontSize:12, fontWeight:700, padding:'5px 12px', borderRadius:8, background:'rgba(232,52,77,0.1)', color:T.red, border:'1px solid rgba(232,52,77,0.2)' }}>3 פעולות לאישור</span>
                </div>
              </div>

              {/* KPI row */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:14 }}>
                {[
                  { v:'12', l:'ביקורות חדשות', d:'+3 מאתמול', c:T.red },
                  { v:'8',  l:'לידים חמים',    d:'↑62% שבועי', c:T.purple },
                  { v:'4',  l:'טרנדים זוהו',   d:'~21 יום מראש', c:T.green },
                  { v:'94%',l:'ציון מוניטין',  d:'+2% השבוע',   c:T.orange },
                ].map(s => (
                  <div key={s.l} className="glass" style={{ padding:'12px 14px', borderRadius:12 }}>
                    <div style={{ fontSize:21, fontWeight:900, color:T.dark, letterSpacing:'-0.04em' }}>{s.v}</div>
                    <div style={{ fontSize:11, color:T.light, marginTop:2, fontWeight:500 }}>{s.l}</div>
                    <div style={{ fontSize:11, color:s.c, marginTop:4, fontWeight:700 }}>{s.d}</div>
                  </div>
                ))}
              </div>

              {/* Signal feed */}
              <div style={{ fontSize:10, color:T.light, fontWeight:700, marginBottom:7, letterSpacing:'0.08em', textTransform:'uppercase' }}>תובנות אחרונות</div>
              {[
                { dot:T.red,    badge:'ויראלי',     t:'TikTok: "before/after fitness" — velocity ×4.7. חלון פעולה: 48 שעות.' },
                { dot:T.green,  badge:'טרנד מוקדם', t:'Google Trends US: "pilates reformer" +340% — יגיע לישראל בעוד ~21 יום.' },
                { dot:T.purple, badge:'מתחרים',     t:'FitZone פתח "אימון 06:30" — חסר בלוח שלך. הצעת פתרון מוכנה.' },
              ].map((s,i) => (
                <div key={i} className="glass" style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 13px', borderRadius:10, marginBottom:6 }}>
                  <div style={{ width:6, height:6, borderRadius:'50%', background:s.dot, flexShrink:0 }} />
                  <div style={{ flex:1, fontSize:12.5, color:T.mid, lineHeight:1.45 }}>{s.t}</div>
                  <span style={{ padding:'2px 9px', borderRadius:20, background:`${s.dot}15`, color:s.dot, fontSize:11, fontWeight:700, border:`1px solid ${s.dot}28`, flexShrink:0 }}>{s.badge}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════ PLATFORMS STRIP ═════════════════════ */}
      <div style={{ position:'relative', zIndex:1, padding:'18px 0', background:'rgba(255,255,255,0.5)', backdropFilter:'blur(12px)', borderTop:'1px solid rgba(200,200,220,0.35)', borderBottom:'1px solid rgba(200,200,220,0.35)' }}>
        <div style={{ fontSize:11, fontWeight:700, color:T.light, textAlign:'center', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:13 }}>סורק ומחובר לפלטפורמות שלך</div>
        <div className="marquee-wrap">
          <div className="marquee-inner">
            {['Google Business','Instagram','TikTok','Facebook Groups','WhatsApp','Wolt','תן ביס','Google Trends','SerpAPI','Tavily AI','Gemini Vision','Google Ads',
              'Google Business','Instagram','TikTok','Facebook Groups','WhatsApp','Wolt','תן ביס','Google Trends','SerpAPI','Tavily AI','Gemini Vision','Google Ads'
            ].map((n,i) => (
              <div key={i} className="glass" style={{ padding:'6px 16px', borderRadius:100, fontSize:13, color:T.mid, fontWeight:600, whiteSpace:'nowrap', flexShrink:0 }}>{n}</div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════════ STATS ════════════════════════════════ */}
      <section ref={statsRef} style={{ position:'relative', zIndex:1, padding:'72px 28px' }}>
        <div className="stats-grid" style={{ maxWidth:1000, margin:'0 auto', display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:0 }}>
          {[
            { n:50,    suf:'+',    label:'סוכני AI פעילים',     sub:'עובדים 24/7' },
            { n:21,    suf:' יום', label:'זיהוי טרנדים מראש',  sub:'לפני הפיק בישראל' },
            { n:10000, suf:'+',    label:'סריקות שוק יומיות',  sub:'Google · TikTok · Instagram' },
            { n:95,    suf:'%',    label:'דיוק זיהוי מתחרים',  sub:'שינוי מחיר · שירות · סושיאל' },
          ].map((s,i) => (
            <div key={i} style={{ borderLeft:i>0?'1px solid rgba(200,200,220,0.4)':'none', padding:'0 28px' }}>
              <StatNum n={s.n} suffix={s.suf} label={s.label} sub={s.sub} active={statsV} />
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════ PROBLEM SECTION ══════════════════════ */}
      <section ref={probRef} style={{ position:'relative', zIndex:1, padding:'24px 28px 88px' }}>
        <div style={{ maxWidth:1160, margin:'0 auto' }}>
          <div style={{ textAlign:'center', marginBottom:48, opacity:probV?1:0, transform:probV?'none':'translateY(18px)', transition:'all .7s ease' }}>
            <div style={{ fontSize:12, fontWeight:800, color:T.red, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:14 }}>למה עסקים מפסידים כסף כל יום</div>
            <h2 style={{ fontSize:'clamp(2rem,4.5vw,3.1rem)', fontWeight:900, letterSpacing:'-0.03em', color:T.dark, lineHeight:1.12 }}>
              המתחרים שלך לא ישנים.<br/>
              <span style={{ color:T.mid, fontWeight:700 }}>ה-AI שלנו גם לא.</span>
            </h2>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))', gap:16 }}>
            {[
              { emoji:'😰', title:'המתחרה פתח שירות חדש. ידעת?', body:'בלי כלי מעקב אתה מגלה שבועות אחרי, כשהלקוחות כבר שם. Cortexi שולחת התראה עוד באותו לילה — עם הצעת תגובה מוכנה.', accent:T.red, delay:0 },
              { emoji:'📉', title:'לקוח עומד לעזוב. הוא לא אמר לך.', body:'67% מהלקוחות שעוזבים לא מסבירים למה. Cortexi מזהה דפוסי נטישה 3 שבועות מראש ומציעה מה לעשות — לפני שזה קורה.', accent:T.purple, delay:120 },
              { emoji:'🎯', title:'טרנד TikTok עולה. אתה עוד לא שם.', body:'מה שמפוצץ ב-TikTok US מגיע לישראל בעוד 2-3 שבועות. Cortexi מחשבת את הזמן ומכינה לך פוסט — כדי שתהיה ראשון.', accent:T.orange, delay:240 },
            ].map((p,i) => (
              <div key={i} className="glass lift" style={{
                padding:'28px', borderRadius:20,
                boxShadow:'0 4px 24px rgba(26,31,54,0.07)',
                opacity:probV?1:0, transform:probV?'none':'translateY(24px)',
                transition:`all .7s ease ${p.delay}ms`,
              }}>
                <div style={{ fontSize:34, marginBottom:18 }}>{p.emoji}</div>
                <h3 style={{ fontSize:18.5, fontWeight:800, color:T.dark, marginBottom:10, lineHeight:1.3 }}>{p.title}</h3>
                <p style={{ fontSize:14.5, color:T.mid, lineHeight:1.72, fontWeight:400 }}>{p.body}</p>
                <div style={{ marginTop:20, width:40, height:3, borderRadius:2, background:`linear-gradient(90deg,${p.accent},transparent)` }} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════ BENTO FEATURES ═══════════════════════ */}
      <section id="features" ref={bentRef} style={{ position:'relative', zIndex:1, padding:'24px 28px 100px' }}>
        <div style={{ maxWidth:1200, margin:'0 auto' }}>
          {/* Section header */}
          <div style={{ marginBottom:52, opacity:bentV?1:0, transform:bentV?'none':'translateY(18px)', transition:'all .7s ease' }}>
            <div style={{ fontSize:12, fontWeight:800, color:T.purple, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:14 }}>יכולות הליבה</div>
            <h2 style={{ fontSize:'clamp(2rem,4.5vw,3.1rem)', fontWeight:900, letterSpacing:'-0.03em', color:T.dark, maxWidth:500, lineHeight:1.12 }}>
              כלים שעובדים בשבילך<br/>
              <span style={{ color:T.mid, fontWeight:700 }}>24 שעות, 7 ימים בשבוע</span>
            </h2>
          </div>

          {/* Bento grid */}
          <div className="bento-grid" style={{ display:'grid', gridTemplateColumns:'repeat(12,1fr)', gridTemplateRows:'auto', gap:14 }}>

            {/* ── LARGE: Market Intelligence (col 1-7) ── */}
            <BentoCard id="b1" col="1/8" vis={bentV} delay={0} accent={T.red}
              badge={<><IconBadge icon={<Icon.TrendUp size={18} color={T.red}/>} color={T.red}/><span style={{fontSize:11,fontWeight:800,color:T.red,letterSpacing:'0.08em',textTransform:'uppercase'}}>זיהוי טרנדים</span></>}
              title="'pilates reformer' יגיע לישראל בעוד 21 יום. כבר יודעת?"
              body="מנוע z-score סורק Google Trends US כאינדיקטור מוביל — 2-6 שבועות לפני הפיק בישראל. אנחנו מחשבים מתי ומכינים לך תוכן מוכן."
              tags={['Google Trends IL+US','TikTok Viral','Instagram Hashtags','Facebook Groups']}
              extra={
                <div style={{ marginTop:20, borderRadius:14, background:'rgba(244,244,249,0.6)', border:'1px solid rgba(200,200,220,0.4)', padding:'14px 16px', backdropFilter:'blur(8px)' }}>
                  <div style={{ fontSize:10.5, color:T.light, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:10 }}>velocity "pilates reformer" → ישראל ~21 יום</div>
                  <div style={{ display:'flex', alignItems:'flex-end', gap:5, height:50 }}>
                    {[12,16,14,18,22,20,24,28,35,42,52,62,74,84,94].map((h,i) => (
                      <div key={i} style={{ flex:1, height:`${h}%`, borderRadius:3, background:i>=10?`rgba(232,52,77,${0.28+i*0.07})`:'rgba(200,200,220,0.6)', transition:'height .6s ease' }} />
                    ))}
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', marginTop:8 }}>
                    <span style={{ fontSize:10, color:T.light, fontWeight:500 }}>30 ימים אחורה</span>
                    <span style={{ fontSize:10, color:T.red, fontWeight:800 }}>velocity ×4.7 ↑</span>
                  </div>
                </div>
              }
            />

            {/* ── MEDIUM: Competitor Radar (col 8-13) ── */}
            <BentoCard id="b2" col="8/13" vis={bentV} delay={100} accent={T.purple}
              badge={<><IconBadge icon={<Icon.Radar size={18} color={T.purple}/>} color={T.purple}/><span style={{fontSize:11,fontWeight:800,color:T.purple,letterSpacing:'0.08em',textTransform:'uppercase'}}>מעקב מתחרים</span></>}
              title="כל שינוי אצל המתחרה — לפני שהלקוחות שלהם הופכים ללקוחות שלך"
              body="Snapshot diff יומי: שינוי מחיר, שירות חדש, פוסט, ביקורת. התראה עם הצעת תגובה מוכנה."
              tags={['Snapshot diff','Price changes','Google Maps','Social monitor']}
            />

            {/* ── MEDIUM: Lead Scoring (col 1-5) ── */}
            <BentoCard id="b3" col="1/6" vis={bentV} delay={200} accent={T.green}
              badge={<><IconBadge icon={<Icon.Target size={18} color={T.green}/>} color={T.green}/><span style={{fontSize:11,fontWeight:800,color:T.green,letterSpacing:'0.08em',textTransform:'uppercase'}}>לידים חמים</span></>}
              title="8 לידים ממתינים — זה אחד עומד לקנות עכשיו"
              body="כל ליד מקבל ציון intent ב-0-100: סנטימנט, מילות מפתח רכישה, מיקום, היסטוריה. הכי חמים עולים ראשונים."
              tags={['AI scoring 0-100','Intent signals','Auto-nurture','CRM sync']}
            />

            {/* ── LARGE: Mobile Approval (col 6-13) ── */}
            <BentoCard id="b4" col="6/13" vis={bentV} delay={300} accent="#25D366"
              badge={<><IconBadge icon={<Icon.Mobile size={18} color="#25D366"/>} color="#25D366"/><span style={{fontSize:11,fontWeight:800,color:'#20B85A',letterSpacing:'0.08em',textTransform:'uppercase'}}>אישור WhatsApp</span></>}
              title="כל פעולה ממתינה לאישורך — לחץ אחד בנייד"
              body="שום פוסט, תגובה, או הצעה לא יוצאת ללא אישורך. מצב semi-auto שומר אותך בשליטה מלאה."
              tags={['WhatsApp alerts','One-click approve','Semi-auto','Full-auto']}
              extra={
                <div style={{ marginTop:18, borderRadius:14, overflow:'hidden', border:'1px solid rgba(200,200,220,0.4)', maxWidth:300, boxShadow:'0 4px 16px rgba(26,31,54,0.08)' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'rgba(31,44,52,0.9)', backdropFilter:'blur(8px)' }}>
                    <div style={{ width:32, height:32, borderRadius:'50%', background:'linear-gradient(135deg,#E8344D,#7C3AED)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:900, color:'#fff' }}>C</div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, color:'#fff' }}>Cortexi</div>
                      <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>online · Agent active</div>
                    </div>
                  </div>
                  <div style={{ padding:'12px 14px', background:'rgba(11,20,26,0.85)', backdropFilter:'blur(8px)', display:'flex', flexDirection:'column', gap:8 }}>
                    <div style={{ background:'rgba(31,44,52,0.9)', borderRadius:10, padding:'9px 12px', fontSize:12, color:'rgba(255,255,255,0.8)', lineHeight:1.5, maxWidth:'90%', alignSelf:'flex-end' }}>
                      🔥 OTX: טרנד "before/after" — velocity ×4. פוסט מנוסח מוכן. חלון 48 שעות.<br/>
                      <span style={{ color:'#25D366' }}>app.cortexi.ai/approvals</span>
                    </div>
                    <div style={{ background:'rgba(0,92,75,0.9)', borderRadius:10, padding:'9px 12px', fontSize:12, color:'rgba(255,255,255,0.85)', maxWidth:'55%', alignSelf:'flex-start' }}>
                      אישרתי ✓
                    </div>
                  </div>
                </div>
              }
            />

            {/* ── SMALL x3 bottom row ── */}
            <BentoCard id="b5" col="1/5" vis={bentV} delay={400} accent="#F59E0B"
              badge={<><IconBadge icon={<Icon.Star size={18} color="#F59E0B"/>} color="#F59E0B"/><span style={{fontSize:11,fontWeight:800,color:'#D97706',letterSpacing:'0.08em',textTransform:'uppercase'}}>מוניטין</span></>}
              title="ביקורת שלילית? תגובה AI בסגנון שלך תוך 60 שניות"
              body="Google, Wolt, תן ביס — אוטומטי, ממתין לאישורך."
              tags={['Google Reviews','Wolt','Auto-draft']}
            />
            <BentoCard id="b6" col="5/9" vis={bentV} delay={500} accent={T.red}
              badge={<><IconBadge icon={<Icon.Zap size={18} color={T.red}/>} color={T.red}/><span style={{fontSize:11,fontWeight:800,color:T.red,letterSpacing:'0.08em',textTransform:'uppercase'}}>AI ויזואלי</span></>}
              title="Gemini Vision מנתח thumbnails לפני שמדברים עליהם"
              body="מזהה מוצרים, אסתטיקה, פורמטים שעולים — שבועות לפני הפיק."
              tags={['Gemini Flash','Visual trends','Product detection']}
            />
            <BentoCard id="b7" col="9/13" vis={bentV} delay={600} accent={T.purple}
              badge={<><IconBadge icon={<Icon.BarChart size={18} color={T.purple}/>} color={T.purple}/><span style={{fontSize:11,fontWeight:800,color:T.purple,letterSpacing:'0.08em',textTransform:'uppercase'}}>דוח שבועי</span></>}
              title="ציון ביצועים שבועי + תחזית לשבוע הבא"
              body="דוח AI עם המלצה אחת חדה שמניעה פעולה — ישירות לנייד."
              tags={['Weekly report','Forecasting','Score 1-10']}
            />
          </div>
        </div>
      </section>

      {/* ═══════════════ TESTIMONIALS ═════════════════════════ */}
      <section ref={tesiRef} style={{ position:'relative', zIndex:1, padding:'24px 28px 88px' }}>
        <div style={{ maxWidth:1160, margin:'0 auto' }}>
          <div style={{ textAlign:'center', marginBottom:48, opacity:tesiV?1:0, transform:tesiV?'none':'translateY(18px)', transition:'all .7s ease' }}>
            <div style={{ fontSize:12, fontWeight:800, color:T.red, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:14 }}>תוצאות אמיתיות</div>
            <h2 style={{ fontSize:'clamp(1.9rem,4vw,2.9rem)', fontWeight:900, letterSpacing:'-0.03em', color:T.dark }}>
              בעלי עסקים שמדברים במספרים
            </h2>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))', gap:16 }}>
            {TESTI.map((t,i) => (
              <div key={i} className="glass lift" style={{
                padding:'28px', borderRadius:20,
                boxShadow:'0 4px 24px rgba(26,31,54,0.07)',
                opacity:tesiV?1:0, transform:tesiV?'none':'translateY(22px)',
                transition:`all .65s ease ${i*130}ms`,
              }}>
                <div style={{ display:'flex', gap:3, marginBottom:16 }}>
                  {[1,2,3,4,5].map(s=><svg key={s} width="15" height="15" viewBox="0 0 24 24" fill={T.red} stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>)}
                </div>
                <p style={{ fontSize:15, color:T.mid, lineHeight:1.72, fontWeight:400, marginBottom:22 }}>"{t.q}"</p>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <div style={{ width:44, height:44, borderRadius:'50%', background:`linear-gradient(135deg,${t.color}28,${t.color}50)`, border:`1.5px solid ${t.color}35`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, fontWeight:900, color:t.color, flexShrink:0 }}>{t.init}</div>
                  <div>
                    <div style={{ fontSize:14, fontWeight:800, color:T.dark }}>{t.name}</div>
                    <div style={{ fontSize:12, color:T.light, fontWeight:500 }}>{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════ HOW IT WORKS ═════════════════════════ */}
      <section id="how" ref={howRef} style={{ position:'relative', zIndex:1, padding:'24px 28px 88px' }}>
        <div style={{ maxWidth:860, margin:'0 auto' }}>
          <div style={{ textAlign:'center', marginBottom:56, opacity:howV?1:0, transform:howV?'none':'translateY(18px)', transition:'all .7s ease' }}>
            <div style={{ fontSize:12, fontWeight:800, color:T.orange, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:14 }}>תהליך פשוט</div>
            <h2 style={{ fontSize:'clamp(1.9rem,4vw,2.9rem)', fontWeight:900, letterSpacing:'-0.03em', color:T.dark }}>
              מ-0 לתובנה הראשונה — 5 דקות
            </h2>
          </div>

          {[
            { n:'01', color:T.red,    title:'ספר לנו על העסק שלך',      body:'שם, קטגוריה, עיר, מתחרים עיקריים. שיחה בעברית עם Kori — 10 שאלות, 5 דקות. לא צריך ידע טכני.', delay:0 },
            { n:'02', color:T.purple, title:'50+ סוכנים נכנסים לפעולה', body:'בלילה הראשון — Google Trends, TikTok, Instagram, Facebook Groups, Google Maps, Wolt. הכל נסרק אוטומטית בלי שתעשה כלום.', delay:150 },
            { n:'03', color:T.green,  title:'תובנות ופעולות — לנייד שלך', body:'כל בוקר ב-07:00: ברמת שבוע, לידים חמים, טרנדים, מתחרים שינו — ופעולות מוכנות לאישורך ב-WhatsApp.', delay:300 },
          ].map((s,i) => (
            <div key={i} className="glass" style={{
              display:'flex', gap:22, padding:'26px', borderRadius:18, marginBottom:12,
              boxShadow:'0 2px 16px rgba(26,31,54,0.06)',
              opacity:howV?1:0, transform:howV?'none':'translateX(16px)',
              transition:`all .65s ease ${s.delay}ms`,
            }}>
              <div style={{ width:52, height:52, borderRadius:14, background:`${s.color}14`, border:`1.5px solid ${s.color}30`, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:900, fontSize:15, color:s.color, flexShrink:0, boxShadow:`0 2px 8px ${s.color}20` }}>
                {s.n}
              </div>
              <div>
                <div style={{ fontSize:19, fontWeight:800, color:T.dark, marginBottom:8, letterSpacing:'-0.02em' }}>{s.title}</div>
                <div style={{ fontSize:15, color:T.mid, lineHeight:1.7, fontWeight:400 }}>{s.body}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════ PRICING ══════════════════════════════ */}
      <section id="pricing" ref={pricRef} style={{ position:'relative', zIndex:1, padding:'24px 28px 100px' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <div style={{ textAlign:'center', marginBottom:52, opacity:pricV?1:0, transform:pricV?'none':'translateY(18px)', transition:'all .7s ease' }}>
            <div style={{ fontSize:12, fontWeight:800, color:T.purple, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:14 }}>תמחור פשוט</div>
            <h2 style={{ fontSize:'clamp(1.9rem,4vw,2.9rem)', fontWeight:900, letterSpacing:'-0.03em', color:T.dark, marginBottom:10 }}>ללא הפתעות. ללא מחויבות.</h2>
            <p style={{ fontSize:16, color:T.mid, fontWeight:400 }}>התחל חינם, שדרג רק כשאתה מרגיש ערך ממשי.</p>
          </div>

          <div className="pricing-grid" style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16 }}>
            {[
              { plan:'ניסיון חינמי', price:'₪0',   period:'7 ימים',    features:['7 ימים ללא תשלום','10 סריקות יומיות','3 סוכנים פעילים','לידים + ביקורות','ללא כרטיס אשראי'], cta:'התחל חינם',   dark:false, badge:null },
              { plan:'Basic',        price:'₪300', period:'לחודש',    features:['50 סריקות יומיות','8 סוכנים פעילים','מעקב מתחרים מלא','זיהוי טרנדים','ניהול ביקורות','התראות WhatsApp'], cta:'בחר Basic', dark:true,  badge:'הכי פופולרי' },
              { plan:'Premium',      price:'₪600', period:'לחודש',    features:['200 סריקות יומיות','50+ סוכנים','קמפיינים אוטומטיים','TikTok + Instagram AI','Gemini Vision','דוח שבועי + תחזיות'], cta:'בחר Premium', dark:false, badge:null },
            ].map((p,i) => (
              <div key={i}
                style={{
                  position:'relative', borderRadius:22,
                  background: p.dark ? T.dark : T.glass,
                  backdropFilter: p.dark ? 'none' : 'blur(20px)',
                  border: p.dark ? 'none' : '1.5px solid rgba(255,255,255,0.8)',
                  boxShadow: p.dark ? '0 20px 60px rgba(26,31,54,0.22)' : '0 4px 24px rgba(26,31,54,0.07)',
                  padding:'28px 24px', display:'flex', flexDirection:'column',
                  opacity:pricV?1:0, transform:pricV?'none':'translateY(24px)',
                  transition:`all .65s ease ${i*120}ms`,
                }}>
                {p.badge && (
                  <div style={{ position:'absolute', top:-14, left:'50%', transform:'translateX(-50%)', background:`linear-gradient(135deg,${T.red},${T.purple})`, color:'#fff', fontSize:12, fontWeight:800, padding:'5px 16px', borderRadius:100, whiteSpace:'nowrap' }}>{p.badge}</div>
                )}
                <div style={{ marginBottom:24 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:p.dark?'rgba(255,255,255,0.45)':T.light, marginBottom:8 }}>{p.plan}</div>
                  <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
                    <span style={{ fontSize:42, fontWeight:900, color:p.dark?'#fff':T.dark, letterSpacing:'-0.04em' }}>{p.price}</span>
                    <span style={{ fontSize:14, color:p.dark?'rgba(255,255,255,0.4)':T.light, fontWeight:500 }}>{p.period}</span>
                  </div>
                </div>
                <ul style={{ flex:1, listStyle:'none', marginBottom:24, display:'flex', flexDirection:'column', gap:10 }}>
                  {p.features.map(f => (
                    <li key={f} style={{ display:'flex', alignItems:'flex-start', gap:10, fontSize:14, color:p.dark?'rgba(255,255,255,0.72)':T.mid, fontWeight:400 }}>
                      <span style={{ width:20, height:20, borderRadius:'50%', background:p.dark?'rgba(255,255,255,0.1)':`${T.red}14`, border:`1px solid ${p.dark?'rgba(255,255,255,0.18)':`${T.red}28`}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:p.dark?'#fff':T.red, marginTop:1 }}>
                        <Icon.Check size={11} />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <button onClick={() => go('/sign-up')}
                  style={{
                    width:'100%', padding:'13px 0', borderRadius:12, border:'none', cursor:'pointer',
                    background: p.dark ? `linear-gradient(135deg,${T.red},${T.redD})` : 'rgba(255,255,255,0.7)',
                    backdropFilter: p.dark ? 'none' : 'blur(8px)',
                    color: p.dark ? '#fff' : T.dark,
                    fontWeight:800, fontSize:14.5, fontFamily:'Heebo,sans-serif',
                    boxShadow: p.dark ? `0 6px 24px rgba(232,52,77,0.4)` : 'none',
                    border: p.dark ? 'none' : '1.5px solid rgba(200,200,220,0.5)',
                    transition:'opacity .15s',
                  }}
                  onMouseEnter={e=>e.currentTarget.style.opacity='0.85'}
                  onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                  {p.cta}
                </button>
              </div>
            ))}
          </div>
          <p style={{ textAlign:'center', fontSize:13, color:T.light, marginTop:22, fontWeight:500 }}>
            Enterprise? <a href="mailto:hello@cortexi.ai" style={{ color:T.mid, textDecoration:'underline' }}>צרו קשר לתמחור מותאם</a>
          </p>
        </div>
      </section>

      {/* ═══════════════ FAQ ══════════════════════════════════ */}
      <section id="faq" style={{ position:'relative', zIndex:1, padding:'24px 28px 88px' }}>
        <div style={{ maxWidth:720, margin:'0 auto' }}>
          <div style={{ textAlign:'center', marginBottom:46 }}>
            <h2 style={{ fontSize:'clamp(1.9rem,4vw,2.7rem)', fontWeight:900, letterSpacing:'-0.03em', color:T.dark }}>שאלות נפוצות</h2>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {[
              { q:'האם צריך ידע טכני?', a:'בכלל לא. הOnboarding הוא שיחה בעברית עם Kori — 10 שאלות, 5 דקות. לא צריך להכיר APIs, analytics, או כלים דיגיטליים.' },
              { q:'אילו פלטפורמות מחוברות?', a:'Google Business, Instagram, TikTok, Facebook Groups, Wolt, תן ביס, WhatsApp. ניטור פסיבי עובד אפילו ללא חיבור OAuth.' },
              { q:'האם המערכת פועלת אוטומטית לחלוטין?', a:'כן, 24/7. אבל כל פעולה שיוצאת החוצה ממתינה לאישורך אם בחרת מצב semi-auto. שום דבר לא יוצא בלי שאתה יודע.' },
              { q:'מה קורה אחרי 7 ימי הניסיון?', a:'תקבל הודעה 2 ימים לפני הסיום. הנתונים שלך נשמרים 30 יום גם אחרי הניסיון — ללא כרטיס אשראי.' },
              { q:'האם מתאים לסקטור שלי?', a:'כן — מסעדות, פיטנס, יופי, רפואה, נדל"ן, חנויות. המנוע מתכוונן אוטומטית לסקטור שלך עם benchmark ספציפי.' },
            ].map((item,i) => <FAQItem key={i} q={item.q} a={item.a} />)}
          </div>
        </div>
      </section>

      {/* ═══════════════ FINAL CTA ════════════════════════════ */}
      <section style={{ position:'relative', zIndex:1, padding:'0 28px 100px' }}>
        <div style={{ maxWidth:900, margin:'0 auto' }}>
          <div style={{ borderRadius:28, padding:'72px 48px', textAlign:'center', background:T.dark, position:'relative', overflow:'hidden' }}>
            <div style={{ position:'absolute', top:-80, right:-80, width:360, height:360, borderRadius:'50%', background:`radial-gradient(circle,rgba(232,52,77,0.22),transparent 65%)`, pointerEvents:'none' }} />
            <div style={{ position:'absolute', bottom:-80, left:-80, width:300, height:300, borderRadius:'50%', background:`radial-gradient(circle,rgba(124,58,237,0.2),transparent 65%)`, pointerEvents:'none' }} />
            <div style={{ position:'relative' }}>
              <h2 style={{ fontSize:'clamp(2.1rem,5.5vw,3.8rem)', fontWeight:900, color:'#fff', letterSpacing:'-0.035em', lineHeight:1.08, marginBottom:20 }}>
                תוך 7 ימים תדע מה<br/>
                <span className="grad-text">המתחרים שלך לא יודעים</span>
              </h2>
              <p style={{ fontSize:17, color:'rgba(255,255,255,0.52)', marginBottom:36, maxWidth:480, margin:'0 auto 36px', lineHeight:1.65, fontWeight:400 }}>
                7 ימי ניסיון חינמי. ללא כרטיס אשראי. ביטול בכל עת.
              </p>
              <button onClick={() => go('/sign-up')} className="btn-red" style={{ fontSize:17, padding:'17px 44px', borderRadius:16 }}>
                התחל ניסיון חינמי — 7 ימים <Icon.ArrowLeft size={18} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════ FOOTER ═══════════════════════════════ */}
      <footer style={{ position:'relative', zIndex:1, borderTop:'1px solid rgba(200,200,220,0.4)', padding:'48px 28px 40px', background:'rgba(255,255,255,0.4)', backdropFilter:'blur(12px)' }}>
        <div style={{ maxWidth:1200, margin:'0 auto' }}>
          <div style={{ display:'flex', flexWrap:'wrap', gap:40, justifyContent:'space-between', marginBottom:40 }}>
            <div>
              <img src="/logo.jpeg" alt="Cortexi" style={{ height:42, marginBottom:14, borderRadius:8 }} />
              <p style={{ fontSize:13, color:T.light, maxWidth:220, lineHeight:1.7, fontWeight:400 }}>AI Growth OS לעסקים קטנים-בינוניים בישראל.</p>
            </div>
            <div style={{ display:'flex', gap:52, flexWrap:'wrap' }}>
              {[
                { title:'מוצר',    links:[['#features','יכולות'],['#how','איך זה עובד'],['#pricing','מחירים']] },
                { title:'לפי עסק', links:[['/restaurants','מסעדות'],['/fitness','פיטנס'],['/beauty','יופי']] },
                { title:'משפטי',   links:[['/terms','תנאי שימוש'],['/privacy','פרטיות']] },
              ].map(col => (
                <div key={col.title} style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  <span style={{ fontSize:13, fontWeight:800, color:T.dark, marginBottom:4 }}>{col.title}</span>
                  {col.links.map(([href,label]) => (
                    <a key={href} href={href} style={{ fontSize:13, color:T.light, textDecoration:'none', fontWeight:500, transition:'color .15s' }}
                      onMouseEnter={e=>e.target.style.color=T.dark} onMouseLeave={e=>e.target.style.color=T.light}>{label}</a>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:10, paddingTop:24, borderTop:'1px solid rgba(200,200,220,0.4)' }}>
            <span style={{ fontSize:12, color:T.light, fontWeight:500 }}>© 2026 Cortexi. כל הזכויות שמורות.</span>
            <span style={{ fontSize:12, color:T.light, fontWeight:500 }}>עוצב ופותח בישראל 🇮🇱</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ─── Bento Card ─────────────────────────────────────────── */
function BentoCard({ col, vis, delay = 0, accent, badge, title, body, tags, extra }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        gridColumn: col,
        borderRadius: 20,
        padding: '26px',
        background: hov ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.60)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1.5px solid rgba(255,255,255,0.82)',
        boxShadow: hov
          ? `0 16px 48px rgba(26,31,54,0.11), 0 4px 12px rgba(26,31,54,0.07), 0 0 0 1px ${accent}18`
          : '0 4px 24px rgba(26,31,54,0.07), 0 1px 4px rgba(26,31,54,0.04)',
        opacity: vis ? 1 : 0,
        transform: vis ? (hov ? 'translateY(-5px)' : 'none') : 'translateY(26px)',
        transition: `opacity .65s ease ${delay}ms, transform .22s ease, box-shadow .22s ease, background .18s ease`,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Accent top line */}
      <div style={{ position: 'absolute', top: 0, right: 0, left: 0, height: 3, background: `linear-gradient(90deg, ${accent}, transparent 70%)`, borderRadius: '20px 20px 0 0' }} />

      {/* Badge row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>{badge}</div>

      {/* Title */}
      <h3 style={{ fontSize: 17.5, fontWeight: 800, color: T.dark, marginBottom: 10, lineHeight: 1.3, letterSpacing: '-0.015em' }}>{title}</h3>

      {/* Body */}
      <p style={{ fontSize: 14, color: T.mid, lineHeight: 1.7, fontWeight: 400, marginBottom: tags?.length ? 14 : 0 }}>{body}</p>

      {/* Tags */}
      {tags && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {tags.map(t => (
            <span key={t} style={{ fontSize: 11.5, padding: '4px 10px', borderRadius: 100, background: `${accent}0E`, border: `1px solid ${accent}22`, color: T.mid, fontWeight: 600 }}>{t}</span>
          ))}
        </div>
      )}

      {/* Extra content */}
      {extra}
    </div>
  );
}

/* ─── FAQ Item ───────────────────────────────────────────── */
function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div onClick={() => setOpen(o => !o)} className="glass"
      style={{ borderRadius: 14, overflow: 'hidden', cursor: 'pointer', border: `1.5px solid ${open ? 'rgba(232,52,77,0.35)' : 'rgba(255,255,255,0.8)'}`, transition: 'border-color .2s, box-shadow .2s', boxShadow: open ? '0 4px 20px rgba(232,52,77,0.1)' : '0 2px 8px rgba(26,31,54,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '17px 20px' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: T.dark }}>{q}</span>
        <span style={{ color: T.light, transition: 'transform .25s', transform: open ? 'rotate(180deg)' : 'none', display: 'flex', flexShrink: 0, marginRight: 10 }}>
          <Icon.ChevDown />
        </span>
      </div>
      {open && (
        <div style={{ padding: '0 20px 17px', fontSize: 14, color: T.mid, lineHeight: 1.75, fontWeight: 400, animation: 'fadeIn .2s ease' }}>{a}</div>
      )}
    </div>
  );
}
