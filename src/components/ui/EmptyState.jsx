import React from 'react';
import { cn } from '@/lib/utils';

export default function EmptyState({ icon: Icon, title, description, action, actionLabel, className }) {
  return (
    <div className={cn('card-base py-20 text-center', className)}>
      {Icon && (
        <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center gradient-surface">
          <Icon className="w-7 h-7 text-foreground-muted/50" />
        </div>
      )}
      <h3 className="text-[14px] font-semibold text-foreground mb-1.5">{title}</h3>
      {description && (
        <p className="text-[12px] text-foreground-muted mb-5 max-w-[280px] mx-auto">{description}</p>
      )}
      {action && (
        <button onClick={action} className="btn-primary text-[12px] px-4 py-2">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
