import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  TrendingUp, Bell, Shield, Star, ChevronRight, Clock, ArrowLeft,
  CheckCircle, Zap, BarChart2, Eye, Target, Users
} from 'lucide-react';

const G = 'linear-gradient(135deg, #7B2FBE 0%, #E8344D 55%, #FF8C00 100%)';
const gText = { background: G, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' };
const gBorder = { background: G, padding: '1px', borderRadius: '16px' };
const dark = { background: '#13131A', borderRadius: '15px' };

// ── Animated counter ──────────────────────────────────────────────────────────
function Counter({ target, suffix = '' }) {
  const [v, setV] = useState(0);
  const ref = useRef(null);
  const started = useRef(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !started.current) {
        started.current = true;
        let cur = 0;
        const step = target / 60;
        const t = setInterval(() => {
          cur += step;
          if (cur >= target) { setV(target); clearInterval(t); }
          else setV(Math.floor(cur));
        }, 25);
      }
    }, { threshold: 0.3 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [target]);
  return <span ref={ref} className="tabular-nums">{v.toLocaleString('he-IL')}{suffix}</span>;
}

// ── Alert preview card ────────────────────────────────────────────────────────
function AlertCard({ icon, title, body, time, urgent }) {
  return (
    <div className={`p-4 rounded-2xl text-right ${urgent ? 'border border-red-500/30 bg-red-500/5' : 'border border-white/8 bg-white/3'}`}>
      <div className="flex items-start gap-3">
        <span className="text-2xl">{icon}</span>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-gray-500">{time}</span>
            {urgent && <span className="text-[9px] font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">דחוף</span>}
          </div>
          <div className="text-[13px] font-semibold text-white mb-0.5">{title}</div>
          <div className="text-[11px] text-gray-400">{body}</div>
        </div>
      </div>
    </div>
  );
}

// ── Mockup dashboard for restaurants ─────────────────────────────────────────
function RestaurantMockup() {
  return (
    <div className="rounded-2xl overflow-hidden border border-white/10" style={{ background: '#0E0E16' }}>
      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8">
        <div className="flex gap-1.5">
          {['#FF5F57','#FEBC2E','#28C840'].map(c => <div key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />)}
        </div>
        <span className="text-[11px] text-gray-500 mx-auto">Cortexi — מסעדת הגולן</span>
      </div>

      <div className="p-4 space-y-3">
        {/* KPIs */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'ביקורות היום', val: '4', delta: '+2', up: true },
            { label: 'מתחרים במעקב', val: '7', delta: 'פעיל', up: true },
            { label: 'לידים חמים', val: '12', delta: '+3', up: true },
          ].map(k => (
            <div key={k.label} className="p-2.5 rounded-xl text-center border border-white/5" style={{ background: '#161621' }}>
              <div className="text-[18px] font-bold text-white">{k.val}</div>
              <div className="text-[9px] text-gray-500">{k.label}</div>
              <div className={`text-[9px] font-medium mt-0.5 ${k.up ? 'text-green-400' : 'text-red-400'}`}>{k.delta}</div>
            </div>
          ))}
        </div>

        {/* Alerts */}
        <div className="space-y-2">
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">התראות פעולה — הלילה</div>
          <AlertCard
            icon="🔥"
            title="המתחרה פתח תפריט חדש הלילה"
            body='פיצה ב-₪59 — Cortexi מכינה תגובה נגדית'
            time="02:17"
            urgent
          />
          <AlertCard
            icon="⭐"
            title='ביקורת שלילית ב-Google'
            body='"השירות היה איטי" — תגובה מוכנה לאישור'
            time="07:42"
            urgent
          />
          <AlertCard
            icon="📈"
            title='טרנד "פוקה בתל אביב" — ספייק +340%'
            body="זוהה 18 ימים לפני הפיק — הצעת קמפיין מוכנה"
            time="08:05"
          />
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          <button className="flex-1 py-2 rounded-xl text-[11px] font-semibold text-white" style={{ background: G }}>
            אשר פעולה
          </button>
          <button className="flex-1 py-2 rounded-xl text-[11px] font-semibold border border-white/15 text-gray-300">
            עוד מחר
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Pain points ───────────────────────────────────────────────────────────────
const PAIN_POINTS = [
  { q: 'המתחרה שמולך הוריד מחיר — ואתה לא ידעת', a: 'Cortexi מזהה שינוי מחיר תוך 60 דקות ומציעה תגובה נגדית מוכנה' },
  { q: 'ביקורת שלילית ב-Google פגעה בדירוג', a: 'Cortexi מזהה, מנסחת תגובה בטון שלך, ושולחת לאישורך ב-WhatsApp' },
  { q: 'לא ידעת שיש טרנד "אוכל טבעוני" לפני שזה פרץ', a: 'Z-score detection מזהה טרנדים 14-21 יום לפני הפיק — זמן לבנות קמפיין' },
  { q: 'שילמת לסוכנות שיווק ₪3,000 — ולא ידעת מה עשו', a: 'כל פעולה גלויה. אתה מאשר — Cortexi מבצעת. שליטה מלאה בנייד' },
];

