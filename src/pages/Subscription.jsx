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
    id: 'basic',
    name: 'Basic',
    subtitle: 'לעסקים שמתחילים',
    pricePerBranch: 29,
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
    id: 'best',
    name: 'Best',
    subtitle: 'לעסקים בצמיחה',
    pricePerBranch: 54,
    highlighted: true,
    color: 'e8344d',
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
    id: 'extra',
    name: 'Extra',
    subtitle: 'לעסקים מתקדמים',
    pricePerBranch: 119,
    color: 'FF5722',
    features: [
      { label: 'תיאור החבילה, מטסמת מלאה לעסק', included: true },
      { label: 'ניהול כל האופרציה העסקית במקום אחד', included: true },
      { label: 'סריקות ללא הגבלה', included: true },
      { label: 'מתחרים ללא הגבלה', included: true },
      { label: 'תמונות AI ללא הגבלה', included: true },
      { label: 'אינטגרציות FB/IG/Apify', included: true },
      { label: 'מקורות מידע מותאמים', included: true },
      { label: 'תמיכה Priority 4h', included: true },
      { label: 'Onboarding אישי', included: true },
      { label: 'SLA 99.5%', included: true },
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

function PlanCard({ plan, isCurrentPlan, branchCount, onSelect, loading, yearlyMode }) {
  const accentColor = `#${plan.color}`;
  const monthlyPrice = plan.pricePerBranch;
  const displayPrice = yearlyMode ? Math.round(monthlyPrice * 0.83) : monthlyPrice;
  const yearlyTotal  = displayPrice * 12 * branchCount;
  const monthlyTotal = monthlyPrice * branchCount;
  const showBranchBreakdown = branchCount > 1;

  return (
    <div className={cn(
      'bg-white rounded-2xl border flex flex-col relative transition-all duration-200',
      isCurrentPlan
        ? 'border-2 shadow-md'
        : plan.highlighted
          ? 'border-2 shadow-lg'
          : 'border-gray-200 shadow-sm hover:shadow-md',
    )}
    style={(isCurrentPlan || plan.highlighted) ? { borderColor: accentColor } : {}}
    >
      {/* Highlighted gradient overlay */}
      {plan.highlighted && !isCurrentPlan && (
        <div className="absolute inset-0 rounded-2xl pointer-events-none opacity-[0.04]"
          style={{ background: `linear-gradient(135deg, ${accentColor} 0%, transparent 70%)` }} />
      )}

      {plan.highlighted && (
        <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-white text-[11px] font-bold shadow-sm" style={{ background: accentColor }}>
          הכי פופולרי
        </span>
      )}
      {isCurrentPlan && (
        <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-white text-[11px] font-bold shadow-sm" style={{ background: accentColor }}>
          המסלול שלי
        </span>
      )}

      <div className="p-6 flex-1 flex flex-col">
        {/* Plan name + price */}
        <div className="text-right mb-5">
          <h3 className="text-[22px] font-bold text-gray-900 mb-1">{plan.name}</h3>
          <div className="flex items-baseline gap-1 justify-end">
            <span className="text-[28px] font-bold text-gray-900 tracking-tight">₪{displayPrice.toLocaleString()}</span>
            <span className="text-[12px] text-gray-500">לחודש</span>
          </div>
          {yearlyMode && (
            <p className="text-[11px] text-gray-400 mt-0.5">₪{yearlyTotal.toLocaleString()} לשנה (לפני מע"מ) | מתחדש מדי שנה</p>
          )}
          {!yearlyMode && (
            <p className="text-[11px] text-gray-400 mt-0.5">
              {showBranchBreakdown ? `${branchCount} סניפים × ₪${monthlyPrice.toLocaleString()} | ` : ''}מתחדש מדי חודש
            </p>
          )}
        </div>

        {/* CTA button */}
        <button
          onClick={() => onSelect(plan.id)}
          disabled={isCurrentPlan || loading}
          className={cn(
            'w-full py-3 rounded-full text-[13px] font-bold transition-all flex items-center justify-center gap-2 mb-5',
            isCurrentPlan
              ? 'bg-gray-100 text-gray-400 cursor-default border-2 border-gray-200'
              : 'text-white shadow-sm hover:opacity-90 active:scale-[0.98]',
          )}
          style={!isCurrentPlan ? { background: accentColor } : {}}
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {isCurrentPlan ? 'המסלול שלי' : 'לרכישה'}
        </button>

        {/* Feature divider */}
        <p className="text-[12px] font-bold text-gray-700 text-right mb-3">מה זה כולל?</p>

        {/* Features */}
        <ul className="space-y-2 flex-1">
          {plan.features.map((f, i) => (
            <li key={i} className="flex items-center gap-2 text-[12px] justify-end">
              <span className={f.included ? 'text-gray-700' : 'text-gray-300 line-through'}>{f.label}</span>
              {f.included
                ? <Check className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
                : <div className="w-4 h-4 flex-shrink-0 rounded-full border border-gray-200 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-200" />
                  </div>
              }
            </li>
          ))}
        </ul>
      </div>
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
  const [yearlyMode, setYearlyMode] = useState(false);

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
      <div className="text-center pt-2 pb-1">
        <h1 className="text-[26px] font-bold text-gray-900 mb-1">מסלולים שצומחים עם העסק שלך</h1>
        <p className="text-[14px] text-gray-500 mb-5">בחרו את החבילה הכי משתלמת עבורכם</p>
        {/* Monthly / Yearly toggle */}
        <div className="inline-flex items-center bg-gray-100 rounded-full p-1 gap-1">
          <button
            onClick={() => setYearlyMode(false)}
            className={cn('px-5 py-2 rounded-full text-[13px] font-semibold transition-all', !yearlyMode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}
          >
            תשלום חודשי
          </button>
          <button
            onClick={() => setYearlyMode(true)}
            className={cn('px-5 py-2 rounded-full text-[13px] font-semibold transition-all', yearlyMode ? 'bg-[#e8344d] text-white shadow-sm' : 'text-gray-500')}
          >
            תשלום שנתי
            {!yearlyMode && <span className="mr-1.5 text-[10px] text-emerald-600 font-bold">חסכו 17%</span>}
          </button>
        </div>
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 items-start">
        {PLANS.map((plan, i) => (
          <div key={plan.id} className={`fade-in-up stagger-${i + 1} ${plan.highlighted ? 'sm:-mt-3' : ''}`}>
            <PlanCard
              plan={plan}
              isCurrentPlan={plan.id === currentPlanId && subStatus === 'active'}
              branchCount={branchCount}
              onSelect={handlePlanSelect}
              loading={checkoutLoading === plan.id}
              yearlyMode={yearlyMode}
            />
          </div>
        ))}
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
