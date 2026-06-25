import React from 'react';
import { base44 } from '@/api/base44Client';
import { Check } from 'lucide-react';

const G = 'linear-gradient(135deg, #7B2FBE 0%, #E8344D 55%, #FF8C00 100%)';
const glassCard = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)' };

const plans = [
  {
    name: 'חינם',
    price: '₪0',
    period: '/חודש',
    desc: 'להתחלה',
    features: ['עד 3 מתחרים', 'ביקורות מגוגל', 'תדריך בוקר', '5 לידים בחודש'],
    cta: 'התחל בחינם',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '₪149',
    period: '/חודש',
    desc: 'לעסקים פעילים',
    features: ['מתחרים ללא הגבלה', 'כל הפלטפורמות', 'לידים ללא הגבלה', 'Pipeline CRM', 'תגובות AI', 'דוחות שבועיים'],
    cta: 'נסה חינם 14 יום',
    highlight: true,
  },
  {
    name: 'Enterprise',
    price: 'בהתאמה',
    period: '',
    desc: 'רשתות ומותגים',
    features: ['ריבוי סניפים', 'API מותאם', 'מנהל חשבון ייעודי', 'SLA מותאם'],
    cta: 'צור קשר',
    highlight: false,
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen px-6 py-20" style={{ background: '#0A0A0F' }}>
      <div className="max-w-5xl mx-auto text-center">
        <h1 className="text-[32px] md:text-[40px] font-bold text-white mb-4">מחירים שהגיוניים לעסק שלך</h1>
        <p className="text-[15px] mb-12" style={{ color: '#9090A8' }}>בלי הפתעות. בלי התחייבות.</p>
        <div className="grid md:grid-cols-3 gap-6">
          {plans.map(plan => (
            plan.highlight ? (
              <div key={plan.name} style={{ background: G, padding: '1px', borderRadius: '16px' }}>
                <div className="p-8 text-right h-full relative" style={{ background: '#13131A', borderRadius: '15px' }}>
                  <span className="text-[10px] font-bold text-white px-2 py-0.5 rounded-full mb-3 inline-block" style={{ background: G }}>
                    הכי פופולרי
                  </span>
                  <h3 className="text-[20px] font-bold text-white">{plan.name}</h3>
                  <p className="text-[12px] mb-3" style={{ color: '#9090A8' }}>{plan.desc}</p>
                  <div className="mb-5">
                    <span className="text-[36px] font-bold text-white">{plan.price}</span>
                    <span className="text-[13px]" style={{ color: '#9090A8' }}>{plan.period}</span>
                  </div>
                  <ul className="space-y-2 mb-6">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-center gap-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                        <Check className="w-4 h-4 flex-shrink-0" style={{ color: '#E8344D' }} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => base44.auth.redirectToLogin()}
                    className="w-full py-3 rounded-lg text-[13px] font-semibold text-white hover:opacity-90 transition-all"
                    style={{ background: G }}
                  >
                    {plan.cta}
                  </button>
                </div>
              </div>
            ) : (
              <div key={plan.name} className="p-8 text-right rounded-2xl" style={glassCard}>
                <h3 className="text-[20px] font-bold text-white">{plan.name}</h3>
                <p className="text-[12px] mb-3" style={{ color: '#9090A8' }}>{plan.desc}</p>
                <div className="mb-5">
                  <span className="text-[36px] font-bold text-white">{plan.price}</span>
                  <span className="text-[13px]" style={{ color: '#9090A8' }}>{plan.period}</span>
                </div>
                <ul className="space-y-2 mb-6">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                      <Check className="w-4 h-4 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }} />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => base44.auth.redirectToLogin()}
                  className="w-full py-3 rounded-lg text-[13px] font-semibold hover:opacity-80 transition-all"
                  style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.12)' }}
                >
                  {plan.cta}
                </button>
              </div>
            )
          ))}
        </div>
      </div>
    </div>
  );
}
