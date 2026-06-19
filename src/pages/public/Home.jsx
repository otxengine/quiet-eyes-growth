import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  Eye, Shield, TrendingUp, Users, Target, BarChart2, Zap, CheckCircle,
  ArrowLeft, Star, ChevronRight, Activity, Brain, Clock
} from 'lucide-react';
import DashboardMockup from '@/components/public/DashboardMockup';

const G = 'linear-gradient(135deg, #7B2FBE 0%, #E8344D 55%, #FF8C00 100%)';
const glassCard = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)' };
const gradientText = { background: G, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' };

// ─── Animated counter ────────────────────────────────────────────────────────
function AnimatedCounter({ target, suffix = '', prefix = '' }) {
  const [value, setValue] = useState(0);
  const ref = useRef(null);
  const started = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started.current) {
        started.current = true;
        const duration = 1500;
        const steps = 60;
        const increment = target / steps;
        let current = 0;
        const timer = setInterval(() => {
          current += increment;
          if (current >= target) { setValue(target); clearInterval(timer); }
          else setValue(Math.floor(current));
        }, duration / steps);
      }
    }, { threshold: 0.3 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target]);

  return (
    <span ref={ref} className="tabular-nums">
      {prefix}{value.toLocaleString('he-IL')}{suffix}
    </span>
  );
}

// ─── Data ─────────────────────────────────────────────────────────────────────
const STATS = [
  { label: 'עסקים פעילים', target: 500, suffix: '+' },
  { label: 'לידים שנוצרו', target: 12000, suffix: '+' },
  { label: 'שביעות רצון', target: 94, suffix: '%' },
  { label: 'ביקורות שטופלו', target: 48000, suffix: '+' },
];

const SECTORS = [
  { icon: '🍕', label: 'מסעדות' },
  { icon: '💪', label: 'כושר' },
  { icon: '💇', label: 'יופי' },
  { icon: '🏥', label: 'רפואה' },
  { icon: '🛒', label: 'קמעונאות' },
  { icon: '🏗️', label: 'שיפוצים' },
];

const FEATURES = [
  {
    icon: Eye,
    title: 'מודיעין שוק — 24/7',
    desc: 'Cortexi סורקת את הרשת בשבילך. כל שינוי אצל מתחרה, כל אזכור של עסקך, כל מגמת שוק — מגיע אליך לפני שמישהו אחר יודע.',
    points: ['סריקה של גוגל, רשתות חברתיות ופורומים', 'התראות בזמן אמת', 'ניתוח AI אוטומטי'],
  },
  {
    icon: Target,
    title: 'ניתוח מתחרים מעמיק',
    desc: 'SWOT, אסטרטגיה, וכרטיס קרב לכל מתחרה. Cortexi מזהה שינויי מחיר, תפריטים ושירותים חדשים — ומציעה תגובה נגדית.',
    points: ['ניתוח SWOT אוטומטי', 'שינויי מחיר ותפריט', 'תגובה נגדית מוכנה'],
  },
  {
    icon: Shield,
    title: 'ניהול מוניטין מרכזי',
    desc: 'ביקורות מגוגל, פייסבוק, אינסטגרם, TripAdvisor ועוד — במקום אחד. תגובות AI מותאמות לטון שלך, בלחיצה.',
    points: ['כל הפלטפורמות במקום אחד', 'תגובות AI אוטומטיות', 'ניתוח סנטימנט'],
  },
  {
    icon: TrendingUp,
    title: 'לידים חכמים עם AI',
    desc: 'Cortexi מזהה אנשים שמחפשים בדיוק מה שאתה מוכר — ברשתות חברתיות, בפורומים, בקבוצות. מסנן לפי קריטריונים שאתה קובע.',
    points: ['זיהוי כוונת קנייה', 'ניקוד לידים אוטומטי', 'הודעת WhatsApp מוכנה'],
  },
  {
    icon: Users,
    title: 'שימור לקוחות',
    desc: 'Cortexi מזהה לקוחות בסיכון לפני שהם עוזבים. סקרי שביעות רצון, הצעות ממוקדות, ומעקב אחרי לקוחות לא פעילים.',
    points: ['זיהוי לקוחות בסיכון', 'סקרי שביעות רצון', 'הצעות אוטומטיות'],
  },
  {
    icon: BarChart2,
    title: 'דוחות ביצועים שמרשימים',
    desc: 'דוח שבועי שמראה בדיוק מה Cortexi עשתה בשבילך — כמה לידים, ביקורות, תובנות, ושינויים שזוהו. ערך שניתן למדוד.',
    points: ['דוח שבועי אוטומטי', 'ROI מדיד', 'תובנות ברשתות חברתיות'],
  },
];

