import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  Eye, Shield, TrendingUp, Users, Target, BarChart2, Zap, CheckCircle,
  ArrowLeft, Star, ChevronRight, Activity, Brain, Clock
} from 'lucide-react';
import DashboardMockup from '@/components/public/DashboardMockup';

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
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
    border: 'border-indigo-100',
    title: 'עיניים שקטות — מודיעין 24/7',
    desc: '8 סוכני AI סורקים את הרשת בשבילך. כל שינוי אצל מתחרה, כל אזכור של עסקך, כל מגמת שוק — מגיע אליך לפני שמישהו אחר יודע.',
    points: ['סריקה של גוגל, רשתות חברתיות ופורומים', 'התראות בזמן אמת', 'ניתוח AI אוטומטי'],
  },
  {
    icon: Target,
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    border: 'border-purple-100',
    title: 'ניתוח מתחרים מעמיק',
    desc: 'SWOT, אסטרטגיה, וכרטיס קרב לכל מתחרה. המערכת מזהה שינויי מחיר, תפריטים ושירותים חדשים — ומציעה לך תגובה נגדית.',
    points: ['ניתוח SWOT אוטומטי', 'שינויי מחיר ותפריט', 'תגובה נגדית מוכנה'],
  },
  {
    icon: Shield,
    color: 'text-green-600',
    bg: 'bg-green-50',
    border: 'border-green-100',
    title: 'ניהול מוניטין מרכזי',
    desc: 'ביקורות מגוגל, פייסבוק, אינסטגרם, TripAdvisor ועוד — במקום אחד. תגובות AI מותאמות לטון שלך, בלחיצה.',
    points: ['כל הפלטפורמות במקום אחד', 'תגובות AI אוטומטיות', 'ניתוח סנטימנט'],
  },
  {
    icon: TrendingUp,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-100',
    title: 'לידים חכמים עם AI',
    desc: 'הסוכן מזהה אנשים שמחפשים בדיוק מה שאתה מוכר — ברשתות חברתיות, בפורומים, בקבוצות. מסנן לפי קריטריונים שאתה קובע.',
    points: ['זיהוי כוונת קנייה', 'ניקוד לידים אוטומטי', 'הודעת WhatsApp מוכנה'],
  },
  {
    icon: Users,
    color: 'text-rose-600',
    bg: 'bg-rose-50',
    border: 'border-rose-100',
    title: 'שימור לקוחות',
    desc: 'המערכת מזהה לקוחות בסיכון לפני שהם עוזבים. סקרי שביעות רצון, הצעות ממוקדות, ומעקב אחרי לקוחות לא פעילים.',
    points: ['זיהוי לקוחות בסיכון', 'סקרי שביעות רצון', 'הצעות אוטומטיות'],
  },
  {
    icon: BarChart2,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-100',
    title: 'דוחות ביצועים שמרשימים',
    desc: 'דוח שבועי שמראה בדיוק מה המערכת עשתה בשבילך — כמה לידים, ביקורות, תובנות, ושינויים שזוהו. ערך שניתן למדוד.',
    points: ['דוח שבועי אוטומטי', 'ROI מדיד', 'תובנות ברשתות חברתיות'],
  },
];

const HOW_IT_WORKS = [
  {
    step: '01',
    icon: Brain,
    title: 'מגדיר את העסק שלך',
    desc: 'תיאור, סקטור, מיקום, שירותים, מתחרים ידועים. 5 דקות — והמערכת יודעת מה לחפש.',
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
    text: 'הביקורת השלילית קיבלה תגובה תוך 5 דקות. הלקוח ראה שמישהו אכפת לו וחזר. המערכת הצילה לי עסקה.',
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
    color: 'border-border',
    btn: 'bg-secondary text-foreground',
    features: ['עד 3 מתחרים', '20 סריקות/חודש', 'לוח בקרה בסיסי', 'תמיכה בדוא"ל'],
  },
  {
    name: 'צמיחה',
    price: '₪199',
    period: '/ חודש',
    color: 'border-primary ring-2 ring-primary/20',
    btn: 'bg-foreground text-background',
    badge: 'הכי פופולרי',
    features: ['עד 10 מתחרים', '500 סריקות/חודש', 'כל הסוכנים', 'דוחות שבועיים', 'WhatsApp התראות'],
  },
  {
    name: 'פרו',
    price: '₪499',
    period: '/ חודש',
    color: 'border-border',
    btn: 'bg-secondary text-foreground',
    features: ['מתחרים ללא הגבלה', 'סריקות ללא הגבלה', 'API גישה', 'מנהל חשבון ייעודי', 'SLA 99.9%'],
  },
];

