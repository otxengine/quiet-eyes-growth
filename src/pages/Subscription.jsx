import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Crown, Loader2, Check, X, Zap } from 'lucide-react';
import { toast } from 'sonner';
import InvoiceHistory from '@/components/subscription/InvoiceHistory';
import PaymentMethod from '@/components/subscription/PaymentMethod';
import { cn } from '@/lib/utils';

const PLANS = [
  {
    id: 'free_trial',
    name: 'Free Trial',
    subtitle: '7 ימים בחינם',
    price: null,
    priceLabel: 'חינם',
    period: '7 ימים',
    color: '4CAF50',
    features: [
      { label: 'Dashboard + Morning Briefing', included: true },
      { label: 'צפייה בביקורות ומוניטין', included: true },
      { label: 'עד 5 משימות', included: true },
      { label: 'סריקה מלאה אחת', included: true },
      { label: 'עד 5 תובנות שוק', included: true },
      { label: 'עד 3 מתחרים (צפייה)', included: true },
      { label: 'פוסט AI אחד לדוגמה', included: true },
      { label: 'לידים חברתיים', included: false },
      { label: 'ניתוח מגמות ו-Viral', included: false },
      { label: 'דוח שבועי', included: false },
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    subtitle: 'לעסקים שמתחילים',
    price: 149,
    priceLabel: '₪149',
    period: 'חודש',
    color: '2196F3',
    features: [
      { label: 'Dashboard + Morning Briefing', included: true },
      { label: 'ביקורות ומוניטין מלא', included: true },
      { label: 'עד 20 משימות', included: true },
      { label: '4 סריקות מלאות לחודש', included: true },
      { label: 'עד 15 תובנות שוק', included: true },
      { label: 'עד 5 מתחרים (צפייה)', included: true },
      { label: '5 פוסטים AI לחודש', included: true },
      { label: 'לידים חברתיים', included: false },
      { label: 'ניתוח מגמות ו-Viral', included: false },
      { label: 'דוח שבועי', included: false },
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    subtitle: 'לעסקים בצמיחה',
    price: 349,
    priceLabel: '₪349',
    period: 'חודש',
    highlighted: true,
    color: '9C27B0',
    features: [
      { label: 'Dashboard + Morning Briefing', included: true },
      { label: 'ביקורות ומוניטין מלא', included: true },
      { label: 'משימות ללא הגבלה', included: true },
      { label: '30 סריקות מלאות לחודש', included: true },
      { label: 'תובנות שוק ללא הגבלה', included: true },
      { label: 'עד 10 מתחרים + Battlecard', included: true },
      { label: '30 פוסטים AI + 10 תמונות', included: true },
      { label: 'לידים חברתיים', included: true },
      { label: 'ניתוח מגמות ו-Viral Signals', included: true },
      { label: 'דוח שבועי + מרכז למידה', included: true },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    subtitle: 'לעסקים מתקדמים',
    price: 699,
    priceLabel: '₪699',
    period: 'חודש',
    color: 'FF5722',
    features: [
      { label: 'כל מה שב-Growth', included: true },
      { label: 'סריקות ללא הגבלה', included: true },
      { label: 'מתחרים ללא הגבלה', included: true },
      { label: 'תמונות AI ללא הגבלה', included: true },
      { label: 'אינטגרציות FB/IG/Apify', included: true },
      { label: 'מקורות מידע מותאמים', included: true },
      { label: 'תמיכה Priority 4h', included: true },
      { label: 'Onboarding אישי', included: true },
      { label: 'SLA 99.5%', included: false },
      { label: 'Account Manager', included: false },
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    subtitle: 'לרשתות וארגונים',
    price: null,
    priceLabel: '₪1,499+',
    period: 'חודש',
    color: 'F4A800',
    features: [
      { label: 'כל מה שב-Pro', included: true },
      { label: 'מנהל הצלחה ייעודי', included: true },
      { label: 'SLA 99.5% מובטח', included: true },
      { label: 'Onboarding מלא + הדרכה', included: true },
      { label: 'חשבונית/העברה בנקאית', included: true },
      { label: 'הגדרות מותאמות אישית', included: true },
      { label: 'ניהול מרובה סניפים', included: true },
      { label: 'API גישה מלאה', included: true },
      { label: 'דוחות מותאמים', included: true },
      { label: 'תמיכה 24/7', included: true },
    ],
  },
];

const PLAN_ID_MAP = {
  free: 'free_trial',
  free_trial: 'free_trial',
  starter: 'starter',
  growth: 'growth',
  pro: 'pro',
  enterprise: 'enterprise',
};

function PlanCard({ plan, isCurrentPlan, onSelect, loading }) {
  const accentColor = `#${plan.color}`;
  return (
    <div className={cn(
      'card-base p-5 flex flex-col relative transition-all duration-200',
      isCurrentPlan && 'ring-2',
      plan.highlighted && !isCurrentPlan && 'border-border-hover shadow-md',
    )}
    style={isCurrentPlan ? { ringColor: accentColor, borderColor: accentColor } : {}}
    >
      {plan.highlighted && (
        <span
          className="absolute -top-3 right-4 px-3 py-0.5 rounded-full text-white text-[10px] font-bold"
          style={{ background: accentColor }}
        >
          הכי פופולרי
        </span>
      )}
      {isCurrentPlan && (
        <span
          className="absolute -top-3 left-4 px-3 py-0.5 rounded-full text-white text-[10px] font-bold"
          style={{ background: accentColor }}
        >
          התוכנית שלך
        </span>
      )}

      {/* Header */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: accentColor }} />
          <h3 className="text-[14px] font-bold text-foreground">{plan.name}</h3>
        </div>
        <p className="text-[11px] text-foreground-muted">{plan.subtitle}</p>
      </div>

      {/* Price */}
      <div className="flex items-baseline gap-1 mb-4">
        <span className="text-[28px] font-bold text-foreground tracking-tight">{plan.priceLabel}</span>
        {plan.period && <span className="text-[11px] text-foreground-muted">/{plan.period}</span>}
      </div>

      {/* Features */}
      <ul className="space-y-2 mb-5 flex-1">
        {plan.features.map((f, i) => (
          <li key={i} className="flex items-center gap-2 text-[11px]">
            {f.included
              ? <Check className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accentColor }} />
              : <X className="w-3.5 h-3.5 flex-shrink-0 text-foreground-muted opacity-40" />
            }
            <span className={f.included ? 'text-foreground-secondary' : 'text-foreground-muted opacity-50'}>
              {f.label}
            </span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <button
        onClick={() => onSelect(plan.id)}
        disabled={isCurrentPlan || loading || plan.id === 'free_trial'}
        className={cn(
          'w-full py-2.5 rounded-lg text-[12px] font-semibold transition-all flex items-center justify-center gap-2',
          isCurrentPlan
            ? 'bg-secondary text-foreground-muted cursor-default'
            : plan.id === 'free_trial'
              ? 'bg-secondary text-foreground-muted cursor-default'
              : 'text-white hover:opacity-90 shadow-sm',
        )}
        style={!isCurrentPlan && plan.id !== 'free_trial' ? { background: accentColor } : {}}
      >
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {isCurrentPlan ? 'התוכנית הנוכחית' : plan.id === 'free_trial' ? 'תקופת ניסיון' : plan.id === 'enterprise' ? 'צור קשר' : 'שדרג עכשיו'}
      </button>
    </div>
  );
}

export default function Subscription() {
  const { businessProfile } = useOutletContext();
  const [checkoutLoading, setCheckoutLoading] = useState(null);

  const { data: subData, isLoading, refetch } = useQuery({
    queryKey: ['subscriptionStatus'],
    queryFn: async () => {
      try {
        const res = await base44.functions.invoke('getSubscriptionStatus', {});
        return res.data;
      } catch { return null; }
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === 'true') {
      toast.success('התשלום בוצע בהצלחה! המנוי עודכן ✓');
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => refetch(), 2000);
    } else if (params.get('canceled') === 'true') {
      toast.info('התשלום בוטל');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const rawPlan = subData?.plan || 'free_trial';
  const currentPlan = PLAN_ID_MAP[rawPlan] || 'free_trial';
  const currentPlanData = PLANS.find(p => p.id === currentPlan);

  const handlePlanSelect = async (planId) => {
    if (planId === currentPlan || planId === 'free_trial') return;
    if (planId === 'enterprise') {
      window.location.href = 'mailto:contact@otxengine.io?subject=Enterprise Plan';
      return;
    }
    if (window.self !== window.top) {
      alert('לביצוע תשלום יש לפתוח את האפליקציה בחלון נפרד');
      return;
    }
    setCheckoutLoading(planId);
    try {
      const res = await base44.functions.invoke('createCheckoutSession', {
        planId,
        returnUrl: window.location.origin + '/subscription',
      });
      if (res.data?.url) window.location.href = res.data.url;
    } catch {
      toast.error('שגיאה ביצירת הזמנה — נסה שוב');
    }
    setCheckoutLoading(null);
  };

  const handleManagePayment = async () => {
    if (window.self !== window.top) { alert('ניהול תשלום זמין רק מחלון נפרד'); return; }
    try {
      const res = await base44.functions.invoke('manageSubscription', {
        action: 'portal',
        returnUrl: window.location.origin + '/subscription',
      });
      if (res.data?.url) window.location.href = res.data.url;
    } catch { toast.error('שגיאה — נסה שוב'); }
  };

  const nextBilling = subData?.currentPeriodEnd
    ? new Date(subData.currentPeriodEnd).toLocaleDateString('he-IL')
    : '—';

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl" dir="rtl">
      <div className="flex items-center gap-2.5">
        <Crown className="w-5 h-5 text-warning" />
        <h1 className="text-[16px] font-bold text-foreground tracking-tight">ניהול מנוי</h1>
      </div>

      {/* Current Plan Banner */}
      <div
        className="card-base p-5 flex flex-wrap items-center justify-between gap-4 fade-in-up border-r-4"
        style={{ borderRightColor: `#${currentPlanData?.color || '4CAF50'}` }}
      >
        <div>
          <p className="text-[11px] text-foreground-muted mb-0.5">התוכנית הנוכחית שלך</p>
          <div className="flex items-center gap-2">
            <p className="text-[18px] font-bold text-foreground tracking-tight">
              {currentPlanData?.name || 'Free Trial'}
            </p>
            <Zap className="w-4 h-4" style={{ color: `#${currentPlanData?.color}` }} />
          </div>
          <p className="text-[11px] text-foreground-muted">{currentPlanData?.subtitle}</p>
        </div>
        <div className="text-left">
          <p className="text-[11px] text-foreground-muted mb-0.5">חיוב הבא</p>
          <p className="text-[14px] font-semibold text-foreground">{nextBilling}</p>
        </div>
        <div className="text-left">
          <p className="text-[11px] text-foreground-muted mb-0.5">סכום חודשי</p>
          <p className="text-[14px] font-semibold text-foreground">
            {currentPlanData?.priceLabel || 'חינם'}
            {currentPlanData?.period ? ` / ${currentPlanData.period}` : ''}
          </p>
        </div>
      </div>

      {/* Plans Grid */}
      <div>
        <h2 className="text-[14px] font-semibold text-foreground mb-3">בחר תוכנית</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {PLANS.map((plan, i) => (
            <div key={plan.id} className={`fade-in-up stagger-${i + 1}`}>
              <PlanCard
                plan={plan}
                isCurrentPlan={plan.id === currentPlan}
                onSelect={handlePlanSelect}
                loading={checkoutLoading === plan.id}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Permissions comparison note */}
      <div className="card-base p-4 bg-secondary/30">
        <p className="text-[12px] font-semibold text-foreground mb-2">השוואת הרשאות בין תוכניות</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px] text-foreground-muted">
          <div><span className="font-medium text-blue-600">Starter</span> — 4 סריקות/חודש, 15 תובנות, 5 פוסטים</div>
          <div><span className="font-medium text-purple-600">Growth</span> — 30 סריקות, מגמות, לידים, דוח שבועי</div>
          <div><span className="font-medium text-orange-600">Pro</span> — סריקות ללא הגבלה, אינטגרציות, תמיכה 4h</div>
          <div><span className="font-medium text-yellow-600">Enterprise</span> — Account Manager, SLA, חשבונית</div>
        </div>
      </div>

      {/* Payment + Invoices */}
      {currentPlan !== 'free_trial' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PaymentMethod
            paymentMethod={subData?.paymentMethod}
            hasSubscription={true}
            onManage={handleManagePayment}
          />
          <InvoiceHistory invoices={subData?.invoices || []} />
        </div>
      )}
    </div>
  );
}