// ── Testimonials ──────────────────────────────────────────────────────────────
const TESTIMONIALS = [
  {
    name: 'אורן כהן',
    role: 'בעלים — מסעדת הגולן, תל אביב',
    text: 'קיבלתי התראה ב-WhatsApp ב-2 בלילה שהמתחרה פתח תפריט חדש. עד הבוקר כבר הייתה לי תגובה. זה שינה את כל המשחק.',
    rating: 5,
  },
  {
    name: 'מיכל לוי',
    role: 'בעלת — קפה רמת גן',
    text: 'Cortexi זיהתה טרנד "בראנץ׳ ירושלמי" 3 שבועות לפני שכולם דיברו עליו. הספקתי לבנות קמפיין לפני כולם.',
    rating: 5,
  },
];

// ── Features ──────────────────────────────────────────────────────────────────
const FEATURES = [
  { icon: Eye, title: 'מעקב מתחרים 24/7', body: 'שינויי תפריט, מחיר, שירות, סושיאל — מגיע אליך לפני שהלקוחות שלהם הופכים ללקוחות שלך' },
  { icon: Shield, title: 'ניהול ביקורות חכם', body: 'Google, Wolt, 10Bis, TripAdvisor — במקום אחד. תגובות AI בטון שלך, לאישורך' },
  { icon: TrendingUp, title: 'זיהוי טרנדים מוקדם', body: 'ספייק בחיפושים על "פוקה", "ברייזקט" או "ביסמארק"? תדע שבועות לפני שהמתחרה יגיב' },
  { icon: Target, title: 'לידים חמים', body: 'מי חיפש "מסעדה בתל אביב" + "אוכל טבעוני" ברדיוס 3 ק"מ — Cortexi מזהה, מנקדת, מציגה' },
  { icon: Bell, title: 'WhatsApp-native', body: 'כל תובנה, כל התראה, כל פעולה — ישירות לנייד. אשר בקליק אחד, בלי להיכנס למערכת' },
  { icon: Zap, title: 'קמפיינים אוטומטיים', body: 'Cortexi מגלה הזדמנות → בונה קמפיין Meta/Google → שולחת לאישורך. לא רץ בלי אישור' },
];