// ─── Component ────────────────────────────────────────────────────────────────
export default function PublicHome() {
  return (
    <div className="min-h-screen bg-white" dir="rtl">

      {/* ── Hero ── */}
      <section className="px-6 pt-20 pb-16 max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/8 text-primary border border-primary/20 text-[11px] font-semibold mb-5">
              <Activity className="w-3.5 h-3.5" />
              מערכת מודיעין עסקי בזמן אמת
            </div>
            <h1 className="text-[38px] md:text-[52px] font-black text-foreground leading-[1.1] mb-5 tracking-tight">
              המערכת שיודעת מה<br />
              <span className="text-primary">קורה בשוק שלך</span><br />
              לפני כולם
            </h1>
            <p className="text-[16px] text-foreground-muted leading-relaxed mb-8 max-w-lg">
              8 סוכני AI עובדים 24/7 — סורקים מתחרים, מנהלים ביקורות, מוצאים לידים ומייצרים לך תובנות בזמן אמת. בלי שתגביה אצבע.
            </p>
            <div className="flex flex-wrap gap-3 mb-8">
              <button
                onClick={() => base44.auth.redirectToLogin()}
                className="flex items-center gap-2 px-8 py-3.5 rounded-xl bg-foreground text-background text-[14px] font-semibold hover:opacity-90 transition-all shadow-sm"
              >
                התחל בחינם
                <ArrowLeft className="w-4 h-4" />
              </button>
              <Link
                to="/how-it-works"
                className="flex items-center gap-2 px-8 py-3.5 rounded-xl border border-border text-[14px] font-medium text-foreground-secondary hover:bg-secondary transition-all"
              >
                ראה איך זה עובד
              </Link>
            </div>
            <div className="flex items-center gap-4 text-[12px] text-foreground-muted">
              <span className="flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5 text-success" /> ללא כרטיס אשראי</span>
              <span className="flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5 text-success" /> תובנה ראשונה תוך 60 שניות</span>
              <span className="flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5 text-success" /> ביטול בכל עת</span>
            </div>
          </div>
          <div className="hidden lg:block">
            <DashboardMockup />
          </div>
        </div>
      </section>

      {/* ── Animated Stats ── */}
      <section className="py-10 border-y border-border bg-secondary/20">
        <div className="max-w-4xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {STATS.map(stat => (
              <div key={stat.label} className="text-center">
                <div className="text-[32px] font-black text-foreground leading-none mb-1">
                  <AnimatedCounter target={stat.target} suffix={stat.suffix} />
                </div>
                <p className="text-[11px] text-foreground-muted font-medium">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Sectors strip ── */}
      <section className="py-8 px-6">
        <div className="max-w-4xl mx-auto">
          <p className="text-[11px] text-foreground-muted text-center mb-5 font-medium uppercase tracking-wider">מתאים לכל סקטור</p>
          <div className="flex flex-wrap justify-center gap-4">
            {SECTORS.map(s => (
              <div key={s.label} className="flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-secondary/30 text-[12px] font-medium text-foreground-secondary">
                <span className="text-base">{s.icon}</span>
                {s.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature deep-dive ── */}
      <section className="px-6 py-20 bg-secondary/20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-[30px] md:text-[38px] font-black text-foreground mb-4 leading-tight">
              כל מה שעסק מנצח צריך<br />
              <span className="text-primary">במקום אחד</span>
            </h2>
            <p className="text-[15px] text-foreground-muted max-w-xl mx-auto">
              שש יכולות מרכזיות שעובדות ביחד — ומייצרות לך יתרון תחרותי אמיתי
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(f => (
              <div key={f.title} className={`card-base p-6 border-t-4 ${f.border}`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${f.bg} ${f.border} border`}>
                  <f.icon className={`w-5 h-5 ${f.color}`} />
                </div>
                <h3 className="text-[14px] font-bold text-foreground mb-2">{f.title}</h3>
                <p className="text-[12px] text-foreground-muted leading-relaxed mb-4">{f.desc}</p>
                <ul className="space-y-1.5">
                  {f.points.map(p => (
                    <li key={p} className="flex items-center gap-2 text-[11px] text-foreground-secondary">
                      <CheckCircle className={`w-3.5 h-3.5 flex-shrink-0 ${f.color}`} />
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
            <h2 className="text-[30px] font-black text-foreground mb-4">שלושה צעדים פשוטים</h2>
            <p className="text-[15px] text-foreground-muted">מהרשמה ועד התובנה הראשונה — פחות מ-5 דקות</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map((step, i) => (
              <div key={step.step} className="relative">
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-foreground text-background mb-4">
                    <step.icon className="w-6 h-6" />
                  </div>
                  <div className="text-[10px] font-black text-foreground-muted tracking-[0.2em] mb-2">{step.step}</div>
                  <h3 className="text-[15px] font-bold text-foreground mb-2">{step.title}</h3>
                  <p className="text-[12px] text-foreground-muted leading-relaxed">{step.desc}</p>
                </div>
                {i < HOW_IT_WORKS.length - 1 && (
                  <div className="hidden md:block absolute top-7 left-0 w-full text-center">
                    <ChevronRight className="w-5 h-5 text-border mx-auto" style={{ marginLeft: '-50%' }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="px-6 py-20 bg-secondary/20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-[30px] font-black text-foreground mb-4">מה בעלי עסקים אומרים</h2>
            <p className="text-[15px] text-foreground-muted">תוצאות אמיתיות מעסקים שמשתמשים במערכת</p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className="card-base p-6">
                <div className="flex items-center gap-1 mb-3">
                  {Array.from({ length: t.stars }).map((_, j) => (
                    <Star key={j} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="text-[13px] text-foreground-secondary leading-relaxed mb-4 italic">"{t.text}"</p>
                <div className="border-t border-border pt-3 flex items-center justify-between">
                  <div>
                    <p className="text-[12px] font-semibold text-foreground">{t.author}</p>
                    <p className="text-[10px] text-foreground-muted">{t.role}, {t.city}</p>
                  </div>
                  <span className="text-[10px] font-bold text-success bg-success/10 px-2 py-1 rounded-full border border-success/20">
                    {t.result}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-foreground-muted text-center mt-4">* שמות שונו לצורך פרטיות. תוצאות משתנות בין עסקים.</p>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-[30px] font-black text-foreground mb-4">תמחור פשוט ושקוף</h2>
            <p className="text-[15px] text-foreground-muted">התחל בחינם. שדרג כשאתה צומח.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {PLANS.map(plan => (
              <div key={plan.name} className={`card-base p-6 border-2 relative ${plan.color}`}>
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-background text-[10px] font-bold px-3 py-1 rounded-full">
                    {plan.badge}
                  </div>
                )}
                <h3 className="text-[16px] font-bold text-foreground mb-1">{plan.name}</h3>
                <div className="flex items-baseline gap-1 mb-5">
                  <span className="text-[32px] font-black text-foreground">{plan.price}</span>
                  <span className="text-[12px] text-foreground-muted">{plan.period}</span>
                </div>
                <ul className="space-y-2 mb-6">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-[12px] text-foreground-secondary">
                      <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 text-success" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => base44.auth.redirectToLogin()}
                  className={`w-full py-2.5 rounded-xl text-[13px] font-semibold hover:opacity-90 transition-all ${plan.btn}`}
                >
                  {plan.price === 'חינם' ? 'התחל בחינם' : 'בחר תוכנית'}
                </button>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-foreground-muted text-center mt-6">
            <Clock className="w-3.5 h-3.5 inline ml-1" />
            ניסיון חינם 14 ימים לכל התוכניות · ביטול בכל עת · אין חוזה
          </p>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="px-6 py-24 bg-foreground">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 text-white/80 text-[11px] font-medium mb-6">
            <Zap className="w-3.5 h-3.5" />
            תובנה ראשונה תוך 60 שניות
          </div>
          <h2 className="text-[32px] md:text-[44px] font-black text-background mb-5 leading-tight">
            תפסיק לנחש.<br />
            התחל לדעת.
          </h2>
          <p className="text-[15px] text-background/70 mb-8 leading-relaxed">
            הרשמה חינם. ללא כרטיס אשראי. ללא חוזה.<br />
            עסקים שמשתמשים ב-QuietEyes יודעים מה קורה בשוק — לפני המתחרים.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <button
              onClick={() => base44.auth.redirectToLogin()}
              className="flex items-center gap-2 px-10 py-4 rounded-xl bg-background text-foreground text-[15px] font-bold hover:opacity-90 transition-all shadow-lg"
            >
              התחל עכשיו — בחינם
              <ArrowLeft className="w-5 h-5" />
            </button>
            <Link
              to="/how-it-works"
              className="flex items-center gap-2 px-8 py-4 rounded-xl border border-white/20 text-background/80 text-[14px] font-medium hover:bg-white/10 transition-all"
            >
              ראה הדגמה חיה
            </Link>
          </div>
        </div>
      </section>

    </div>
  );
}