const HOW_IT_WORKS = [
  {
    step: '01',
    icon: Brain,
    title: 'מגדיר את העסק שלך',
    desc: 'תיאור, סקטור, מיקום, שירותים, מתחרים ידועים. 5 דקות — וCortexi יודעת מה לחפש.',
  },
  {
    step: '02',
    icon: Activity,
    title: 'הסוכנים עובדים בשקט',
    desc: '8 סוכני AI סורקים 24/7. כל תובנה, כל שינוי, כל ליד — עובר דרך מסנן AI ומגיע אליך מנותח.',
  },
  {
    step: '03',
    icon: Zap,
    title: 'מקבל תובנות ופועל',
    desc: 'לוח הבקרה מציג לך מה דחוף ומה לעשות. פעולה בלחיצה — תגובה לביקורת, הודעה לליד, פוסט נגדי.',
  },
];

const TESTIMONIALS = [
  {
    text: 'הפסקתי להיות מופתע. עכשיו אני יודע על כל שינוי אצל מתחרה לפני כולם — כולל שינוי מחיר שעשו ב-48 שעות.',
    author: 'יוסי כהן',
    role: 'בעל מסעדה',
    city: 'תל אביב',
    stars: 5,
    result: '↑ 34% עלייה בהכנסות',
  },
  {
    text: 'הביקורת השלילית קיבלה תגובה תוך 5 דקות. הלקוח ראה שמישהו אכפת לו וחזר. Cortexi הצילה לי עסקה.',
    author: 'מיכל לוי',
    role: 'בעלת מספרה',
    city: 'רמת גן',
    stars: 5,
    result: '↑ 4.8 דירוג גוגל',
  },
  {
    text: '3 לידים חמים בשבוע הראשון. אחד מהם סגר עסקה של 8,000₪. הסוכן מצא אותו בקבוצת פייסבוק.',
    author: 'דוד אברהם',
    role: 'חנות ספורט',
    city: 'בני ברק',
    stars: 5,
    result: '₪8,000 עסקה בשבוע 1',
  },
];

const PLANS = [
  {
    name: 'מתחיל',
    price: 'חינם',
    period: '',
    features: ['עד 3 מתחרים', '20 סריקות/חודש', 'לוח בקרה בסיסי', 'תמיכה בדוא"ל'],
    isPaid: false,
    isPopular: false,
  },
  {
    name: 'צמיחה',
    price: '₪199',
    period: '/ חודש',
    features: ['עד 10 מתחרים', '500 סריקות/חודש', 'כל הסוכנים', 'דוחות שבועיים', 'WhatsApp התראות'],
    isPaid: true,
    isPopular: true,
    badge: 'הכי פופולרי',
  },
  {
    name: 'פרו',
    price: '₪499',
    period: '/ חודש',
    features: ['מתחרים ללא הגבלה', 'סריקות ללא הגבלה', 'API גישה', 'מנהל חשבון ייעודי', 'SLA 99.9%'],
    isPaid: true,
    isPopular: false,
  },
];

