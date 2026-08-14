import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  TrendingDown, Bell, Shield, Star, ChevronRight, ArrowLeft,
  CheckCircle, Zap, Users, Heart, BarChart2, AlertTriangle
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

// ── Churn risk member card ────────────────────────────────────────────────────
function MemberRiskCard({ name, risk, lastSeen, reason, action }) {
  const riskColor = risk === 'גבוה' ? '#EF4444' : risk === 'בינוני' ? '#F59E0B' : '#22C55E';
  return (
    <div className="p-3.5 rounded-xl border border-white/8 text-right" style={{ background: '#161621' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: riskColor, background: `${riskColor}18` }}>
          סיכון {risk}
        </span>
        <span className="text-[13px] font-semibold text-white">{name}</span>
      </div>
      <div className="text-[11px] text-gray-400 mb-1">כניסה אחרונה: {lastSeen}</div>
      <div className="text-[11px] text-gray-400 mb-2">סיבה: {reason}</div>
      <div className="text-[11px] font-medium text-blue-400">→ {action}</div>
    </div>
  );
}

// ── Fitness studio mockup ─────────────────────────────────────────────────────
function FitnessMockup() {
  return (
    <div className="rounded-2xl overflow-hidden border border-white/10" style={{ background: '#0E0E16' }}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8">
        <div className="flex gap-1.5">
          {['#FF5F57','#FEBC2E','#28C840'].map(c => <div key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />)}
        </div>
        <span className="text-[11px] text-gray-500 mx-auto">Cortexi — Studio B, הרצליה</span>
      </div>

      <div className="p-4 space-y-3">
        {/* Churn KPIs */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'סיכון עזיבה', val: '3', color: '#EF4444' },
            { label: 'שיעורים ריקים', val: '2', color: '#F59E0B' },
            { label: 'חידושים הבאים', val: '8', color: '#22C55E' },
          ].map(k => (
            <div key={k.label} className="p-2.5 rounded-xl text-center border border-white/5" style={{ background: '#161621' }}>
              <div className="text-[18px] font-bold" style={{ color: k.color }}>{k.val}</div>
              <div className="text-[9px] text-gray-500">{k.label}</div>
            </div>
          ))}
        </div>

        {/* At-risk members */}
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">חברים בסיכון עזיבה</div>
        <MemberRiskCard
          name="מיכל ר."
          risk="גבוה"
          lastSeen="לפני 18 ימים"
          reason="ירידה בתדירות + לא חידשה כרטיס"
          action="שלח הצעת הנחה 15% ב-WhatsApp"
        />
        <MemberRiskCard
          name="רון ב."
          risk="בינוני"
          lastSeen="לפני 11 ימים"
          reason="3 ביטולים רצופים"
          action="הזמן לשיעור ניסיון חינם"
        />

        {/* Action */}
        <button className="w-full py-2 rounded-xl text-[11px] font-bold text-white" style={{ background: G }}>
          אשר שליחת WhatsApp לשתיהן
        </button>
      </div>
    </div>
  );
}

const PAIN_POINTS = [
  { q: 'חברה עזבה ולא ידעת שהיא בסיכון', a: 'Cortexi מנטרת דפוסי כניסה, ביטולים ותגובות — ומזהה סיכון עזיבה 3 שבועות מראש' },
  { q: 'שיעורי בוקר כמעט ריקים — כסף שנשרף', a: 'Demand forecasting מזהה שעות עומס נמוך ומציעה קמפיין ממומן ממוקד להשלמת המקומות' },
  { q: 'מתחרה פתח סטודיו חדש ברחוב שלך', a: 'Cortexi מנטרת רדיוס 3 ק"מ, מזהה מתחרים חדשים, ומציעה "ברוכים הבאים לשכונה — 50% לחודש ראשון"' },
  { q: 'לא ידעת מתי להעלות מחירים', a: 'ניתוח מתחרים + ביקוש = המלצת תמחור. Cortexi יודעת מתי השוק מאפשר העלאה בלי לאבד חברים' },
];

const FEATURES = [
  { icon: AlertTriangle, title: 'זיהוי נטישה מוקדם', body: 'ירידה בתדירות + ביטולים + אי-חידוש = סיכון. Cortexi מזהה 14-21 יום לפני — עוד יש זמן לפעול' },
  { icon: BarChart2, title: 'Demand Gap', body: 'שיעורים ריקים = כסף אבוד. Cortexi מזהה מתי ולמי לשלוח הצעה ממוקדת לפני שהמקום נשאר ריק' },
  { icon: Users, title: 'מעקב מתחרים', body: 'סטודיו חדש בשכונה? מבצע של Arbox partner? מגיע אליך לפני שהחברים שלך יראו את זה' },
  { icon: Bell, title: 'WhatsApp-native', body: 'הצעת שימור, הזמנה לשיעור, ברכת יום הולדת — ישירות לנייד. אתה מאשר, Cortexi שולחת' },
  { icon: Shield, title: 'ביקורות ו-Google', body: 'דירוג Google זה מה שמביא חברים חדשים. Cortexi מנהלת, מגיבה, ומשפרת — אוטומטית' },
  { icon: Zap, title: 'קמפיינים ממוקדים', body: 'רשימת אנשים שביקרו בעבר + ביטול לאחרונה = קהל מושלם. Cortexi בונה ומפעילה ב-Meta' },
];

