import React from 'react';
import { base44 } from '@/api/base44Client';
import { Eye, Target, Zap, Heart } from 'lucide-react';

const values = [
  {
    icon: Eye,
    title: 'שקיפות מלאה',
    desc: 'כל תובנה מגיעה עם מקור. אנחנו לא מסתירים מאיפה המידע — אתה תמיד יכול לאמת.',
  },
  {
    icon: Target,
    title: 'רלוונטיות קודמת לכמות',
    desc: 'לא מציפים אותך בנתונים. המערכת מסננת את הרעש ומביאה רק את מה שמשנה לעסק שלך.',
  },
  {
    icon: Zap,
    title: 'מהירות לפעולה',
    desc: 'תובנה בלי פעולה היא רק מידע. כל תובנה ב-OTX מגיעה עם הצעת הפעולה הבאה.',
  },
  {
    icon: Heart,
    title: 'בנוי לעסקים קטנים',
    desc: 'לא הכלי שפותח לחברות Fortune 500 ואז הותאם לעסקים קטנים — בנוי מהיום הראשון עבורם.',
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="px-6 pt-20 pb-16 max-w-4xl mx-auto">
        <h1 className="text-[36px] md:text-[44px] font-bold text-foreground leading-tight mb-5">
          למה בנינו את OTX — ולמי
        </h1>
        <p className="text-[16px] text-foreground-muted leading-relaxed max-w-2xl">
          בעלי עסקים קטנים בישראל עובדים קשה. הם מנהלים הכל לבד — שיווק, מכירות, שירות לקוחות, ותפעול. אבל דבר אחד תמיד נשאר בצד: <strong className="text-foreground">לדעת מה קורה בשוק</strong>.
        </p>
      </section>

      {/* Story */}
      <section className="px-6 py-12 bg-secondary/30">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-10 items-start">
            <div className="space-y-4 text-[14px] text-foreground-secondary leading-relaxed">
              <p>
                מתחרים פותחים סניפים, ביקורות שליליות נשארות בלי מענה, לקוחות פוטנציאליים מחפשים ברשת ולא מוצאים אותך. וכשאתה מגלה — כבר מאוחר מדי.
              </p>
              <p>
                OTX נבנה כדי לפתור את זה. <strong>8 סוכני AI</strong> שעובדים 24/7, סורקים את הרשת, ומביאים לך רק מה שחשוב — בזמן אמת.
              </p>
              <p>
                אנחנו מאמינים שעסק קטן יכול לנצח עסקים גדולים — אם יש לו את המידע הנכון בזמן הנכון.
              </p>
            </div>
            <div className="space-y-3">
              {[
                { num: '500+', label: 'עסקים פעילים' },
                { num: '8', label: 'סוכני AI עובדים 24/7' },
                { num: '60 שניות', label: 'לתובנה הראשונה' },
                { num: '98%', label: 'שביעות רצון לקוחות' },
              ].map((stat) => (
                <div key={stat.label} className="card-base p-5 flex items-center gap-4">
                  <span className="text-[28px] font-bold text-foreground tracking-tight">{stat.num}</span>
                  <span className="text-[13px] text-foreground-muted">{stat.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-[24px] font-bold text-foreground mb-10 text-center">מה מנחה אותנו</h2>
          <div className="grid sm:grid-cols-2 gap-5">
            {values.map((v) => (
              <div key={v.title} className="card-base p-6">
                <v.icon className="w-7 h-7 text-primary mb-3" />
                <h3 className="text-[15px] font-semibold text-foreground mb-2">{v.title}</h3>
                <p className="text-[12px] text-foreground-muted leading-relaxed">{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-16 bg-foreground">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-[24px] font-bold text-background mb-3">מוכן לנסות?</h2>
          <p className="text-[14px] text-background/70 mb-7">הרשמה חינם. תובנה ראשונה תוך 60 שניות.</p>
          <button
            onClick={() => base44.auth.redirectToLogin()}
            className="px-10 py-4 rounded-xl bg-background text-foreground text-[14px] font-semibold hover:opacity-90 transition-all"
          >
            התחל עכשיו — בחינם ←
          </button>
        </div>
      </section>
    </div>
  );
}
