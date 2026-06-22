import React from 'react';
import { Clock } from 'lucide-react';

/**
 * UrgentActionsSection — "פעולות דחופות" with up to 3 gradient cards (pink/purple/blue)
 * Props:
 *   actions: Array of { title, description, ctaLabel, onCta, timeText?, variant?: 'pink'|'purple'|'blue' }
 *   timeText: optional time string shown with a clock icon (e.g. "לפני 2 שעות")
 */
export default function UrgentActionsSection({ actions = [] }) {
  if (!actions.length) return null;

  const gradients = [
    'linear-gradient(135deg, #fce4ec 0%, #f8bbd0 100%)',
    'linear-gradient(135deg, #f3e5f5 0%, #e1bee7 100%)',
    'linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%)',
  ];

  const cols = actions.length >= 3 ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2';

  return (
    <div className="mb-6">
      <h3 className="text-sm font-bold text-foreground-secondary mb-3 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[#e8344d] inline-block" />
        פעולות דחופות
      </h3>
      <div className={`grid ${cols} gap-3`}>
        {actions.slice(0, 3).map((action, i) => (
          <div
            key={i}
            className="rounded-xl p-4 flex flex-col gap-3"
            style={{ background: gradients[i % 3] }}
          >
            <div>
              <div className="font-semibold text-sm text-foreground">{action.title}</div>
              {action.description && (
                <div className="text-xs text-foreground-secondary mt-1">{action.description}</div>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              {action.ctaLabel && (
                <button
                  onClick={action.onCta}
                  className="self-start bg-white/80 hover:bg-white text-foreground text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors border border-white/60 shadow-sm"
                >
                  {action.ctaLabel}
                </button>
              )}
              {action.timeText && (
                <div className="flex items-center gap-1 text-[10px] text-foreground-muted">
                  <Clock className="w-3 h-3" />
                  {action.timeText}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