// ── Pricing ───────────────────────────────────────────────────────────────────
const PLANS = [
  {
    name: 'ניסיון חינם',
    price: '₪0',
    period: '/ שבוע',
    desc: 'ללא כרטיס אשראי',
    features: ['3 סוכנים פעילים', '10 סריקות ביום', 'ביקורות גוגל', 'התראות WhatsApp'],
    cta: 'התחל ניסיון חינם',
    highlight: false,
    note: 'שבוע אחד, ללא התחייבות',
  },
  {
    name: 'Basic',
    price: '₪300',
    period: '/ חודש',
    desc: 'לעסקים צומחים',
    features: ['8 סוכנים פעילים', '50 סריקות ביום', 'כל פלטפורמות ביקורת', 'מעקב מתחרים', 'לידים חמים', 'דוחות שבועיים'],
    cta: 'התחל עכשיו',
    highlight: true,
    note: 'הכי נבחר',
  },
  {
    name: 'Premium',
    price: '₪600',
    period: '/ חודש',
    desc: 'לעסקים שרוצים להוביל',
    features: ['כל הסוכנים', '200 סריקות ביום', 'קמפיינים אוטומטיים', 'זיהוי טרנדים מוקדם', 'WhatsApp + SMS', 'תמיכה עדיפות'],
    cta: 'לפרימיום',
    highlight: false,
    note: '',
  },
];

// ─────────────────────────────────────────────────────────────────────────────

