import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

// ─── Animated counter hook ────────────────────────────────────────────────────
function useCounter(target, duration = 2000, start = false) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) return;
    const startTime = performance.now();
    const tick = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setValue(Math.floor(ease * target));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration, start]);
  return value;
}

// ─── Intersection observer hook ───────────────────────────────────────────────
function useInView(threshold = 0.2) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setInView(true); }, { threshold });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, inView];
}

// ─── Stat counter component ───────────────────────────────────────────────────
function StatCounter({ value, suffix = '', label, inView }) {
  const count = useCounter(value, 1800, inView);
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-4xl md:text-5xl font-bold text-white tabular-nums">
        {count.toLocaleString()}{suffix}
      </span>
      <span className="text-sm text-white/50 text-center leading-tight">{label}</span>
    </div>
  );
}

// ─── Feature card ─────────────────────────────────────────────────────────────
function FeatureCard({ icon, title, desc, tags, delay = 0, inView }) {
  return (
    <div
      className="relative rounded-2xl p-px overflow-hidden transition-all duration-700"
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'translateY(0)' : 'translateY(32px)',
        transitionDelay: `${delay}ms`,
        background: 'linear-gradient(135deg, rgba(232,52,77,0.3), rgba(155,89,182,0.2), rgba(255,255,255,0.05))',
      }}
    >
      <div className="rounded-2xl p-6 h-full" style={{ background: '#0e0e1a' }}>
        <div className="text-4xl mb-4">{icon}</div>
        <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
        <p className="text-white/55 text-sm leading-relaxed mb-4">{desc}</p>
        <div className="flex flex-wrap gap-2">
          {tags.map(t => (
            <span key={t} className="text-xs px-3 py-1 rounded-full text-white/70"
              style={{ background: 'rgba(232,52,77,0.12)', border: '1px solid rgba(232,52,77,0.25)' }}>
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Pricing card ─────────────────────────────────────────────────────────────
function PricingCard({ plan, price, period, features, cta, highlight, onCta }) {
  return (
    <div
      className="relative rounded-2xl p-px transition-transform duration-300 hover:-translate-y-1"
      style={{
        background: highlight
          ? 'linear-gradient(135deg, #E8344D, #9B59B6)'
          : 'rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}
    >
      {highlight && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-xs font-bold text-white"
          style={{ background: 'linear-gradient(135deg, #E8344D, #9B59B6)' }}>
          הכי פופולרי
        </div>
      )}
      <div className="rounded-2xl p-6 h-full flex flex-col" style={{ background: highlight ? '#130a10' : '#0e0e1a' }}>
        <div className="mb-4">
          <div className="text-sm text-white/50 mb-1">{plan}</div>
          <div className="flex items-end gap-1">
            {price === 0 ? (
              <span className="text-4xl font-bold text-white">חינם</span>
            ) : (
              <>
                <span className="text-4xl font-bold text-white">₪{price}</span>
                <span className="text-white/40 pb-1">/{period}</span>
              </>
            )}
          </div>
        </div>
        <ul className="flex-1 space-y-2 mb-6">
          {features.map(f => (
            <li key={f} className="flex items-start gap-2 text-sm text-white/70">
              <span className="mt-0.5 text-[#E8344D] shrink-0">✓</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <button
          onClick={onCta}
          className="w-full py-3 rounded-xl font-semibold text-sm transition-all duration-200"
          style={highlight
            ? { background: 'linear-gradient(135deg, #E8344D, #FF6B6B)', color: '#fff', boxShadow: '0 4px 20px rgba(232,52,77,0.4)' }
            : { background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.12)' }
          }
        >
          {cta}
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function LandingMain() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [statsRef, statsInView] = useInView(0.3);
  const [featRef, featInView] = useInView(0.1);
  const [howRef, howInView] = useInView(0.2);
  const [pricingRef, pricingInView] = useInView(0.1);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const goSignUp = () => navigate('/sign-up');
  const goSignIn = () => navigate('/sign-in');

  const BG = '#07070f';
  const CARD = '#0e0e1a';

  return (
    <div dir="rtl" style={{ background: BG, minHeight: '100vh', color: '#F5F5F7', fontFamily: "'Segoe UI', 'Noto Sans Hebrew', sans-serif" }}>

      {/* ── CSS animations ── */}
      <style>{`
        @keyframes float1 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(40px,-30px) scale(1.05)} 66%{transform:translate(-20px,20px) scale(0.97)} }
        @keyframes float2 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(-50px,25px) scale(1.03)} 66%{transform:translate(30px,-40px) scale(0.98)} }
        @keyframes float3 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(20px,30px)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer { 0%{background-position:-200% center} 100%{background-position:200% center} }
        @keyframes pulse-glow { 0%,100%{box-shadow:0 0 30px rgba(232,52,77,0.3)} 50%{box-shadow:0 0 60px rgba(232,52,77,0.6)} }
        @keyframes spin-slow { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes marquee { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        .anim-fade-up { animation: fadeUp 0.7s ease forwards; }
        .anim-float1 { animation: float1 14s ease-in-out infinite; }
        .anim-float2 { animation: float2 18s ease-in-out infinite; }
        .anim-float3 { animation: float3 10s ease-in-out infinite; }
        .shimmer-text {
          background: linear-gradient(90deg, #fff 0%, #E8344D 30%, #9B59B6 60%, #fff 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer 4s linear infinite;
        }
        .glass-card {
          background: rgba(255,255,255,0.04);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.08);
        }
        .marquee-track { animation: marquee 20s linear infinite; }
        .marquee-track:hover { animation-play-state: paused; }
        .step-line::after {
          content:'';
          position:absolute;
          top:50%;
          right:-50%;
          width:100%;
          height:1px;
          background: linear-gradient(90deg, rgba(232,52,77,0.5), transparent);
        }
      `}</style>

      {/* ══════════════════════════════ NAV ══════════════════════════════════ */}
      <nav
        className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 md:px-12 py-4 transition-all duration-300"
        style={{
          background: scrolled ? 'rgba(7,7,15,0.9)' : 'transparent',
          backdropFilter: scrolled ? 'blur(20px)' : 'none',
          borderBottom: scrolled ? '1px solid rgba(255,255,255,0.06)' : 'none',
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-black text-lg"
            style={{ background: 'linear-gradient(135deg, #E8344D, #9B59B6)' }}>C</div>
          <span className="font-bold text-white text-lg tracking-tight">Cortexi</span>
        </div>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8 text-sm text-white/60">
          <a href="#features" className="hover:text-white transition-colors">יכולות</a>
          <a href="#how" className="hover:text-white transition-colors">איך זה עובד</a>
          <a href="#pricing" className="hover:text-white transition-colors">מחירים</a>
          <a href="#faq" className="hover:text-white transition-colors">שאלות נפוצות</a>
        </div>

        {/* CTA */}
        <div className="flex items-center gap-3">
          <button onClick={goSignIn} className="hidden md:block text-sm text-white/60 hover:text-white transition-colors px-3 py-2">
            התחברות
          </button>
          <button
            onClick={goSignUp}
            className="text-sm font-semibold px-5 py-2.5 rounded-xl text-white transition-all duration-200 hover:scale-105"
            style={{ background: 'linear-gradient(135deg, #E8344D, #FF6B6B)', boxShadow: '0 4px 20px rgba(232,52,77,0.35)' }}
          >
            התחל חינם
          </button>
          <button className="md:hidden text-white/60" onClick={() => setMenuOpen(o => !o)}>
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {menuOpen ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /> : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
        </div>
      </nav>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="fixed inset-x-0 top-[65px] z-40 px-6 py-4 flex flex-col gap-4 text-white/70"
          style={{ background: 'rgba(7,7,15,0.97)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <a href="#features" className="py-2 border-b border-white/05" onClick={() => setMenuOpen(false)}>יכולות</a>
          <a href="#how" className="py-2 border-b border-white/05" onClick={() => setMenuOpen(false)}>איך זה עובד</a>
          <a href="#pricing" className="py-2 border-b border-white/05" onClick={() => setMenuOpen(false)}>מחירים</a>
          <a href="#faq" className="py-2" onClick={() => setMenuOpen(false)}>שאלות נפוצות</a>
          <button onClick={goSignIn} className="text-right py-2 text-white/50">התחברות</button>
        </div>
      )}

      {/* ══════════════════════════════ HERO ═════════════════════════════════ */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-16 overflow-hidden text-center">

        {/* Background orbs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="anim-float1 absolute top-1/4 right-1/4 w-96 h-96 rounded-full opacity-20"
            style={{ background: 'radial-gradient(circle, #E8344D, transparent 70%)', filter: 'blur(60px)' }} />
          <div className="anim-float2 absolute bottom-1/3 left-1/4 w-80 h-80 rounded-full opacity-15"
            style={{ background: 'radial-gradient(circle, #9B59B6, transparent 70%)', filter: 'blur(60px)' }} />
          <div className="anim-float3 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-8"
            style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.3), transparent 70%)', filter: 'blur(80px)' }} />
          {/* Grid lines */}
          <div className="absolute inset-0" style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }} />
        </div>

        {/* Badge */}
        <div className="anim-fade-up relative z-10 mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium"
          style={{ background: 'rgba(232,52,77,0.12)', border: '1px solid rgba(232,52,77,0.3)', color: '#FF6B6B' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#E8344D] animate-pulse" />
          מערכת ה-AI Growth הראשונה בעברית לעסקים קטנים-בינוניים
        </div>

        {/* Headline */}
        <h1 className="relative z-10 font-black leading-[1.1] mb-6 max-w-4xl"
          style={{ fontSize: 'clamp(2.8rem, 7vw, 5.5rem)', animationDelay: '0.1s' }}>
          <span className="text-white">עשרות סוכני AI</span>
          <br />
          <span className="shimmer-text">עובדים בשקט</span>
          <br />
          <span className="text-white">בזמן שאתה ישן</span>
        </h1>

        {/* Sub */}
        <p className="relative z-10 text-white/55 text-lg md:text-xl max-w-2xl mb-10 leading-relaxed"
          style={{ animation: 'fadeUp 0.7s 0.2s ease both' }}>
          בוקר אחד תתעורר עם תובנות, לידים וטרנדים שוק — ישירות לנייד שלך.
          לפני שהמתחרים שלך בכלל פתחו עיניים.
        </p>

        {/* CTAs */}
        <div className="relative z-10 flex flex-col sm:flex-row gap-4 mb-16"
          style={{ animation: 'fadeUp 0.7s 0.3s ease both' }}>
          <button
            onClick={goSignUp}
            className="group flex items-center justify-center gap-2 px-8 py-4 rounded-2xl font-bold text-white text-base transition-all duration-200 hover:scale-105"
            style={{ background: 'linear-gradient(135deg, #E8344D, #FF6B6B)', boxShadow: '0 8px 32px rgba(232,52,77,0.4)', animation: 'pulse-glow 3s ease-in-out infinite' }}
          >
            התחל ניסיון חינמי — 7 ימים
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="group-hover:-translate-x-1 transition-transform">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </button>
          <button
            onClick={goSignIn}
            className="flex items-center justify-center gap-2 px-8 py-4 rounded-2xl font-semibold text-white text-base transition-all duration-200 hover:scale-105"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            כבר רשום? התחבר
          </button>
        </div>

        {/* Trust line */}
        <p className="relative z-10 text-white/30 text-xs mb-6">ללא כרטיס אשראי · ניסיון חינמי ל-7 ימים · ביטול בכל עת</p>

        {/* Dashboard preview */}
        <div className="relative z-10 w-full max-w-5xl rounded-2xl overflow-hidden"
          style={{
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 40px 100px rgba(0,0,0,0.6), 0 0 60px rgba(232,52,77,0.1)',
            animation: 'fadeUp 0.9s 0.5s ease both',
          }}>
          <div className="flex items-center gap-2 px-4 py-3" style={{ background: '#141420', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="w-3 h-3 rounded-full bg-[#E8344D] opacity-80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500 opacity-80" />
            <div className="w-3 h-3 rounded-full bg-green-500 opacity-80" />
            <span className="mx-auto text-white/30 text-xs">Cortexi — לוח בקרה</span>
          </div>
          <div style={{ background: '#0b0b16', padding: '24px' }}>
            {/* Mock dashboard rows */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {[
                { label: 'ביקורות חדשות', value: '12', trend: '+3', color: '#E8344D' },
                { label: 'לידים חמים', value: '8', trend: '+5', color: '#9B59B6' },
                { label: 'טרנדים זוהו', value: '4', trend: 'מוקדם', color: '#10b981' },
                { label: 'התראות ממתינות', value: '3', trend: 'לאישור', color: '#f59e0b' },
              ].map(item => (
                <div key={item.label} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="text-2xl font-bold text-white">{item.value}</div>
                  <div className="text-xs text-white/40 mt-0.5">{item.label}</div>
                  <div className="text-xs mt-1 font-medium" style={{ color: item.color }}>{item.trend}</div>
                </div>
              ))}
            </div>
            {/* Mock signal cards */}
            <div className="space-y-2">
              {[
                { icon: '🔥', text: 'TikTok: "before/after" בסקטור שלך — velocity exploding | חלון 48 שעות', color: '#E8344D', badge: 'ויראלי' },
                { icon: '📈', text: 'מתחרה פתח שירות חדש: "טיפול פנים פרימיום" — גילינו שינוי אמש', color: '#9B59B6', badge: 'מתחרים' },
                { icon: '⚡', text: 'טרנד Google US: "פלאמנקו pilates" — יגיע לישראל בעוד ~3 שבועות', color: '#10b981', badge: 'טרנד מוקדם' },
              ].map((s, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid rgba(255,255,255,0.05)` }}>
                  <span className="text-xl shrink-0">{s.icon}</span>
                  <span className="text-xs text-white/60 text-right flex-1 leading-relaxed">{s.text}</span>
                  <span className="text-xs px-2 py-1 rounded-full shrink-0" style={{ background: `${s.color}22`, color: s.color, border: `1px solid ${s.color}44` }}>{s.badge}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════ STATS ════════════════════════════════ */}
      <section ref={statsRef} className="py-16 px-6" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          <StatCounter value={10000} suffix="+" label="סריקות שוק יומיות" inView={statsInView} />
          <StatCounter value={30} suffix=" יום" label="חלון זיהוי טרנדים" inView={statsInView} />
          <StatCounter value={95} suffix="%" label="דיוק זיהוי מתחרים" inView={statsInView} />
          <StatCounter value={3} suffix=" ימים" label="לפני הפיק" inView={statsInView} />
        </div>
      </section>

      {/* ══════════════════════════════ LOGOS STRIP ══════════════════════════ */}
      <section className="py-12 px-6 overflow-hidden">
        <p className="text-center text-white/30 text-xs mb-6 tracking-widest uppercase">מנטרת ומתחברת לכל הפלטפורמות שלך</p>
        <div className="relative">
          <div className="marquee-track flex gap-10 items-center w-max">
            {['Google Business', 'Instagram', 'TikTok', 'Facebook', 'WhatsApp', 'Wolt', 'תן ביס', 'Google Ads', 'SerpAPI', 'Tavily', 'Google Business', 'Instagram', 'TikTok', 'Facebook', 'WhatsApp', 'Wolt', 'תן ביס', 'Google Ads', 'SerpAPI', 'Tavily'].map((name, i) => (
              <div key={i} className="flex items-center gap-2 px-5 py-3 rounded-full text-sm text-white/40 shrink-0"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                {name}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════ FEATURES ═════════════════════════════ */}
      <section id="features" ref={featRef} className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-[#E8344D] text-sm font-semibold tracking-widest uppercase mb-3">יכולות הליבה</p>
            <h2 className="text-3xl md:text-5xl font-black text-white mb-4 leading-tight">
              הכלים שמחפשים אותך<br />
              <span className="text-white/40">24 שעות ביממה, 7 ימים בשבוע</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            <FeatureCard inView={featInView} delay={0}
              icon="📡"
              title="זיהוי טרנדים לפני כולם"
              desc="מנוע z-score עם חלון גלילה של 30 יום זוהה ספייקים בנפח חיפוש לפני שהם מגיעים לפיק. US כאינדיקטור מוביל — 2-6 שבועות מראש."
              tags={['Google Trends', 'TikTok', 'Instagram', 'Facebook Groups']}
            />
            <FeatureCard inView={featInView} delay={100}
              icon="🔍"
              title="מתחרים תחת מיקרוסקופ"
              desc="סריקת snapshots יומית של מתחרים — שינויי מחיר, שירותים חדשים, פוסטים, ביקורות. התראה מיידית כשמשהו משתנה."
              tags={['Snapshot diff', 'Price changes', 'Social monitor', 'Google Maps']}
            />
            <FeatureCard inView={featInView} delay={200}
              icon="🎯"
              title="לידים חמים עם ניקוד AI"
              desc="כל ליד מקבל ציון intent ב-0-100. ניתוח סנטימנט, מילות מפתח רכישה, מיקום — הלידים החמים ביותר עולים קודם."
              tags={['AI scoring', 'Intent signals', 'Auto-nurture', 'CRM sync']}
            />
            <FeatureCard inView={featInView} delay={300}
              icon="⭐"
              title="ניהול מוניטין אוטומטי"
              desc="תגובות AI לביקורות Google, Wolt, תן ביס — בסגנון הקול שלך. אישור בקליק מהנייד לפני שזה עולה."
              tags={['Google Reviews', 'Wolt', 'Auto-respond', 'WhatsApp approval']}
            />
            <FeatureCard inView={featInView} delay={400}
              icon="📊"
              title="ניתוח ויזואלי מ-AI"
              desc="Gemini Flash מנתח thumbnails מ-Instagram ו-TikTok — מזהה מוצרים, אסתטיקה, פורמטים שעולים לפני שמדברים עליהם."
              tags={['Gemini Vision', 'Visual trends', 'Content formats', 'Instagram']}
            />
            <FeatureCard inView={featInView} delay={500}
              icon="📱"
              title="פעולות מוכנות לנייד"
              desc="כל תובנה מגיעה עם פעולה מוכנה — פוסט מנוסח, תגובה לביקורת, script לסרטון. לחץ אחד לאישור ב-WhatsApp."
              tags={['WhatsApp alerts', 'One-click approve', 'Semi-auto', 'Full-auto']}
            />
          </div>
        </div>
      </section>

      {/* ══════════════════════════════ HOW IT WORKS ═════════════════════════ */}
      <section id="how" ref={howRef} className="py-24 px-6" style={{ background: 'rgba(255,255,255,0.015)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-[#9B59B6] text-sm font-semibold tracking-widest uppercase mb-3">תוך 60 שניות</p>
            <h2 className="text-3xl md:text-5xl font-black text-white leading-tight">
              מהרשמה לתובנה ראשונה
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { num: '01', title: 'מלא פרופיל עסקי', desc: 'שם, קטגוריה, עיר, מתחרים. 10 שאלות בסגנון שיחה עם Kori — 5 דקות בלבד.', color: '#E8344D', delay: 0 },
              { num: '02', title: 'הסוכנים מתחילים', desc: 'בלילה הראשון 30+ סוכנים סורקים Google, TikTok, Instagram, Facebook — בלי שתעשה כלום.', color: '#9B59B6', delay: 150 },
              { num: '03', title: 'קבל התראות לנייד', desc: 'בבוקר — ברמה, תובנות ופעולות מוכנות לאישור ישירות ל-WhatsApp שלך.', color: '#10b981', delay: 300 },
            ].map(step => (
              <div key={step.num}
                className="relative flex flex-col items-center text-center p-8 rounded-2xl transition-all duration-700"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  opacity: howInView ? 1 : 0,
                  transform: howInView ? 'translateY(0)' : 'translateY(32px)',
                  transition: `all 0.7s ease ${step.delay}ms`,
                }}>
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-black text-xl mb-5"
                  style={{ background: `${step.color}22`, color: step.color, border: `1px solid ${step.color}44` }}>
                  {step.num}
                </div>
                <h3 className="font-bold text-white text-lg mb-3">{step.title}</h3>
                <p className="text-white/50 text-sm leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════ WHATSAPP MOCKUP ══════════════════════ */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-[#E8344D] text-sm font-semibold tracking-widest uppercase mb-3">התראות לנייד</p>
            <h2 className="text-3xl md:text-4xl font-black text-white mb-5 leading-tight">
              אישור בקליק —<br />
              <span className="text-white/40">ישירות מה-WhatsApp שלך</span>
            </h2>
            <p className="text-white/55 text-base leading-relaxed mb-8">
              אנחנו לא רוצים שתשב מול מחשב. כל פעולה שהמערכת מייצרת — תגובה לביקורת, פוסט, הצעה ללקוח — מגיעה אליך ב-WhatsApp עם כפתור אחד לאישור. אם לא אישרת, לא קרה כלום.
            </p>
            <ul className="space-y-3">
              {['התראה על TikTok viral + script מוכן לצילום', 'ביקורת שלילית + תגובה AI ממתינה לאישורך', 'מתחרה שינה מחיר — הצעת מענה מוכנה', 'מיקרו-מומנט קרוב: ביקוש צפוי פי 3'].map(item => (
                <li key={item} className="flex items-center gap-3 text-sm text-white/65">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0"
                    style={{ background: 'rgba(232,52,77,0.15)', color: '#E8344D' }}>✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          {/* WhatsApp mockup */}
          <div className="flex justify-center">
            <div className="w-72 rounded-3xl overflow-hidden shadow-2xl"
              style={{ background: '#111b21', border: '1px solid rgba(255,255,255,0.1)' }}>
              {/* WA header */}
              <div className="flex items-center gap-3 px-4 py-3" style={{ background: '#1f2c34' }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm"
                  style={{ background: 'linear-gradient(135deg, #E8344D, #9B59B6)', color: '#fff' }}>C</div>
                <div>
                  <div className="text-white text-sm font-medium">Cortexi</div>
                  <div className="text-white/40 text-xs">online</div>
                </div>
              </div>
              {/* Messages */}
              <div className="p-4 space-y-3" style={{ background: '#0b141a' }}>
                {[
                  { time: '07:12', text: '🔥 OTX: פעולה חדשה ממתינה לאישורך\n\nסוכן: TikTok טרנד סקטור\nפעולה: טרנד "Before/After" מתפוצץ — חלון 48 שעות', me: false },
                  { time: '07:12', text: 'לצפייה ואישור:\ncortexi.ai/approvals', me: false },
                  { time: '07:14', text: 'אישרתי ✓', me: true },
                ].map((msg, i) => (
                  <div key={i} className={`flex ${msg.me ? 'justify-start' : 'justify-end'}`}>
                    <div className="max-w-[85%] px-3 py-2 rounded-xl text-xs text-white/80 whitespace-pre-line leading-relaxed"
                      style={{ background: msg.me ? '#005c4b' : '#1f2c34' }}>
                      {msg.text}
                      <div className="text-right text-white/30 text-[10px] mt-1">{msg.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════ PRICING ══════════════════════════════ */}
      <section id="pricing" ref={pricingRef} className="py-24 px-6" style={{ background: 'rgba(255,255,255,0.015)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-[#9B59B6] text-sm font-semibold tracking-widest uppercase mb-3">תמחור פשוט</p>
            <h2 className="text-3xl md:text-5xl font-black text-white mb-4">ללא הפתעות</h2>
            <p className="text-white/40 max-w-lg mx-auto">התחל חינם, שדרג רק כשאתה מרגיש ערך.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            <PricingCard
              plan="ניסיון חינמי"
              price={0}
              period=""
              features={['7 ימים ללא תשלום', '10 סריקות יומיות', '3 סוכנים פעילים', 'לידים + ביקורות', 'ללא כרטיס אשראי']}
              cta="התחל חינם"
              highlight={false}
              onCta={goSignUp}
            />
            <PricingCard
              plan="Basic"
              price={300}
              period="חודש"
              features={['50 סריקות יומיות', '8 סוכנים פעילים', 'מעקב מתחרים', 'טרנדים + לידים', 'ניהול ביקורות', 'WhatsApp התראות']}
              cta="התחל עכשיו"
              highlight={true}
              onCta={goSignUp}
            />
            <PricingCard
              plan="Premium"
              price={600}
              period="חודש"
              features={['200 סריקות יומיות', 'כל הסוכנים (50+)', 'קמפיינים אוטומטיים', 'TikTok + Instagram', 'ניתוח ויזואלי AI', 'דוח שבועי + תחזיות']}
              cta="Premium"
              highlight={false}
              onCta={goSignUp}
            />
          </div>
          <p className="text-center text-white/25 text-xs mt-8">Enterprise? <a href="mailto:hello@cortexi.ai" className="underline hover:text-white/50 transition-colors">צרו קשר לתמחור מותאם אישית</a></p>
        </div>
      </section>

      {/* ══════════════════════════════ FAQ ══════════════════════════════════ */}
      <section id="faq" className="py-24 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-black text-white">שאלות נפוצות</h2>
          </div>
          <div className="space-y-3">
            {[
              { q: 'האם צריך ידע טכני?', a: 'בכלל לא. הpnboarding הוא שיחה בעברית — 10 שאלות. לא צריך להכיר APIs, analytics או כלים דיגיטליים.' },
              { q: 'אילו פלטפורמות מחוברות?', a: 'Google Business, Instagram, TikTok, Facebook, Wolt, תן ביס, WhatsApp. ניטור פסיבי עובד אפילו בלי חיבור OAuth.' },
              { q: 'האם המערכת פועלת אוטומטית?', a: 'כן. 24/7. אבל כל פעולה שיוצאת החוצה (תגובה לביקורת, פרסום, WhatsApp) מחכה לאישורך אם בחרת במצב semi-auto.' },
              { q: 'מה קורה אחרי 7 הימים?', a: 'תקבל הודעה לפני שהניסיון מסתיים. לא חייב לשדרג — הנתונים נשמרים 30 יום גם אחרי סיום ניסיון.' },
              { q: 'האם Cortexi מתאים לכל עסק?', a: 'כן — מסעדות, פיטנס, יופי, רפואה, נדל"ן, חנויות. המנוע מתאים את עצמו לסקטור שלך אוטומטית.' },
            ].map((item, i) => (
              <FAQItem key={i} q={item.q} a={item.a} />
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════ FINAL CTA ════════════════════════════ */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="relative rounded-3xl p-12 overflow-hidden"
            style={{ background: 'linear-gradient(135deg, rgba(232,52,77,0.15), rgba(155,89,182,0.15))', border: '1px solid rgba(232,52,77,0.2)' }}>
            <div className="absolute inset-0 pointer-events-none" style={{
              background: 'radial-gradient(ellipse at center, rgba(232,52,77,0.12) 0%, transparent 70%)',
            }} />
            <h2 className="relative text-3xl md:text-5xl font-black text-white mb-5 leading-tight">
              תוך שבוע תדע<br />
              <span className="shimmer-text">מה שהמתחרים לא יודעים</span>
            </h2>
            <p className="relative text-white/55 mb-8 max-w-lg mx-auto">
              הצטרף לעסקים שמקבלים תובנות שוק בזמן שמתחרים ישנים. 7 ימים חינם, ללא כרטיס אשראי.
            </p>
            <button
              onClick={goSignUp}
              className="inline-flex items-center gap-3 px-10 py-4 rounded-2xl font-bold text-white text-lg transition-all duration-200 hover:scale-105"
              style={{ background: 'linear-gradient(135deg, #E8344D, #FF6B6B)', boxShadow: '0 8px 40px rgba(232,52,77,0.45)' }}
            >
              התחל ניסיון חינמי
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════ FOOTER ═══════════════════════════════ */}
      <footer className="py-12 px-6" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-start gap-8 mb-10">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-black text-lg"
                  style={{ background: 'linear-gradient(135deg, #E8344D, #9B59B6)' }}>C</div>
                <span className="font-bold text-white text-lg">Cortexi</span>
              </div>
              <p className="text-white/35 text-sm max-w-xs leading-relaxed">מערכת AI Growth OS לעסקים קטנים-בינוניים בישראל. עברית בלבד.</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-8 text-sm text-white/40">
              <div className="flex flex-col gap-3">
                <span className="text-white/70 font-semibold mb-1">מוצר</span>
                <a href="#features" className="hover:text-white transition-colors">יכולות</a>
                <a href="#how" className="hover:text-white transition-colors">איך זה עובד</a>
                <a href="#pricing" className="hover:text-white transition-colors">מחירים</a>
              </div>
              <div className="flex flex-col gap-3">
                <span className="text-white/70 font-semibold mb-1">לפי עסק</span>
                <a href="/restaurants" className="hover:text-white transition-colors">מסעדות</a>
                <a href="/fitness" className="hover:text-white transition-colors">פיטנס</a>
                <a href="/beauty" className="hover:text-white transition-colors">יופי</a>
              </div>
              <div className="flex flex-col gap-3">
                <span className="text-white/70 font-semibold mb-1">משפטי</span>
                <a href="/terms" className="hover:text-white transition-colors">תנאי שימוש</a>
                <a href="/privacy" className="hover:text-white transition-colors">פרטיות</a>
              </div>
            </div>
          </div>
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-8"
            style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <p className="text-white/25 text-xs">© 2026 Cortexi. כל הזכויות שמורות.</p>
            <p className="text-white/25 text-xs">עוצב ופותח בישראל 🇮🇱</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── FAQ Item (accordion) ─────────────────────────────────────────────────────
function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-xl overflow-hidden cursor-pointer transition-all duration-200"
      style={{ background: 'rgba(255,255,255,0.04)', border: open ? '1px solid rgba(232,52,77,0.25)' : '1px solid rgba(255,255,255,0.07)' }}
      onClick={() => setOpen(o => !o)}
    >
      <div className="flex items-center justify-between px-5 py-4">
        <span className="font-semibold text-white text-sm">{q}</span>
        <span className="text-white/40 text-lg transition-transform duration-200" style={{ transform: open ? 'rotate(45deg)' : 'none' }}>+</span>
      </div>
      {open && (
        <div className="px-5 pb-4 text-sm text-white/55 leading-relaxed">
          {a}
        </div>
      )}
    </div>
  );
}
