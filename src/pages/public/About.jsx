import React from 'react';
import { base44 } from '@/api/base44Client';
import { Eye, Target, Zap, Heart } from 'lucide-react';

const G = 'linear-gradient(135deg, #7B2FBE 0%, #E8344D 55%, #FF8C00 100%)';
const glassCard = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)' };
const gradientText = { background: G, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' };

const values = [
  {
    icon: Eye,
    title: 'שקיפות מלאה',
    desc: 'כל תובנה מגיעה עם מקור. Cortexi לא מסתירה מאיפה המידע — אתה תמיד יכול לאמת.',
  },
  {
    icon: Target,
    title: 'רלוונטיות קודמת לכמות',
    desc: 'לא מציפים אותך בנתונים. Cortexi מסננת את הרעש ומביאה רק את מה שמשנה לעסק שלך.',
  },
  {
    icon: Zap,
    title: 'מהירות לפעולה',
    desc: 'תובנה בלי פעולה היא רק מידע. כל תובנה ב-Cortexi מגיעה עם הצעת הפעולה הבאה.',
  },
  {
    icon: Heart,
    title: 'בנוי לעסקים קטנים',
    desc: 'לא הכלי שפותח לחברות Fortune 500 ואז הותאם לעסקים קטנים — בנוי מהיום הראשון עבורם.',
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen" style={{ background: '#0A0A0F' }}>
      {/* Hero */}
      <section className="px-6 pt-20 pb-16 max-w-4xl mx-auto">
        <h1 className="text-[36px] md:text-[44px] font-bold text-white leading-tight mb-5">
          למה בנינו את <span style={gradientText}>Cortexi</span> — ולמי
        </h1>
        <p className="text-[16px] leading-relaxed max-w-2xl" style={{ color: '#9090A8' }}>
          בעלי עסקים קטנים בישראל עובדים קשה. הם מנהלים הכל לבד — שיווק, מכירות, שירות לקוחות, ותפעול. אבל דבר אחד תמיד נשאר בצד: <strong className="text-white">לדעת מה קורה בשוק</strong>.
        </p>
      </section>

      {/* Story */}
      <section className="px-6 py-12" style={{ background: 'rgba(255,255,255,0.02)' }}>
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-10 items-start">
            <div className="space-y-4 text-[14px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.7)' }}>
              <p>
                מתחרים פותחים סניפים, ביקורות שליליות נשארות בלי מענה, לקוחות פוטנציאליים מחפשים ברשת ולא מוצאים אותך. וכשאתה מגלה — כבר מאוחר מדי.
              </p>
              <p>
                Cortexi נבנתה כדי לפתור את זה. <strong className="text-white">8 סוכני AI</strong> שעובדים 24/7, סורקים את הרשת, ומביאים לך רק מה שחשוב — בזמן אמת.
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
                <div key={stat.label} className="p-5 rounded-xl flex items-center gap-4" style={glassCard}>
                  <span className="text-[28px] font-bold text-white tracking-tight">{stat.num}</span>
                  <span className="text-[13px]" style={{ color: '#9090A8' }}>{stat.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-[24px] font-bold text-white mb-10 text-center">מה מנחה אותנו</h2>
          <div className="grid sm:grid-cols-2 gap-5">
            {values.map((v) => (
              <div key={v.title} className="p-6 rounded-xl" style={glassCard}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3" style={{ background: G }}>
                  <v.icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-[15px] font-semibold text-white mb-2">{v.title}</h3>
                <p className="text-[12px] leading-relaxed" style={{ color: '#9090A8' }}>{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-16" style={{ background: G }}>
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-[24px] font-bold text-white mb-3">מוכן לנסות?</h2>
          <p className="text-[14px] text-white/80 mb-7">הרשמה חינם. תובנה ראשונה תוך 60 שניות.</p>
          <button
            onClick={() => base44.auth.redirectToLogin()}
            className="px-10 py-4 rounded-xl text-[14px] font-semibold hover:opacity-90 transition-all"
            style={{ background: '#0A0A0F', color: '#ffffff' }}
          >
            התחל עכשיו — בחינם ←
          </button>
        </div>
      </section>
    </div>
  );
}