export default function LandingRestaurants() {
  return (
    <div dir="rtl" style={{ background: '#0A0A0F', minHeight: '100vh', color: 'white', fontFamily: 'inherit' }}>

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-white/8 max-w-6xl mx-auto">
        <Link to="/" className="text-[20px] font-bold" style={gText}>Cortexi</Link>
        <div className="flex items-center gap-3">
          <span className="hidden md:inline text-[11px] text-gray-400">מסעדות ובתי קפה</span>
          <button
            onClick={() => base44.auth.redirectToLogin()}
            className="px-4 py-2 rounded-full text-[13px] font-semibold text-white"
            style={{ background: G }}
          >
            ניסיון חינם — שבוע
          </button>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div className="text-right">
            <div className="inline-flex items-center gap-2 mb-5 px-3 py-1.5 rounded-full border border-white/10 text-[11px] text-gray-400"
              style={{ background: 'rgba(232,52,77,0.08)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              מיועד לבעלי מסעדות ובתי קפה
            </div>
            <h1 className="text-[38px] md:text-[48px] font-black leading-[1.15] mb-6">
              תדע מה המתחרה שלך <span style={gText}>עשה הלילה</span> — לפני שתפתח בוקר
            </h1>
            <p className="text-[16px] text-gray-400 leading-relaxed mb-8">
              Cortexi מריצה עשרות סוכני AI שעובדים בשקט בזמן שאתה ישן. בוקר אחד תתעורר עם תובנות, התראות ופעולות מוכנות לאישור — ישירות לנייד שלך.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => base44.auth.redirectToLogin()}
                className="flex items-center gap-2 px-6 py-3.5 rounded-full text-[15px] font-bold text-white hover:opacity-90 transition-all"
                style={{ background: G }}
              >
                התחל ניסיון חינם — שבוע
                <ArrowLeft className="w-4 h-4" />
              </button>
              <Link
                to="/pricing"
                className="flex items-center gap-1 px-5 py-3.5 rounded-full text-[13px] font-medium border border-white/15 text-gray-300 hover:border-white/30 transition-all"
              >
                מחירים
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
            <p className="text-[11px] text-gray-500 mt-3">ללא כרטיס אשראי · ביטול בכל עת</p>
          </div>

          {/* Dashboard mockup */}
          <div className="hidden md:block">
            <RestaurantMockup />
          </div>
        </div>
      </section>

      {/* ── Social proof numbers ─────────────────────────────────────────────── */}
      <section className="border-y border-white/8 py-10">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center px-6">
          {[
            { label: 'עסקים פעילים', target: 500, suffix: '+' },
            { label: 'ביקורות שטופלו', target: 48000, suffix: '+' },
            { label: 'לידים שנוצרו', target: 12000, suffix: '+' },
            { label: 'שביעות רצון', target: 94, suffix: '%' },
          ].map(s => (
            <div key={s.label}>
              <div className="text-[32px] font-black" style={gText}>
                <Counter target={s.target} suffix={s.suffix} />
              </div>
              <div className="text-[12px] text-gray-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pain → Solution ─────────────────────────────────────────────────── */}
      <section className="max-w-4xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-[28px] md:text-[34px] font-black mb-3">הכאבים שאתה מכיר</h2>
          <p className="text-[14px] text-gray-400">ו-Cortexi פותרת אותם — אוטומטית</p>
        </div>
        <div className="space-y-4">
          {PAIN_POINTS.map((p, i) => (
            <div key={i} className="grid md:grid-cols-2 gap-4 p-5 rounded-2xl border border-white/8" style={{ background: '#111118' }}>
              <div className="flex items-start gap-3">
                <span className="text-red-400 mt-0.5 flex-shrink-0">✗</span>
                <p className="text-[14px] text-gray-300">{p.q}</p>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                <p className="text-[14px] text-gray-300">{p.a}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features grid ───────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="text-center mb-12">
          <h2 className="text-[28px] md:text-[34px] font-black mb-3">כל מה שצריך — במקום אחד</h2>
          <p className="text-[14px] text-gray-400">מחליף: Mention + SEMrush + CRM + Hootsuite. בעברית.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {FEATURES.map(f => (
            <div key={f.title} className="p-5 rounded-2xl text-right border border-white/8 hover:border-white/15 transition-all" style={{ background: '#111118' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: 'rgba(232,52,77,0.12)' }}>
                <f.icon className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="text-[15px] font-bold mb-1">{f.title}</h3>
              <p className="text-[12px] text-gray-400 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How WhatsApp works ──────────────────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-6 pb-20">
        <div className="text-center mb-10">
          <h2 className="text-[26px] md:text-[32px] font-black mb-3">איך זה עובד?</h2>
          <p className="text-[14px] text-gray-400">3 שלבים. ללא מורכבות.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-6 text-center">
          {[
            { n: '1', title: 'נרשמים (5 דקות)', body: 'מזינים פרטי עסק + מספר נייד. Cortexi מבצעת סריקה ראשונית ומכינה את הסוכנים' },
            { n: '2', title: 'הסוכנים עובדים', body: 'בלילה, בשעות העומס, בסוף שבוע — 24/7 ללא הפסקה. אתה ישן, Cortexi עובדת' },
            { n: '3', title: 'אתה מחליט', body: 'תובנה / פעולה מגיעה ל-WhatsApp. אשר בקליק אחד — לא רץ בלי אישורך' },
          ].map(s => (
            <div key={s.n} className="p-5 rounded-2xl border border-white/8" style={{ background: '#111118' }}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-3 text-[16px] font-black text-white" style={{ background: G }}>
                {s.n}
              </div>
              <h3 className="text-[15px] font-bold mb-2">{s.title}</h3>
              <p className="text-[12px] text-gray-400 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Testimonials ────────────────────────────────────────────────────── */}
      <section className="max-w-4xl mx-auto px-6 pb-20">
        <div className="text-center mb-10">
          <h2 className="text-[26px] font-black mb-2">מה אומרים בעלי מסעדות?</h2>
        </div>
        <div className="grid md:grid-cols-2 gap-5">
          {TESTIMONIALS.map(t => (
            <div key={t.name} className="p-6 rounded-2xl text-right border border-white/8" style={{ background: '#111118' }}>
              <div className="flex gap-0.5 mb-3">
                {Array.from({ length: t.rating }).map((_, i) => (
                  <Star key={i} className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                ))}
              </div>
              <p className="text-[13px] text-gray-300 leading-relaxed mb-4">"{t.text}"</p>
              <div>
                <div className="text-[13px] font-semibold text-white">{t.name}</div>
                <div className="text-[11px] text-gray-500">{t.role}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="text-center mb-10">
          <h2 className="text-[26px] md:text-[32px] font-black mb-3">מחירים שהגיוניים</h2>
          <p className="text-[14px] text-gray-400">שבוע ניסיון חינם — ללא כרטיס אשראי, ללא התחייבות</p>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {PLANS.map(plan => (
            plan.highlight ? (
              <div key={plan.name} style={gBorder}>
                <div className="p-6 text-right h-full" style={dark}>
                  {plan.note && (
                    <span className="text-[10px] font-bold text-white px-2 py-0.5 rounded-full mb-3 inline-block" style={{ background: G }}>
                      {plan.note}
                    </span>
                  )}
                  <h3 className="text-[18px] font-bold text-white">{plan.name}</h3>
                  <p className="text-[11px] text-gray-400 mb-3">{plan.desc}</p>
                  <div className="mb-4">
                    <span className="text-[32px] font-black text-white">{plan.price}</span>
                    <span className="text-[12px] text-gray-400">{plan.period}</span>
                  </div>
                  <ul className="space-y-1.5 mb-5">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-center gap-2 text-[12px] text-gray-300">
                        <CheckCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => base44.auth.redirectToLogin()}
                    className="w-full py-2.5 rounded-xl text-[13px] font-bold text-white"
                    style={{ background: G }}
                  >
                    {plan.cta}
                  </button>
                </div>
              </div>
            ) : (
              <div key={plan.name} className="p-6 rounded-2xl text-right border border-white/8" style={{ background: '#111118' }}>
                {plan.note && (
                  <div className="text-[10px] text-gray-500 mb-2">{plan.note}</div>
                )}
                <h3 className="text-[18px] font-bold text-white">{plan.name}</h3>
                <p className="text-[11px] text-gray-400 mb-3">{plan.desc}</p>
                <div className="mb-4">
                  <span className="text-[32px] font-black text-white">{plan.price}</span>
                  <span className="text-[12px] text-gray-400">{plan.period}</span>
                </div>
                <ul className="space-y-1.5 mb-5">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-[12px] text-gray-300">
                      <CheckCircle className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => base44.auth.redirectToLogin()}
                  className="w-full py-2.5 rounded-xl text-[13px] font-semibold border border-white/15 text-gray-300 hover:border-white/30 transition-all"
                >
                  {plan.cta}
                </button>
              </div>
            )
          ))}
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────────── */}
      <section className="max-w-2xl mx-auto px-6 pb-24 text-center">
        <div className="p-8 rounded-3xl" style={{ background: 'linear-gradient(135deg, rgba(123,47,190,0.15) 0%, rgba(232,52,77,0.15) 100%)', border: '1px solid rgba(232,52,77,0.2)' }}>
          <h2 className="text-[26px] md:text-[32px] font-black mb-3">
            מוכן להפסיק להגיב<br/>ולהתחיל להוביל?
          </h2>
          <p className="text-[13px] text-gray-400 mb-6">שבוע ניסיון חינם · ללא כרטיס אשראי · ביטול בכל עת</p>
          <button
            onClick={() => base44.auth.redirectToLogin()}
            className="px-8 py-4 rounded-full text-[15px] font-bold text-white hover:opacity-90 transition-all"
            style={{ background: G }}
          >
            התחל ניסיון חינם עכשיו
          </button>
          <div className="flex items-center justify-center gap-4 mt-4 text-[11px] text-gray-500">
            <span>✓ עברית 100%</span>
            <span>✓ WhatsApp-native</span>
            <span>✓ ללא התחייבות</span>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/8 py-8 text-center text-[11px] text-gray-600">
        <div className="flex items-center justify-center gap-6 mb-2">
          <Link to="/privacy" className="hover:text-gray-400 transition-colors">פרטיות</Link>
          <Link to="/terms" className="hover:text-gray-400 transition-colors">תנאים</Link>
          <Link to="/contact" className="hover:text-gray-400 transition-colors">צור קשר</Link>
          <Link to="/pricing" className="hover:text-gray-400 transition-colors">מחירים</Link>
        </div>
        <p>© 2026 Cortexi. כל הזכויות שמורות.</p>
      </footer>
    </div>
  );
}