const TESTIMONIALS = [
  {
    name: 'שירה מזרחי',
    role: 'בעלת סטודיו פילאטיס, רמת השרון',
    text: 'Cortexi זיהתה שמיכל עומדת לעזוב שלושה שבועות לפני שזה קרה. שלחנו הצעה, היא חידשה. בחודש הראשון שמרנו 4 חברות.',
    rating: 5,
  },
  {
    name: 'אמיר דוד',
    role: 'מדריך CrossFit, כפר סבא',
    text: 'שיעורי הבוקר שלי עלו מ-40% לתפוסה ל-85%. Cortexi שלחה הצעות ממוקדות לרשימת חברים שלא הגיעו בבוקר.',
    rating: 5,
  },
];

const PLANS = [
  {
    name: 'ניסיון חינם',
    price: '₪0',
    period: '/ שבוע',
    desc: 'ללא כרטיס אשראי',
    features: ['זיהוי נטישה בסיסי', '3 חברים במעקב', 'התראות WhatsApp', '3 סוכנים'],
    cta: 'התחל ניסיון חינם',
    highlight: false,
  },
  {
    name: 'Basic',
    price: '₪300',
    period: '/ חודש',
    desc: 'לסטודיות צומחות',
    features: ['זיהוי נטישה מלא', 'עד 200 חברים', 'Demand gap', 'מעקב מתחרים', 'ביקורות גוגל', 'דוחות שבועיים'],
    cta: 'התחל עכשיו',
    highlight: true,
    note: 'הכי נבחר',
  },
  {
    name: 'Premium',
    price: '₪600',
    period: '/ חודש',
    desc: 'להצמחה מהירה',
    features: ['כל הסוכנים', 'קמפיינים אוטומטיים', 'ניהול Meta Ads', 'WhatsApp + SMS', 'CRM מלא', 'תמיכה עדיפות'],
    cta: 'לפרימיום',
    highlight: false,
  },
];

export default function LandingFitness() {
  return (
    <div dir="rtl" style={{ background: '#0A0A0F', minHeight: '100vh', color: 'white', fontFamily: 'inherit' }}>

      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-white/8 max-w-6xl mx-auto">
        <Link to="/" className="text-[20px] font-bold" style={gText}>Cortexi</Link>
        <div className="flex items-center gap-3">
          <span className="hidden md:inline text-[11px] text-gray-400">סטודיות כושר ופילאטיס</span>
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
              style={{ background: 'rgba(232,52,77,0.08)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              פילאטיס · יוגה · CrossFit · Personal Training
            </div>
            <h1 className="text-[38px] md:text-[48px] font-black leading-[1.15] mb-6">
              גלה את החבר/ה שעומד/ת <span style={gText}>לעזוב</span> — לפני שהם עוזבים
            </h1>
            <p className="text-[16px] text-gray-400 leading-relaxed mb-8">
              Churn הוא מחלה שקטה של סטודיות כושר. Cortexi מזהה כל חבר/ה בסיכון עזיבה 14-21 יום מראש — ושולחת הצעה מותאמת אישית לאישורך ב-WhatsApp.
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
            <FitnessMockup />
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-white/8 py-10">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center px-6">
          {[
            { label: 'חברים שנשמרו', target: 2800, suffix: '+' },
            { label: 'סטודיות פעילות', target: 180, suffix: '+' },
            { label: 'ירידה ממוצעת ב-churn', target: 34, suffix: '%' },
            { label: 'שביעות רצון', target: 96, suffix: '%' },
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
          <h2 className="text-[28px] md:text-[34px] font-black mb-3">הכאבים שאתה/ת מכיר/ה</h2>
          <p className="text-[14px] text-gray-400">ו-Cortexi פותרת — לפני שהנזק נעשה</p>
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
          <h2 className="text-[28px] md:text-[34px] font-black mb-3">כלים שסטודיות מובילות משתמשות בהם</h2>
          <p className="text-[14px] text-gray-400">מעבר ל-Arbox ו-Mindbody — שכבת AI ששומרת על החברים שלך</p>
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

      {/* How it works */}
      <section className="max-w-3xl mx-auto px-6 pb-20">
        <div className="text-center mb-10">
          <h2 className="text-[26px] md:text-[32px] font-black mb-3">איך זה עובד?</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6 text-center">
          {[
            { n: '1', title: 'חיבור (5 דקות)', body: 'מזינים פרטי סטודיו + מספר נייד. Cortexi מתחילה ללמוד את דפוסי החברים שלך' },
            { n: '2', title: 'AI עובד 24/7', body: 'Cortexi מנטרת כניסות, ביטולים, ביקורות ומתחרים — ברקע, בלי שתעצור' },
            { n: '3', title: 'אתה מחליט', body: 'חבר/ה בסיכון? מגיעה התראה ל-WhatsApp עם הצעת שימור מוכנה. אשר בקליק' },
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
          <h2 className="text-[26px] font-black mb-2">מה אומרים בעלי סטודיות?</h2>
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
          <h2 className="text-[26px] md:text-[32px] font-black mb-3">מחירים לסטודיות</h2>
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
        <div className="p-8 rounded-3xl" style={{ background: 'linear-gradient(135deg, rgba(123,47,190,0.15) 0%, rgba(232,52,77,0.15) 100%)', border: '1px solid rgba(232,52,77,0.2)' }}>
          <h2 className="text-[26px] md:text-[32px] font-black mb-3">
            מוכן/ה להפסיק לאבד<br/>חברים בשקט?
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
