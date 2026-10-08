import { Loader2, RefreshCw } from 'lucide-react';
import { timeAgo } from '@/components/competitors/socialShared';

/**
 * Small "עודכן לפני X · רענן" affordance shared by the three Insights pillar
 * sections (Offers/Reviews/Social) — each pillar's useStaleInsight instance
 * already auto-refreshes in the background when stale; this just surfaces
 * that state + a manual override.
 */
export default function PillarRefreshBadge({ updatedAt, refreshing, onRefresh }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className="text-[10px] text-foreground-muted">
        {refreshing ? 'מרענן...' : updatedAt ? `עודכן ${timeAgo(updatedAt)}` : 'טרם עודכן'}
      </span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        title="רענן"
        className="text-foreground-muted hover:text-foreground disabled:opacity-50 transition-colors"
      >
        {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
