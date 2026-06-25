import React from 'react';

/**
 * PageHeader — count + title right-aligned, action button top-left
 * Props:
 *   count       {number|string}
 *   title       {string}
 *   subtitle    {string}  optional subtitle below title
 *   actionLabel {string}
 *   onAction    {function}
 *   actionIcon  {ReactNode}  optional icon before label
 */
export default function PageHeader({ count, title, subtitle, actionLabel, onAction, actionIcon }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
      {/* Action button — top-left */}
      {actionLabel && (
        <button
          onClick={onAction}
          title={actionLabel}
          aria-label={actionLabel}
          className="flex items-center gap-1.5 bg-foreground text-background px-3 py-2 sm:px-4 rounded-full text-sm font-semibold hover:opacity-85 transition-opacity shadow-sm mt-1"
        >
          {actionIcon}
          <span className="hidden sm:inline">{actionLabel}</span>
        </button>
      )}
      {/* Count + title — right-aligned */}
      <div className="text-right">
        <div className="flex items-baseline gap-2 justify-end">
          {count != null && count !== '' && (
            <span className="text-3xl font-bold text-foreground">{count}</span>
          )}
          <span className="text-lg font-semibold text-foreground">{title}</span>
        </div>
        {subtitle && (
          <p className="text-xs text-foreground-muted mt-0.5">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
