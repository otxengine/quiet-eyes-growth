import React from 'react';

/**
 * UrgentActionsSection — "פעולות דחופות" with 2 gradient cards (pink/purple)
 * Props:
 *   actions: Array of { title, description, ctaLabel, onCta, variant?: 'pink'|'purple' }
 */
export default function UrgentActionsSection({ actions = [] }) {
  if (!actions.length) return null;

  const gradients = [
    'linear-gradient(135deg, #fce4ec 0%, #f8bbd0 100%)',
    'linear-gradient(135deg, #f3e5f5 0%, #e1bee7 100%)',
  ];

  return (
    <div className="mb-6">
      <h3 className="text-sm font-bold text-foreground-secondary mb-3 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[#e8344d] inline-block" />
        פעולות דחופות
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {actions.slice(0, 2).map((action, i) => (
          <div
            key={i}
            className="rounded-xl p-4 flex flex-col gap-3"
            style={{ background: gradients[i] }}
          >
            <div>
              <div className="font-semibold text-sm text-foreground">{action.title}</div>
              {action.description && (
                <div className="text-xs text-foreground-secondary mt-1">{action.description}</div>
              )}
            </div>
            {action.ctaLabel && (
              <button
                onClick={action.onCta}
                className="self-start bg-white/80 hover:bg-white text-foreground text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors border border-white/60 shadow-sm"
              >
                {action.ctaLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
