import React from 'react';
import { base44 } from '@/api/base44Client';
import { Check } from 'lucide-react';

const plans = [
  { name: 'חינם', price: '₪0', period: '/חודש', desc: 'להתחלה', features: ['עד 3 מתחרים', 'ביקורות מגוגל', 'תדריך בוקר', '5 לידים בחודש'], cta: 'התחל בחינם' },
  { name: 'Pro', price: '₪149', period: '/חודש', desc: 'לעסקים פעילים', features: ['מתחרים ללא הגבלה', 'כל הפלטפורמות', 'לידים ללא הגבלה', 'Pipeline CRM', 'תגובות AI', 'דוחות שבועיים'], highlight: true, cta: 'נסה חינם 14 יום' },
  { name: 'Enterprise', price: 'בהתאמה', period: '', desc: 'רשתות ומותגים', features: ['ריבוי סניפים', 'API מותאם', 'מנהל חשבון ייעודי', 'SLA מותאם'], cta: 'צור קשר' },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen px-6 py-20">
      <div className="max-w-5xl mx-auto text-center">
        <h1 className="text-[32px] md:text-[40px] font-bold text-foreground mb-4">מחירים שהגיוניים לעסק שלך</h1>
        <p className="text-[15px] text-foreground-muted mb-12">בלי הפתעות. בלי התחייבות.</p>
        <div className="grid md:grid-cols-3 gap-6">
          {plans.map(plan => (
            <div key={plan.name} className={`card-base p-8 text-right ${plan.highlight ? 'border-2 border-primary ring-4 ring-primary/10' : ''}`}>
              {plan.highlight && <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full mb-3 inline-block">הכי פופולרי</span>}
              <h3 className="text-[20px] font-bold text-foreground">{plan.name}</h3>
              <p className="text-[12px] text-foreground-muted mb-3">{plan.desc}</p>
              <div className="mb-5"><span className="text-[36px] font-bold text-foreground">{plan.price}</span><span className="text-[13px] text-foreground-muted">{plan.period}</span></div>
              <ul className="space-y-2 mb-6">
                {plan.features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-[12px] text-foreground-secondary"><Check className="w-4 h-4 text-success flex-shrink-0" />{f}</li>
                ))}
              </ul>
              <button onClick={() => base44.auth.redirectToLogin()} className={`w-full py-3 rounded-lg text-[13px] font-semibold transition-all ${plan.highlight ? 'bg-foreground text-background hover:opacity-90' : 'bg-secondary text-foreground hover:bg-secondary/80'}`}>{plan.cta}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}