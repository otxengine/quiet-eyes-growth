import React from 'react';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function PlanCard({ plan, isCurrentPlan, onSelect, loading }) {
  return (
    <div className={cn(
      'card-base p-6 flex flex-col relative transition-all duration-200',
      isCurrentPlan && 'border-primary ring-1 ring-primary/20',
      plan.highlighted && !isCurrentPlan && 'border-border-hover'
    )}>
      {plan.highlighted && (
        <span className="absolute -top-3 right-4 px-3 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
          הכי פופולרי
        </span>
      )}
      <div className="mb-4">
        <h3 className="text-[15px] font-bold text-foreground">{plan.name}</h3>
        <p className="text-[11px] text-foreground-muted mt-1">{plan.description}</p>
      </div>
      <div className="flex items-baseline gap-1 mb-5">
        <span className="text-[32px] font-bold text-foreground tracking-tight">{plan.price}</span>
        {plan.period && <span className="text-[12px] text-foreground-muted">/{plan.period}</span>}
      </div>
      <ul className="space-y-2.5 mb-6 flex-1">
        {plan.features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-[12px] text-foreground-secondary">
            <Check className="w-3.5 h-3.5 text-success flex-shrink-0 mt-0.5" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <button
        onClick={() => onSelect(plan.id)}
        disabled={isCurrentPlan || loading || plan.id === 'free'}
        className={cn(
          'btn-subtle w-full py-2.5 rounded-lg text-[12px] font-medium transition-all flex items-center justify-center gap-2',
          isCurrentPlan
            ? 'bg-secondary text-foreground-muted cursor-default'
            : plan.id === 'free'
              ? 'bg-secondary text-foreground-muted cursor-default'
              : 'bg-foreground text-background hover:opacity-90'
        )}
      >
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {isCurrentPlan ? 'התוכנית הנוכחית' : plan.id === 'free' ? 'תוכנית בסיס' : 'שדרג עכשיו'}
      </button>
    </div>
  );
}