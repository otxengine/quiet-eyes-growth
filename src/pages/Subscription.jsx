/**
 * Subscription — per-branch billing management.
 * Pricing: plan_price × branch_count / month.
 */

import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/contexts/OrganizationContext';
import { stripeApi } from '@/api/stripeApi';
import { toast } from 'sonner';
import {
  Crown, Loader2, Check, X, Zap, GitBranch, CreditCard,
  FileText, ExternalLink, AlertTriangle, Building2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Plan definitions ──────────────────────────────────────────────────────────

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    subtitle: 'לעסקים שמתחילים',
    pricePerBranch: 149,
    color: '2196F3',
    features: [
      { label: 'Dashboard + Morning Briefing', included: true },
      { label: 'ביקורות ומוניטין מלא', included: true },
      { label: 'עד 20 משימות', included: true },
      { label: '4 סריקות מלאות לחודש', included: true },
      { label: 'עד 15 תובנות שוק', included: true },
      { label: 'עד 5 מתחרים', included: true },
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
    pricePerBranch: 349,
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
    pricePerBranch: 699,
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
];

const STATUS_LABELS = {
  active:      { label: 'פעיל',        color: 'text-emerald-600' },
  past_due:    { label: 'תשלום באיחור', color: 'text-amber-600' },
  cancelled:   { label: 'בוטל',         color: 'text-red-500' },
  trialing:    { label: 'תקופת ניסיון', color: 'text-blue-600' },
  none:        { label: 'ללא מנוי',    color: 'text-foreground-muted' },
  free_trial:  { label: 'ניסיון חינם', color: 'text-blue-600' },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function PlanCard({ plan, isCurrentPlan, branchCount, onSelect, loading }) {
  const accentColor = `#${plan.color}`;
  const totalMonthly = plan.pricePerBranch * branchCount;
  const showBranchBreakdown = branchCount > 1;

  return (
    <div className={cn(
      'card-base p-5 flex flex-col relative transition-all duration-200',
      isCurrentPlan ? 'ring-2' : '',
      plan.highlighted && !isCurrentPlan ? 'border-border-hover shadow-md' : '',
    )}
    style={isCurrentPlan ? { borderColor: accentColor, outlineColor: accentColor } : {}}
    >
      {plan.highlighted && (
        <span className="absolute -top-3 right-4 px-3 py-0.5 rounded-full text-white text-[10px] font-bold" style={{ background: accentColor }}>
          הכי פופולרי
        </span>
      )}
      {isCurrentPlan && (
        <span className="absolute -top-3 left-4 px-3 py-0.5 rounded-full text-white text-[10px] font-bold" style={{ background: accentColor }}>
          התוכנית שלך
        </span>
      )}

      <div className="mb-3">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: accentColor }} />
          <h3 className="text-[14px] font-bold text-foreground">{plan.name}</h3>
        </div>
        <p className="text-[11px] text-foreground-muted">{plan.subtitle}</p>
      </div>

      {/* Price */}
      <div className="mb-3">
        <div className="flex items-baseline gap-1">
          <span className="text-[26px] font-bold text-foreground tracking-tight">
            ₪{plan.pricePerBranch.toLocaleString()}
          </span>
          <span className="text-[11px] text-foreground-muted">/סניף/חודש</span>
        </div>
        {showBranchBreakdown && (
          <div className="mt-1 px-2 py-1 bg-secondary rounded-lg">
            <p className="text-[11px] text-foreground-muted">
              {branchCount} סניפים × ₪{plan.pricePerBranch.toLocaleString()} =
              <span className="font-bold text-foreground mr-1">₪{totalMonthly.toLocaleString()}/חודש</span>
            </p>
          </div>
        )}
      </div>

      {/* Features */}
      <ul className="space-y-1.5 mb-5 flex-1">
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

      <button
        onClick={() => onSelect(plan.id)}
        disabled={isCurrentPlan || loading}
        className={cn(
          'w-full py-2.5 rounded-lg text-[12px] font-semibold transition-all flex items-center justify-center gap-2',
          isCurrentPlan
            ? 'bg-secondary text-foreground-muted cursor-default'
            : 'text-white hover:opacity-90 shadow-sm',
        )}
        style={!isCurrentPlan ? { background: accentColor } : {}}
      >
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {isCurrentPlan ? 'התוכנית הנוכחית' : 'בחר תוכנית'}
      </button>
    </div>
  );
}

