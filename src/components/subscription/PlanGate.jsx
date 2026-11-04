import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Crown } from 'lucide-react';
import { usePlan, PLAN_LABELS } from '@/lib/usePlan';

const PLAN_COLORS = {
  starter:    { bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700',   badge: 'bg-blue-100 text-blue-700' },
  growth:     { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-700' },
  pro:        { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-700' },
  enterprise: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', badge: 'bg-yellow-100 text-yellow-700' },
};

/**
 * Wraps content that requires a minimum plan.
 * If the user doesn't have the required plan, shows an upgrade prompt instead.
 *
 * Usage:
 *   <PlanGate requires="growth">
 *     <MyFeature />
 *   </PlanGate>
 *
 * Or inline overlay:
 *   <PlanGate requires="pro" overlay>
 *     <MyFeature />
 *   </PlanGate>
 */
export default function PlanGate({ requires, children, overlay = false, featureName = '' }) {
  const { can, isLoading } = usePlan();
  const navigate = useNavigate();

  if (isLoading) return null;
  if (can(requires)) return <>{children}</>;

  const colors = PLAN_COLORS[requires] || PLAN_COLORS.growth;
  const planLabel = PLAN_LABELS[requires] || requires;

  if (overlay) {
    return (
      <div className="relative">
        <div className="pointer-events-none opacity-30 select-none">{children}</div>
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-white/80 backdrop-blur-sm border border-border z-10">
          <Lock className="w-6 h-6 text-foreground-muted mb-2" />
          <p className="text-[13px] font-semibold text-foreground mb-1">
            {featureName || 'תכונה זו'} זמינה ב-{planLabel}+
          </p>
          <button
            onClick={() => navigate('/subscription')}
            className="mt-2 px-4 py-1.5 rounded-lg bg-foreground text-background text-[12px] font-medium hover:opacity-90 transition-all flex items-center gap-1.5"
          >
            <Crown className="w-3.5 h-3.5" />
            שדרג עכשיו
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`card-base p-6 flex flex-col items-center text-center ${colors.bg} ${colors.border} border`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-3 ${colors.badge}`}>
        <Lock className="w-5 h-5" />
      </div>
      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mb-2 ${colors.badge}`}>
        {planLabel}+
      </span>
      <p className="text-[14px] font-semibold text-foreground mb-1">
        {featureName || 'תכונה זו'} לא זמינה בתוכנית הנוכחית
      </p>
      <p className="text-[12px] text-foreground-muted mb-4">
        שדרג לתוכנית {planLabel} כדי לפתוח גישה מלאה
      </p>
      <button
        onClick={() => navigate('/subscription')}
        className="px-5 py-2 rounded-lg bg-foreground text-background text-[12px] font-medium hover:opacity-90 transition-all flex items-center gap-2"
      >
        <Crown className="w-3.5 h-3.5" />
        שדרג לתוכנית {planLabel}
      </button>
    </div>
  );
}
