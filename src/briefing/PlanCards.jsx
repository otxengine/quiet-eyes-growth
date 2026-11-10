import React, { useState } from 'react';
import { Check, Minus } from 'lucide-react';
import { EN_PLANS, planFeatures } from '../marketing/en/plans.js';
import { billingApi } from '@/api/billingApi';
import { openPaddleCheckout } from '@/lib/paddle';
import { briefingApi } from './api';
import { Button, ErrorNote } from './ui.jsx';

/**
 * The four report-only plans. Choosing a paid one opens the Paddle checkout; the plan itself
 * switches when Paddle's webhook arrives, a few seconds after payment. `onChosen(planId, paid)`.
 */
export default function PlanCards({ businessProfileId, currentPlan, onChosen }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const choose = async (planId) => {
    setError('');
    setBusy(planId);
    try {
      const { requiresCheckout, orgId } = await briefingApi.selectPlan(businessProfileId, planId);
      if (!requiresCheckout) return onChosen?.(planId, false);
      const r = await billingApi.checkout(planId, orgId);
      if (r.transactionId) {
        const outcome = await openPaddleCheckout(r.transactionId);
        if (outcome !== 'completed') return undefined; // closed without paying: nothing changed
      }
      return onChosen?.(planId, true);
    } catch {
      setError('We could not start the checkout. Try again, or write to contact@cortexi.ai.');
      return undefined;
    } finally { setBusy(''); }
  };

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {EN_PLANS.map((p) => {
          const current = p.id === currentPlan;
          return (
            <div key={p.id} className="mkt-card p-4 flex flex-col" style={current ? { borderColor: 'var(--mkt-ink)', borderWidth: 1.5 } : undefined}>
              <div className="font-extrabold text-[16px]">{p.name}</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-[26px] font-extrabold" style={{ letterSpacing: '-0.02em' }}>{p.price}</span>
                <span className="text-[12px]" style={{ color: 'var(--mkt-muted)' }}>/month</span>
              </div>
              <ul className="mt-3 space-y-1.5 flex-1 text-[12.5px]" style={{ color: 'var(--mkt-ink-2)' }}>
                {planFeatures(p).map((f) => (
                  <li key={f.text} className="flex items-start gap-1.5" style={f.on ? undefined : { color: 'var(--mkt-muted)' }}>
                    {f.on ? <Check size={13} className="mt-0.5 shrink-0" aria-hidden="true" /> : <Minus size={13} className="mt-0.5 shrink-0" aria-hidden="true" />}
                    {f.text}
                  </li>
                ))}
              </ul>
              <Button variant={current ? 'ghost' : p.highlighted ? 'gradient' : 'black'} className="mt-4 w-full !h-10 text-[13px]" disabled={current || !!busy} onClick={() => choose(p.id)}>
                {current ? 'Current plan' : busy === p.id ? 'Opening' : p.cta}
              </Button>
            </div>
          );
        })}
      </div>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
