import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Crown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import PlanCard from '@/components/subscription/PlanCard';
import InvoiceHistory from '@/components/subscription/InvoiceHistory';
import PaymentMethod from '@/components/subscription/PaymentMethod';

const plans = [
  {
    id: 'free',
    name: 'חינם',
    description: 'לעסקים שרק מתחילים',
    price: '₪0',
    period: 'חודש',
    features: [
      'עד 50 לידים בחודש',
      'סריקת מתחרים בסיסית',
      'דוחות שבועיים',
      'סוכן אחד פעיל',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'לעסקים שרוצים לצמוח',
    price: '₪149',
    period: 'חודש',
    highlighted: true,
    features: [
      'לידים ללא הגבלה',
      'כל 7 הסוכנים פעילים',
      'חיזויים ותובנות AI',
      'בוט WhatsApp אוטומטי',
      'התראות בזמן אמת',
      'דוחות מתקדמים',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'לרשתות וארגונים',
    price: '₪449',
    period: 'חודש',
    features: [
      'הכל ב-Pro',
      'ניהול מרובה סניפים',
      'API מותאם אישית',
      'מנהל הצלחה ייעודי',
      'SLA מובטח 99.9%',
      'אינטגרציות מותאמות',
    ],
  },
];

export default function Subscription() {
  const { businessProfile } = useOutletContext();
  const [checkoutLoading, setCheckoutLoading] = useState(null);

  const { data: subData, isLoading, refetch } = useQuery({
    queryKey: ['subscriptionStatus'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getSubscriptionStatus', {});
      return res.data;
    },
  });

  // Handle success/cancel from Stripe redirect
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

  const currentPlan = subData?.plan || 'free';

  const handlePlanSelect = async (planId) => {
    if (planId === currentPlan || planId === 'free') return;

    // Check if running in iframe
    if (window.self !== window.top) {
      alert('לביצוע תשלום יש לפתוח את האפליקציה בחלון נפרד (לא מתוך iframe)');
      return;
    }

    setCheckoutLoading(planId);
    const res = await base44.functions.invoke('createCheckoutSession', {
      planId,
      returnUrl: window.location.origin + '/subscription',
    });
    setCheckoutLoading(null);
    if (res.data?.url) {
      window.location.href = res.data.url;
    }
  };

  const handleManagePayment = async () => {
    if (window.self !== window.top) {
      alert('ניהול תשלום זמין רק מחלון נפרד (לא iframe)');
      return;
    }
    const res = await base44.functions.invoke('manageSubscription', {
      action: 'portal',
      returnUrl: window.location.origin + '/subscription',
    });
    if (res.data?.url) {
      window.location.href = res.data.url;
    }
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
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-2.5">
        <Crown className="w-5 h-5 text-warning" />
        <h1 className="text-[16px] font-bold text-foreground tracking-tight">ניהול מנוי</h1>
      </div>

      {/* Current plan banner */}
      <div className="card-base p-5 flex flex-wrap items-center justify-between gap-4 fade-in-up">
        <div>
          <p className="text-[11px] text-foreground-muted mb-0.5">התוכנית הנוכחית שלך</p>
          <p className="text-[18px] font-bold text-foreground tracking-tight">
            {plans.find(p => p.id === currentPlan)?.name || 'חינם'}
          </p>
        </div>
        <div className="text-left">
          <p className="text-[11px] text-foreground-muted mb-0.5">חיוב הבא</p>
          <p className="text-[14px] font-semibold text-foreground">{nextBilling}</p>
        </div>
        <div className="text-left">
          <p className="text-[11px] text-foreground-muted mb-0.5">סכום</p>
          <p className="text-[14px] font-semibold text-foreground">
            {plans.find(p => p.id === currentPlan)?.price || '₪0'}
          </p>
        </div>
      </div>

      {/* Plans */}
      <div>
        <h2 className="text-[14px] font-semibold text-foreground mb-3">תוכניות</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan, i) => (
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

      {/* Payment + Invoices */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PaymentMethod
          paymentMethod={subData?.paymentMethod}
          hasSubscription={currentPlan !== 'free'}
          onManage={handleManagePayment}
        />
        <InvoiceHistory invoices={subData?.invoices || []} />
      </div>
    </div>
  );
}