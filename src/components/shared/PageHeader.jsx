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
export default function PageHeader({ count = null, title, subtitle = undefined, actionLabel = undefined, onAction = undefined, actionIcon = undefined }) {
  return (
    <div className="flex items-start justify-between mb-6">
      {/* Action button — top-left */}
      {actionLabel && (
        <button
          onClick={onAction}
          className="flex items-center gap-1.5 bg-foreground text-background px-4 py-2 rounded-full text-sm font-semibold hover:opacity-85 transition-opacity shadow-sm mt-1"
        >
          {actionIcon}
          {actionLabel}
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
