import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { stripeApi } from '@/api/stripeApi';
import { toast } from 'sonner';
import { Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PLAN_CATALOG } from '@/lib/planCatalog';
import KoriAvatar from './KoriAvatar';

const BG_STYLE = {
  backgroundColor: '#f5f5f7',
  backgroundImage: 'radial-gradient(circle, #d1d1d1 1px, transparent 1px)',
  backgroundSize: '24px 24px',
};

// sessionStorage fallback: a full-page Stripe redirect loses React Router state,
// so OnboardingScanning re-hydrates from here when it returns with ?success=true.
export const ONBOARDING_STATE_KEY = 'otx_onboarding_state';

function PlanOption({ plan, selected, onSelect, loading }) {
  return (
    <div className={cn(
      'card-base p-5 flex flex-col relative transition-all duration-200 text-right',
      plan.highlighted ? 'border-border-hover shadow-md' : '',
    )}>
      {plan.highlighted && (
        <span className="absolute -top-3 right-4 px-3 py-0.5 rounded-full bg-[#9c27b0] text-white text-[10px] font-bold">
          הכי פופולרי
        </span>
      )}
      <div className="mb-3">
        <h3 className="text-[14px] font-bold text-gray-900">{plan.name}</h3>
        <p className="text-[11px] text-gray-500">{plan.description}</p>
      </div>
      <div className="flex items-baseline gap-1 mb-4">
        <span className="text-[24px] font-bold text-gray-900 tracking-tight">{plan.price}</span>
        <span className="text-[11px] text-gray-500">/{plan.period}</span>
      </div>
      <ul className="space-y-1.5 mb-5 flex-1">
        {plan.features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px] text-gray-600">
            <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-[#e8344d]" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <button
        onClick={() => onSelect(plan.id)}
        disabled={loading}
        className="w-full py-2.5 rounded-lg text-[12px] font-semibold text-white hover:opacity-90 transition-all flex items-center justify-center gap-2"
        style={{ background: 'linear-gradient(135deg, #9c27b0, #e8344d)' }}
      >
        {selected === plan.id && loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        בחר תוכנית
      </button>
    </div>
  );
}

export default function OnboardingSelectPlan() {
  const location = useLocation();
  const navigate = useNavigate();
  const [loadingPlan, setLoadingPlan] = useState(null);

  const businessProfile = location.state?.businessProfile;
  const onboardingData = location.state?.onboardingData || {};

  if (!businessProfile) { navigate('/onboarding'); return null; }

  const goToScanning = () => navigate('/onboarding/scanning', { state: { businessProfile, onboardingData } });

  const handleSelect = async (planId) => {
    if (loadingPlan) return;
    setLoadingPlan(planId);
    try {
      const result = await base44.raw.post('/onboarding/select-plan', {
        businessProfileId: businessProfile.id,
        planId,
      });

      if (!result.requiresCheckout) {
        goToScanning();
        return;
      }

      sessionStorage.setItem(ONBOARDING_STATE_KEY, JSON.stringify({ businessProfile, onboardingData }));
      const returnUrl = `${window.location.origin}/onboarding/scanning?success=true`;
      const checkout = await stripeApi.checkout(planId, result.orgId, returnUrl);
      if (checkout.url) {
        window.location.href = checkout.url;
      } else if (checkout.devBypass) {
        toast.success('התוכנית עודכנה (מצב פיתוח, ללא Stripe)');
        goToScanning();
      } else {
        toast.error(checkout.error || 'שגיאה ביצירת הזמנה');
        setLoadingPlan(null);
      }
    } catch (err) {
      toast.error(err.message || 'שגיאה — נסה שוב');
      setLoadingPlan(null);
    }
  };

  return (
    <div dir="rtl" className="min-h-screen py-8 px-4" style={BG_STYLE}>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="text-center pb-2">
          <KoriAvatar size="md" className="mx-auto mb-4 shadow-md" />
          <h1 className="text-[20px] font-bold text-gray-900 mb-1">איזו תוכנית מתאימה לך?</h1>
          <p className="text-[13px] text-gray-500">אפשר להתחיל בחינם ולשדרג בכל שלב</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLAN_CATALOG.map((plan) => (
            <PlanOption
              key={plan.id}
              plan={plan}
              selected={loadingPlan}
              loading={!!loadingPlan}
              onSelect={handleSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
