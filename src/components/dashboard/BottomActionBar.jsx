import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function BottomActionBar({ stats, hasWeeklyReport }) {
  const navigate = useNavigate();

  const actions = [
    stats?.pendingReviews > 0 && {
      label: `הגב לביקורות (${stats.pendingReviews})`,
      path: '/reviews',
      variant: 'default',
    },
    stats?.hotLeads > 0 && {
      label: `צפה בלידים חמים (${stats.hotLeads})`,
      path: '/leads',
      variant: 'success',
    },
    hasWeeklyReport && {
      label: 'דוח שבועי מוכן ←',
      path: '/reports',
      variant: 'default',
    },
  ].filter(Boolean);

  if (actions.length === 0) return null;

  return (
    <div className="flex gap-2.5 pt-3 border-t border-border mt-3">
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={() => navigate(action.path)}
          className="btn-subtle flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-medium text-foreground-muted bg-white border border-border hover:bg-secondary/50 hover:border-border-hover hover:text-foreground transition-all"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}