import React from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, Eye, Shield, TrendingUp, Users } from 'lucide-react';
import DashboardMockup from '@/components/public/DashboardMockup';

const testimonials = [
  { text: 'הפסקתי להפתיע. עכשיו אני יודע על כל שינוי אצל מתחרה לפני כולם.', author: 'בעל מסעדה, תל אביב' },
  { text: 'הביקורת השלילית קיבלה תגובה תוך 5 דקות. הלקוח חזר.', author: 'בעלת מספרה, רמת גן' },
  { text: '3 לידים חמים בשבוע הראשון. אחד מהם סגר עסקה של 8,000₪.', author: 'חנות ספורט, בני ברק' },
];

const features = [
  { icon: Eye, title: 'מודיעין שוק 24/7', desc: '8 סוכני AI סורקים את הרשת בשבילך — מתחרים, ביקורות, מגמות' },
  { icon: Shield, title: 'ניהול מוניטין', desc: 'ביקורות מכל הפלטפורמות + תגובות AI מותאמות בלחיצה' },
  { icon: TrendingUp, title: 'לידים חכמים', desc: 'זיהוי אוטומטי של לקוחות פוטנציאליים עם ניקוד וכוונת קנייה' },
  { icon: Users, title: 'שימור לקוחות', desc: 'זיהוי לקוחות בסיכון, סקרי שביעות רצון, והודעות מותאמות' },
];

export default function PublicHome() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="px-6 pt-20 pb-16 max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h1 className="text-[36px] md:text-[48px] font-bold text-foreground leading-tight mb-5">
              העיניים השקטות<br />של העסק שלך
            </h1>
            <p className="text-[16px] text-foreground-muted leading-relaxed mb-8 max-w-lg">
              מערכת מודיעין עסקי שעובדת 24/7. סורקת מתחרים, מוצאת ביקורות, מייצרת לידים ומנהלת את המוניטין שלך — אוטומטית.
            </p>
            <div className="flex flex-wrap gap-3">
              <button onClick={() => base44.auth.redirectToLogin()} className="px-8 py-3.5 rounded-xl bg-foreground text-background text-[14px] font-semibold hover:opacity-90 transition-all">
                התחל בחינם ←
              </button>
              <Link to="/how-it-works" className="px-8 py-3.5 rounded-xl border border-border text-[14px] font-medium text-foreground-secondary hover:bg-secondary transition-all">
                איך זה עובד?
              </Link>
            </div>
          </div>
          <div className="hidden lg:block">
            <DashboardMockup />
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section className="px-6 py-16 bg-secondary/30">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-[24px] font-bold text-foreground text-center mb-10">כל מה שעסק קטן צריך כדי לנצח</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {features.map(f => (
              <div key={f.title} className="card-base p-6 text-center">
                <f.icon className="w-8 h-8 text-primary mx-auto mb-3" />
                <h3 className="text-[14px] font-semibold text-foreground mb-2">{f.title}</h3>
                <p className="text-[12px] text-foreground-muted leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-[24px] font-bold text-foreground text-center mb-10">מה בעלי עסקים אומרים</h2>
          <div className="grid md:grid-cols-3 gap-5">
            {testimonials.map((t, i) => (
              <div key={i} className="card-base p-6">
                <p className="text-[13px] text-foreground-secondary leading-relaxed mb-4 italic">"{t.text}"</p>
                <p className="text-[11px] font-medium text-foreground-muted">— {t.author}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-foreground-muted text-center mt-4">* שמות שונו לצורך פרטיות. תוצאות משתנות בין עסקים.</p>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-20 bg-foreground">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-[28px] font-bold text-background mb-4">מוכן לדעת מה קורה בשוק שלך?</h2>
          <p className="text-[14px] text-background/70 mb-8">הרשמה חינם. תובנה ראשונה תוך 60 שניות.</p>
          <button onClick={() => base44.auth.redirectToLogin()} className="px-10 py-4 rounded-xl bg-background text-foreground text-[14px] font-semibold hover:opacity-90 transition-all">
            התחל עכשיו — בחינם ←
          </button>
        </div>
      </section>
    </div>
  );
}