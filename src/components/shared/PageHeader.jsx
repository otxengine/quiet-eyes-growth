import React from 'react';

/**
 * PageHeader — count + title right-aligned, action button top-left
 * Props:
 *   count       {number|string}
 *   title       {string}
 *   actionLabel {string}
 *   onAction    {function}
 *   actionIcon  {ReactNode}  optional icon before label
 */
export default function PageHeader({ count, title, actionLabel, onAction, actionIcon }) {
  return (
    <div className="flex items-center justify-between mb-6">
      {/* Action button — top-left (LTR left = RTL right visually, but flex row-reverse) */}
      {actionLabel && (
        <button
          onClick={onAction}
          className="flex items-center gap-2 bg-[#e8344d] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#c92b40] transition-colors shadow-sm"
        >
          {actionIcon}
          {actionLabel}
        </button>
      )}
      {/* Count + title — right-aligned */}
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-foreground">{count}</span>
        <span className="text-lg font-semibold text-foreground-secondary">{title}</span>
      </div>
    </div>
  );
}