function InvoiceRow({ inv }) {
  const date = new Date(inv.date * 1000).toLocaleDateString('he-IL');
  return (
    <div className="flex items-center justify-between py-2.5 px-4 hover:bg-secondary/50 transition-colors">
      <div className="flex items-center gap-2">
        <FileText className="w-3.5 h-3.5 text-foreground-muted" />
        <span className="text-[12px] text-foreground">{date}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-medium text-foreground">
          ₪{(inv.amount / 100).toLocaleString()}
        </span>
        <span className={cn(
          'text-[10px] px-2 py-0.5 rounded-full font-medium',
          inv.status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700',
        )}>
          {inv.status === 'paid' ? 'שולם' : inv.status}
        </span>
        {inv.url && (
          <a href={inv.url} target="_blank" rel="noopener noreferrer" className="p-1 hover:text-primary text-foreground-muted">
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Subscription() {
  const { currentOrg, allBranches, isLoading: orgLoading } = useOrganization();
  const [checkoutLoading, setCheckoutLoading] = useState(null);
  const [portalLoading, setPortalLoading] = useState(false);

  const orgId = currentOrg?.id;
  const branchCount = Math.max(1, allBranches.length || currentOrg?.branch_count || 1);

  const { data: subData, isLoading, refetch } = useQuery({
    queryKey: ['stripeStatus', orgId],
    queryFn: () => stripeApi.getStatus(orgId),
    enabled: !!orgId,
    staleTime: 30_000,
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

  const currentPlanId = subData?.plan || currentOrg?.plan_id || 'free_trial';
  const subStatus     = subData?.status || 'none';
  const statusInfo    = STATUS_LABELS[subStatus] || STATUS_LABELS.none;
  const currentPlan   = PLANS.find(p => p.id === currentPlanId);
  const totalMonthly  = currentPlan ? currentPlan.pricePerBranch * branchCount : 0;

  const nextBilling = subData?.currentPeriodEnd
    ? new Date(subData.currentPeriodEnd * 1000).toLocaleDateString('he-IL')
    : '—';

  const handlePlanSelect = async (planId) => {
    if (planId === currentPlanId && subStatus === 'active') return;
    if (window.self !== window.top) {
      alert('לביצוע תשלום יש לפתוח את האפליקציה בחלון נפרד');
      return;
    }
    setCheckoutLoading(planId);
    try {
      const result = await stripeApi.checkout(planId, orgId, window.location.origin + '/subscription');
      if (result.url) window.location.href = result.url;
      else toast.error(result.error || 'שגיאה ביצירת הזמנה');
    } catch (e) {
      toast.error(e.message || 'שגיאה — נסה שוב');
    }
    setCheckoutLoading(null);
  };

  const handlePortal = async () => {
    if (window.self !== window.top) { alert('ניהול תשלום זמין רק מחלון נפרד'); return; }
    setPortalLoading(true);
    try {
      const result = await stripeApi.portal(orgId, window.location.origin + '/subscription');
      if (result.url) window.location.href = result.url;
    } catch (e) {
      toast.error(e.message || 'שגיאה — נסה שוב');
    }
    setPortalLoading(false);
  };

  if (isLoading || orgLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <Crown className="w-5 h-5 text-warning" />
        <h1 className="text-[16px] font-bold text-foreground tracking-tight">ניהול מנוי</h1>
      </div>

      {/* Past-due warning */}
      {subStatus === 'past_due' && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-right">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-amber-800">תשלום נכשל</p>
            <p className="text-[12px] text-amber-700">נא לעדכן פרטי תשלום כדי למנוע הפסקת שירות</p>
          </div>
          <button onClick={handlePortal} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-[12px] font-semibold hover:bg-amber-700">
            עדכן תשלום
          </button>
        </div>
      )}

      {/* Current Plan Banner */}
      <div className={cn(
        'card-base p-5 flex flex-wrap items-center justify-between gap-4 border-r-4',
        currentPlan ? '' : 'border-r-gray-300',
      )}
      style={currentPlan ? { borderRightColor: `#${currentPlan.color}` } : {}}
      >
        <div>
          <p className="text-[11px] text-foreground-muted mb-0.5">התוכנית הנוכחית</p>
          <div className="flex items-center gap-2">
            <p className="text-[18px] font-bold text-foreground">
              {currentPlan?.name || 'ניסיון חינם'}
            </p>
            {currentPlan && <Zap className="w-4 h-4" style={{ color: `#${currentPlan.color}` }} />}
            <span className={cn('text-[11px] font-medium', statusInfo.color)}>
              {statusInfo.label}
            </span>
          </div>
        </div>

        {/* Branch count */}
        <div className="flex items-center gap-2 px-4 py-3 bg-secondary rounded-xl">
          <GitBranch className="w-4 h-4 text-primary" />
          <div>
            <p className="text-[11px] text-foreground-muted">סניפים פעילים</p>
            <p className="text-[18px] font-bold text-foreground">{branchCount}</p>
          </div>
        </div>

        {/* Monthly total */}
        {currentPlan && (
          <div className="text-right">
            <p className="text-[11px] text-foreground-muted">חיוב חודשי</p>
            <p className="text-[20px] font-bold text-foreground">₪{totalMonthly.toLocaleString()}</p>
            <p className="text-[10px] text-foreground-muted">
              {branchCount} × ₪{currentPlan.pricePerBranch.toLocaleString()}
            </p>
          </div>
        )}

        <div className="text-right">
          <p className="text-[11px] text-foreground-muted">חיוב הבא</p>
          <p className="text-[14px] font-semibold text-foreground">{nextBilling}</p>
        </div>

        {subData?.stripeSubscriptionId && (
          <button
            onClick={handlePortal}
            disabled={portalLoading}
            className="flex items-center gap-2 px-4 py-2 bg-secondary border border-border rounded-lg text-[12px] font-medium hover:bg-secondary/80 transition-colors"
          >
            {portalLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />}
            ניהול תשלום
          </button>
        )}
      </div>

      {/* How branch pricing works */}
      <div className="card-base p-4 bg-primary/5 border-primary/20">
        <div className="flex items-start gap-3">
          <Building2 className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] font-semibold text-foreground mb-1">תמחור לפי סניפים</p>
            <p className="text-[12px] text-foreground-muted">
              המחיר מחושב לפי מספר הסניפים הפעילים × מחיר התוכנית לסניף.
              כשמוסיפים סניף — המנוי מתעדכן אוטומטית (חיוב יחסי לסוף החודש).
              כשמסירים סניף — ייזקף קרדיט לחודש הבא.
            </p>
          </div>
        </div>
      </div>

      {/* Plans Grid */}
      <div>
        <h2 className="text-[14px] font-semibold text-foreground mb-3">בחר תוכנית</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {PLANS.map((plan, i) => (
            <div key={plan.id} className={`fade-in-up stagger-${i + 1}`}>
              <PlanCard
                plan={plan}
                isCurrentPlan={plan.id === currentPlanId && subStatus === 'active'}
                branchCount={branchCount}
                onSelect={handlePlanSelect}
                loading={checkoutLoading === plan.id}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Enterprise */}
      <div className="card-base p-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-[14px] font-bold text-foreground mb-0.5">Enterprise — רשתות וסוכנויות</p>
          <p className="text-[12px] text-foreground-muted">
            מחיר מיוחד לרשתות גדולות, Account Manager ייעודי, SLA 99.5%, חשבונית
          </p>
        </div>
        <a
          href="mailto:contact@otxengine.io?subject=Enterprise Plan"
          className="px-5 py-2.5 bg-foreground text-background rounded-xl text-[13px] font-semibold hover:opacity-90 whitespace-nowrap"
        >
          צור קשר
        </a>
      </div>

      {/* Invoice history */}
      {subData?.invoices?.length > 0 && (
        <div className="card-base overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-[13px] font-semibold text-foreground">היסטוריית חיובים</p>
          </div>
          <div className="divide-y divide-border">
            {subData.invoices.map(inv => <InvoiceRow key={inv.id} inv={inv} />)}
          </div>
        </div>
      )}
    </div>
  );
}