// ─── Component ────────────────────────────────────────────────────────────────
export default function PublicHome() {
  return (
    <div className="min-h-screen" style={{ background: '#0A0A0F' }} dir="rtl">

      {/* ── Hero ── */}
      <section className="px-6 pt-20 pb-16 max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold mb-5"
              style={{ ...glassCard, ...gradientText }}
            >
              <Activity className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#E8344D' }} />
              <span style={gradientText}>Inspired by the brain. Built for intelligence.</span>
            </div>
            <h1 className="text-[38px] md:text-[52px] font-black text-white leading-[1.1] mb-5 tracking-tight">
              המערכת שיודעת מה<br />
              קורה בשוק שלך<br />
              לפני כולם
            </h1>
            <p className="text-[16px] leading-relaxed mb-8 max-w-lg font-semibold" style={gradientText}>
              Inspired by the brain. Built for intelligence.
            </p>
            <div className="flex flex-wrap gap-3 mb-8">
              <button
                onClick={() => base44.auth.redirectToLogin()}
                className="flex items-center gap-2 px-6 py-3 rounded-xl text-white text-[14px] font-semibold hover:opacity-90 transition-all"
                style={{ background: G }}
              >
                התחל בחינם
                <ArrowLeft className="w-4 h-4" />
              </button>
              <Link
                to="/how-it-works"
                className="flex items-center gap-2 px-5 py-3 rounded-xl text-[14px] font-medium text-white transition-all hover:bg-white/10"
                style={{ border: '1px solid rgba(255,255,255,0.15)' }}
              >
                ראה איך זה עובד
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <span>ללא כרטיס אשראי</span>
              <span>·</span>
              <span>ביטול בכל עת</span>
              <span>·</span>
              <span>תובנה ראשונה תוך 60 שניות</span>
            </div>
          </div>
          <div className="hidden lg:block">
            <DashboardMockup />
          </div>
        </div>
      </section>

      {/* ── Animated Stats ── */}
      <section className="py-10" style={{ borderTop: '1px solid rgba(255,255,255,0.07)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="max-w-4xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {STATS.map(stat => (
              <div key={stat.label} className="text-center">
                <div className="text-[32px] font-black leading-none mb-1 text-white">
                  <AnimatedCounter target={stat.target} suffix={stat.suffix} />
                </div>
                <p className="text-[11px] font-medium" style={{ color: '#9090A8' }}>{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Sectors strip ── */}
      <section className="py-8 px-6">
        <div className="max-w-4xl mx-auto">
          <p className="text-[11px] text-center mb-5 font-medium uppercase tracking-wider" style={{ color: '#9090A8' }}>מתאים לכל סקטור</p>
          <div className="flex flex-wrap justify-center gap-4">
            {SECTORS.map(s => (
              <div
                key={s.label}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-medium"
                style={{ ...glassCard, color: 'rgba(255,255,255,0.7)' }}
              >
                <span className="text-base">{s.icon}</span>
                {s.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature deep-dive ── */}
      <section className="px-6 py-20" style={{ background: 'rgba(255,255,255,0.02)' }}>
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-[30px] md:text-[38px] font-black text-white mb-4 leading-tight">
              כל מה שעסק מנצח צריך<br />
              <span style={gradientText}>במקום אחד</span>
            </h2>
            <p className="text-[15px] max-w-xl mx-auto" style={{ color: '#9090A8' }}>
              שש יכולות מרכזיות שעובדות ביחד — ומייצרות לך יתרון תחרותי אמיתי
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(f => (
              <div key={f.title} className="p-6 rounded-2xl" style={glassCard}>
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: G }}
                >
                  <f.icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-[14px] font-bold text-white mb-2">{f.title}</h3>
                <p className="text-[12px] leading-relaxed mb-4" style={{ color: '#9090A8' }}>{f.desc}</p>
                <ul className="space-y-1.5">
                  {f.points.map(p => (
                    <li key={p} className="flex items-center gap-2 text-[11px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                      <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#E8344D' }} />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="px-6 py-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-[30px] font-black text-white mb-4">שלושה צעדים פשוטים</h2>
            <p className="text-[15px]" style={{ color: '#9090A8' }}>מהרשמה ועד התובנה הראשונה — פחות מ-5 דקות</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map((step, i) => (
              <div key={step.step} className="relative">
                <div className="text-center">
                  <div
                    className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
                    style={{ background: G }}
                  >
                    <step.icon className="w-6 h-6 text-white" />
                  </div>
                  <div className="text-[10px] font-black tracking-[0.2em] mb-2" style={{ color: '#9090A8' }}>{step.step}</div>
                  <h3 className="text-[15px] font-bold text-white mb-2">{step.title}</h3>
                  <p className="text-[12px] leading-relaxed" style={{ color: '#9090A8' }}>{step.desc}</p>
                </div>
                {i < HOW_IT_WORKS.length - 1 && (
                  <div className="hidden md:block absolute top-7 left-0 w-full text-center">
                    <ChevronRight className="w-5 h-5 mx-auto" style={{ color: 'rgba(255,255,255,0.15)', marginLeft: '-50%' }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="px-6 py-20" style={{ background: 'rgba(255,255,255,0.02)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-[30px] font-black text-white mb-4">מה בעלי עסקים אומרים</h2>
            <p className="text-[15px]" style={{ color: '#9090A8' }}>תוצאות אמיתיות מעסקים שמשתמשים ב-Cortexi</p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className="p-6 rounded-2xl" style={glassCard}>
                <div className="flex items-center gap-1 mb-3">
                  {Array.from({ length: t.stars }).map((_, j) => (
                    <Star key={j} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="text-[13px] leading-relaxed mb-4 italic" style={{ color: 'rgba(255,255,255,0.7)' }}>"{t.text}"</p>
                <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                  <div>
                    <p className="text-[12px] font-semibold text-white">{t.author}</p>
                    <p className="text-[10px]" style={{ color: '#9090A8' }}>{t.role}, {t.city}</p>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
                    {t.result}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-center mt-4" style={{ color: 'rgba(255,255,255,0.3)' }}>* שמות שונו לצורך פרטיות. תוצאות משתנות בין עסקים.</p>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-[30px] font-black text-white mb-4">תמחור פשוט ושקוף</h2>
            <p className="text-[15px]" style={{ color: '#9090A8' }}>התחל בחינם. שדרג כשאתה צומח.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {PLANS.map(plan => (
              plan.isPopular ? (
                <div key={plan.name} style={{ background: G, padding: '1px', borderRadius: '16px' }}>
                  <div className="p-6 relative h-full" style={{ background: '#13131A', borderRadius: '15px' }}>
                    <div
                      className="absolute -top-3 left-1/2 -translate-x-1/2 text-white text-[10px] font-bold px-3 py-1 rounded-full"
                      style={{ background: G }}
                    >
                      {plan.badge}
                    </div>
                    <h3 className="text-[16px] font-bold text-white mb-1">{plan.name}</h3>
                    <div className="flex items-baseline gap-1 mb-5">
                      <span className="text-[32px] font-black text-white">{plan.price}</span>
                      <span className="text-[12px]" style={{ color: '#9090A8' }}>{plan.period}</span>
                    </div>
                    <ul className="space-y-2 mb-6">
                      {plan.features.map(f => (
                        <li key={f} className="flex items-center gap-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                          <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#E8344D' }} />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={() => base44.auth.redirectToLogin()}
                      className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white hover:opacity-90 transition-all"
                      style={{ background: G }}
                    >
                      בחר תוכנית
                    </button>
                  </div>
                </div>
              ) : (
                <div key={plan.name} className="p-6 rounded-2xl" style={glassCard}>
                  <h3 className="text-[16px] font-bold text-white mb-1">{plan.name}</h3>
                  <div className="flex items-baseline gap-1 mb-5">
                    <span className="text-[32px] font-black text-white">{plan.price}</span>
                    <span className="text-[12px]" style={{ color: '#9090A8' }}>{plan.period}</span>
                  </div>
                  <ul className="space-y-2 mb-6">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-center gap-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                        <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => base44.auth.redirectToLogin()}
                    className="w-full py-2.5 rounded-xl text-[13px] font-semibold hover:opacity-80 transition-all"
                    style={plan.isPaid ? { background: G, color: '#fff' } : { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.12)' }}
                  >
                    {plan.price === 'חינם' ? 'התחל בחינם' : 'בחר תוכנית'}
                  </button>
                </div>
              )
            ))}
          </div>
          <p className="text-[11px] text-center mt-6" style={{ color: '#9090A8' }}>
            <Clock className="w-3.5 h-3.5 inline ml-1" />
            ניסיון חינם 14 ימים לכל התוכניות · ביטול בכל עת · אין חוזה
          </p>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="px-6 py-24" style={{ background: G }}>
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/20 text-white text-[11px] font-medium mb-6">
            <Zap className="w-3.5 h-3.5" />
            תובנה ראשונה תוך 60 שניות
          </div>
          <h2 className="text-[32px] md:text-[44px] font-black text-white mb-5 leading-tight">
            תפסיק לנחש.<br />
            התחל לדעת.
          </h2>
          <p className="text-[15px] text-white/80 mb-8 leading-relaxed">
            הרשמה חינם. ללא כרטיס אשראי. ללא חוזה.<br />
            עסקים שמשתמשים ב-Cortexi יודעים מה קורה בשוק — לפני המתחרים.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <button
              onClick={() => base44.auth.redirectToLogin()}
              className="flex items-center gap-2 px-10 py-4 rounded-xl text-[15px] font-bold hover:opacity-90 transition-all shadow-lg"
              style={{ background: '#0A0A0F', color: '#ffffff' }}
            >
              התחל עכשיו — בחינם
              <ArrowLeft className="w-5 h-5" />
            </button>
            <Link
              to="/how-it-works"
              className="flex items-center gap-2 px-8 py-4 rounded-xl text-[14px] font-medium hover:bg-white/20 transition-all"
              style={{ border: '1px solid rgba(255,255,255,0.4)', color: 'rgba(255,255,255,0.9)' }}
            >
              ראה הדגמה חיה
            </Link>
          </div>
        </div>
      </section>

    </div>
  );
}
