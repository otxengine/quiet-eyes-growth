import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  Star, Bell, Shield, ChevronRight, ArrowLeft,
  CheckCircle, Instagram, Heart, Users, Sparkles, TrendingUp
} from 'lucide-react';

const G = 'linear-gradient(135deg, #7B2FBE 0%, #E8344D 55%, #FF8C00 100%)';
const gText = { background: G, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' };
const gBorder = { background: G, padding: '1px', borderRadius: '16px' };
const dark = { background: '#13131A', borderRadius: '15px' };

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

// ── Client lapse card ────────────────────────────────────────────────────────
function ClientLapseCard({ name, lastVisit, treatment, action }) {
  return (
    <div className="p-3.5 rounded-xl border border-white/8 text-right" style={{ background: '#161621' }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-bold text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded-full">לא חזרה</span>
        <span className="text-[13px] font-semibold text-white">{name}</span>
      </div>
      <div className="text-[11px] text-gray-400 mb-1">ביקור אחרון: {lastVisit}</div>
      <div className="text-[11px] text-gray-400 mb-2">טיפול: {treatment}</div>
      <div className="text-[11px] font-medium text-purple-400">→ {action}</div>
    </div>
  );
}

// ── Beauty salon mockup ──────────────────────────────────────────────────────
function BeautyMockup() {
  return (
    <div className="rounded-2xl overflow-hidden border border-white/10" style={{ background: '#0E0E16' }}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8">
        <div className="flex gap-1.5">
          {['#FF5F57','#FEBC2E','#28C840'].map(c => <div key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />)}
        </div>
        <span className="text-[11px] text-gray-500 mx-auto">Cortexi — סלון נעמי, הרצליה</span>
      </div>

      <div className="p-4 space-y-3">
        {/* KPIs */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'לא חזרו החודש', val: '6', color: '#F59E0B' },
            { label: 'Google דירוג', val: '4.8', color: '#22C55E' },
            { label: 'Instagram reach', val: '2.1K', color: '#A78BFA' },
          ].map(k => (
            <div key={k.label} className="p-2.5 rounded-xl text-center border border-white/5" style={{ background: '#161621' }}>
              <div className="text-[16px] font-bold" style={{ color: k.color }}>{k.val}</div>
              <div className="text-[9px] text-gray-500">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Lapsed clients */}
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">לקוחות שלא חזרו — פעולה נדרשת</div>
        <ClientLapseCard
          name="טל כהן"
          lastVisit="לפני 7 שבועות"
          treatment="ציפורניים ג'ל"
          action='שלח "מיסנו אותך — 10% על הביקור הבא"'
        />
        <ClientLapseCard
          name="ליאור ב."
          lastVisit="לפני 5 שבועות"
          treatment="צביעת שיער"
          action="הזכר שהגיע זמן לצביעה + קישור להזמנה"
        />

        {/* Action */}
        <button className="w-full py-2 rounded-xl text-[11px] font-bold text-white" style={{ background: G }}>
          שלח WhatsApp לשתיהן ✓
        </button>
      </div>
    </div>
  );
}

const PAIN_POINTS = [
  { q: 'לקוחה לא חזרה — ולא ידעת למה', a: 'Cortexi מנטרת כל לקוחה, מזהה מתי עוברת זמן ותר וחלון ביקור רגיל, ושולחת הצעה בזמן הנכון' },
  { q: 'ביקורת שלילית פגעה בדירוג Google שלך', a: 'Cortexi מזהה ביקורת שלילית תוך דקות, מנסחת תגובה אנושית בטון שלך, ושולחת לאישורך' },
  { q: 'מתחרה פתח סלון חדש ברחוב — ואתה לא ידעת', a: 'סריקה אוטומטית של פתיחות חדשות ברדיוס 2 ק"מ. Cortexi מציעה קמפיין "ברוכים הבאים לשכונה" מהיר' },
  { q: 'Instagram post שלך לא מביא לקוחות', a: 'Cortexi מנתחת ביצועים, מזהה את הסוג התוכן שממיר אצלך, ומציעה פוסטים בשעות הנכונות' },
];

const FEATURES = [
  { icon: Heart, title: 'שימור לקוחות חכם', body: 'לקוחה לא חזרה 6 שבועות? Cortexi מזהה, שולחת הצעה מותאמת, ומחזירה אותה לפני שהיא הולכת למתחרה' },
  { icon: Star, title: 'Google Reviews', body: 'ביקורות Google הן מה שמביא לקוחות חדשות. Cortexi מנהלת, מגיבה, ומשפרת את הדירוג שלך — אוטומטית' },
  { icon: Instagram, title: 'Instagram Analytics', body: 'איזה תוכן מביא הזמנות? Cortexi מנתחת ומציעה פוסטים מנצחים בזמן הנכון לקהל הנכון' },
  { icon: Users, title: 'מעקב מתחרים', body: 'סלון חדש, מבצע חדש, שירות חדש — Cortexi מזהה ומציעה תגובה לפני שהלקוחות שלך יראו' },
  { icon: Bell, title: 'WhatsApp Retention', body: 'הזמנה לחזרה, ברכת יום הולדת, הצעת "מיסנו אותך" — ישירות מהנייד שלך. בלחיצת אישור' },
  { icon: TrendingUp, title: 'זיהוי טרנדים', body: 'טרנד "ציפורניים כחולות" עולה? Cortexi מזהה שבועות לפני שכל הסלונות יציעו את זה' },
];

const TESTIMONIALS = [
  {
    name: 'נעמי אברהם',
    role: 'בעלת סלון יופי, הרצליה',
    text: 'Cortexi שלחה הצעה ל-6 לקוחות שלא חזרו — 4 מהן קבעו תור תוך 48 שעות. זה ₪1,800 שחזרו בשבוע אחד.',
    rating: 5,
  },
  {
    name: 'רוני שלום',
    role: 'מניקוריסטית עצמאית, ת"א',
    text: 'Google Reviews שלי עלה מ-4.2 ל-4.8 תוך חודשיים. Cortexi מגיבה לכל ביקורת בטון שלי בדיוק.',
    rating: 5,
  },
];

const PLANS = [
  {
    name: 'ניסיון חינם',
    price: '₪0',
    period: '/ שבוע',
    desc: 'ללא כרטיס אשראי',
    features: ['מעקב 10 לקוחות', 'התראות WhatsApp', 'ביקורות Google', '3 סוכנים'],
    cta: 'התחל ניסיון חינם',
    highlight: false,
  },
  {
    name: 'Basic',
    price: '₪300',
    period: '/ חודש',
    desc: 'לסלונות צומחים',
    features: ['שימור לקוחות מלא', 'ניהול Google Reviews', 'Instagram analytics', 'מעקב מתחרים', 'דוחות חודשיים', '8 סוכנים'],
    cta: 'התחל עכשיו',
    highlight: true,
    note: 'הכי נבחר',
  },
  {
    name: 'Premium',
    price: '₪600',
    period: '/ חודש',
    desc: 'להצמחה מהירה',
    features: ['כל הסוכנים', 'קמפיינים Instagram + Meta', 'WhatsApp + SMS', 'זיהוי טרנדים', 'CRM מלא', 'תמיכה עדיפות'],
    cta: 'לפרימיום',
    highlight: false,
  },
];

export default function LandingBeauty() {
  return (
    <div dir="rtl" style={{ background: '#0A0A0F', minHeight: '100vh', color: 'white', fontFamily: 'inherit' }}>

      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-white/8 max-w-6xl mx-auto">
        <Link to="/" className="text-[20px] font-bold" style={gText}>Cortexi</Link>
        <div className="flex items-center gap-3">
          <span className="hidden md:inline text-[11px] text-gray-400">ספרות · יופי · ציפורניים · קוסמטיקה</span>
          <button
            onClick={() => base44.auth.redirectToLogin()}
            className="px-4 py-2 rounded-full text-[13px] font-semibold text-white"
            style={{ background: G }}
          >
            ניסיון חינם — שבוע
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div className="text-right">
            <div className="inline-flex items-center gap-2 mb-5 px-3 py-1.5 rounded-full border border-white/10 text-[11px] text-gray-400"
              style={{ background: 'rgba(167,139,250,0.08)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
              סלונות יופי, ספרות, ציפורניים וקוסמטיקה
            </div>
            <h1 className="text-[38px] md:text-[48px] font-black leading-[1.15] mb-6">
              Cortexi רואה <span style={gText}>מי לא חזרה</span> — ושולחת הצעה לפני שהיא הולכת למתחרה
            </h1>
            <p className="text-[16px] text-gray-400 leading-relaxed mb-8">
              80% מהלקוחות שלך לא חוזרות — ולא בגלל שהן לא אוהבות אותך. Cortexi יודעת מתי לפנות, מה להגיד, ואיך להחזיר אותן — אוטומטית, ב-WhatsApp.
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
          <div className="hidden md:block">
            <BeautyMockup />
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-white/8 py-10">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center px-6">
          {[
            { label: 'לקוחות שחזרו', target: 3400, suffix: '+' },
            { label: 'סלונות פעילים', target: 220, suffix: '+' },
            { label: 'עלייה בחזרתיות', target: 28, suffix: '%' },
            { label: 'שביעות רצון', target: 97, suffix: '%' },
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

      {/* Pain → Solution */}
      <section className="max-w-4xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-[28px] md:text-[34px] font-black mb-3">הכאבים שאת/ה מכיר/ה</h2>
          <p className="text-[14px] text-gray-400">ו-Cortexi פותרת — לפני שהלקוחה הולכת למתחרה</p>
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

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="text-center mb-12">
          <h2 className="text-[28px] md:text-[34px] font-black mb-3">הכלים שסלונות מובילים משתמשים בהם</h2>
          <p className="text-[14px] text-gray-400">מה שקודם דרש מנהל שיווק — עכשיו רץ אוטומטי</p>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {FEATURES.map(f => (
            <div key={f.title} className="p-5 rounded-2xl text-right border border-white/8 hover:border-white/15 transition-all" style={{ background: '#111118' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: 'rgba(167,139,250,0.12)' }}>
                <f.icon className="w-5 h-5 text-purple-400" />
              </div>
              <h3 className="text-[15px] font-bold mb-1">{f.title}</h3>
              <p className="text-[12px] text-gray-400 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-3xl mx-auto px-6 pb-20">
        <div className="text-center mb-10">
          <h2 className="text-[26px] md:text-[32px] font-black mb-3">איך זה עובד?</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6 text-center">
          {[
            { n: '1', title: 'הרשמה (5 דקות)', body: 'מזינים פרטי הסלון + מספר נייד. Cortexi מתחילה ללמוד את הלקוחות שלך' },
            { n: '2', title: 'AI עובד 24/7', body: 'Cortexi מנטרת כניסות, ביקורות, Instagram ומתחרים — ברקע, בלי שתפסיקי לעבוד' },
            { n: '3', title: 'את/ה מחליט/ה', body: 'לקוחה לא חזרה? מגיעה התראה ל-WhatsApp עם הצעה מוכנה. אשר בקליק אחד' },
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

      {/* Testimonials */}
      <section className="max-w-4xl mx-auto px-6 pb-20">
        <div className="text-center mb-10">
          <h2 className="text-[26px] font-black mb-2">מה אומרות בעלות סלונות?</h2>
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

      {/* Pricing */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="text-center mb-10">
          <h2 className="text-[26px] md:text-[32px] font-black mb-3">מחירים לסלונות</h2>
          <p className="text-[14px] text-gray-400">שבוע ניסיון חינם — ללא כרטיס אשראי</p>
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
                        <CheckCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />{f}
                      </li>
                    ))}
                  </ul>
                  <button onClick={() => base44.auth.redirectToLogin()} className="w-full py-2.5 rounded-xl text-[13px] font-bold text-white" style={{ background: G }}>
                    {plan.cta}
                  </button>
                </div>
              </div>
            ) : (
              <div key={plan.name} className="p-6 rounded-2xl text-right border border-white/8" style={{ background: '#111118' }}>
                <h3 className="text-[18px] font-bold text-white">{plan.name}</h3>
                <p className="text-[11px] text-gray-400 mb-3">{plan.desc}</p>
                <div className="mb-4">
                  <span className="text-[32px] font-black text-white">{plan.price}</span>
                  <span className="text-[12px] text-gray-400">{plan.period}</span>
                </div>
                <ul className="space-y-1.5 mb-5">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-[12px] text-gray-300">
                      <CheckCircle className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />{f}
                    </li>
                  ))}
                </ul>
                <button onClick={() => base44.auth.redirectToLogin()} className="w-full py-2.5 rounded-xl text-[13px] font-semibold border border-white/15 text-gray-300 hover:border-white/30 transition-all">
                  {plan.cta}
                </button>
              </div>
            )
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-2xl mx-auto px-6 pb-24 text-center">
        <div className="p-8 rounded-3xl" style={{ background: 'linear-gradient(135deg, rgba(123,47,190,0.15) 0%, rgba(232,52,77,0.15) 100%)', border: '1px solid rgba(167,139,250,0.2)' }}>
          <h2 className="text-[26px] md:text-[32px] font-black mb-3">
            מוכן/ה שלקוחות<br/>יתחילו לחזור?
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

      {/* Footer */}
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
