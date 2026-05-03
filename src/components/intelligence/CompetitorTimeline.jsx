import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { GitCommitHorizontal, RefreshCw, Loader2, AlertTriangle, TrendingDown, Tag, Zap } from 'lucide-react';

const MOVE_ICON = {
  price_change: Tag,
  new_service: Zap,
  promotion: Zap,
  rating_drop: TrendingDown,
  weakness: AlertTriangle,
  expansion: Zap,
};

const PRIORITY_DOT = {
  high: 'bg-danger',
  medium: 'bg-warning',
  low: 'bg-success',
};

function TimelineEntry({ alert }) {
  const MoveType = Object.entries(MOVE_ICON).find(([k]) => alert.description?.toLowerCase().includes(k.replace('_', ' ')))?.[1] || GitCommitHorizontal;

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${PRIORITY_DOT[alert.priority] || 'bg-foreground-muted'}`} />
        <div className="w-px flex-1 bg-border/50 mt-1" />
      </div>
      <div className="flex-1 min-w-0 pb-3">
        <p className="text-[12px] font-semibold text-foreground">{alert.title}</p>
        {alert.description && (
          <p className="text-[10px] text-foreground-muted mt-0.5 line-clamp-2">{alert.description}</p>
        )}
        {alert.suggested_action && (
          <p className="text-[10px] text-primary mt-1 font-medium">תגובה מומלצת: {alert.suggested_action.substring(0, 80)}</p>
        )}
        <p className="text-[9px] text-foreground-muted mt-1">
          {alert.created_at ? new Date(alert.created_at).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
        </p>
      </div>
    </div>
  );
}

export default function CompetitorTimeline({ bpId }) {
  const [scanning, setScanning] = useState(false);
  const queryClient = useQueryClient();

  const { data: moves, isLoading } = useQuery({
    queryKey: ['competitorMoves', bpId],
    queryFn: () => base44.entities.ProactiveAlert.filter({ linked_business: bpId, alert_type: 'competitor_move' }),
    enabled: !!bpId,
    select: data => [...(data || [])].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()),
  });

  const handleScan = async () => {
    setScanning(true);
    try {
      await base44.functions.invoke('competitorMoveTracker', { businessProfileId: bpId });
      await queryClient.invalidateQueries({ queryKey: ['competitorMoves', bpId] });
      toast.success('ניתוח מהלכי מתחרים הושלם');
    } catch {
      toast.error('שגיאה בניתוח');
    }
    setScanning(false);
  };

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
          <GitCommitHorizontal className="w-4 h-4 text-primary" />
          מהלכי מתחרים
        </h3>
        <button onClick={handleScan} disabled={scanning}
          className="flex items-center gap-1 text-[10px] text-foreground-muted hover:text-foreground transition-colors disabled:opacity-60">
          {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          עדכן
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-4 h-4 animate-spin text-foreground-muted" />
        </div>
      ) : !moves || moves.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-[11px] text-foreground-muted mb-3">טרם זוהו מהלכי מתחרים</p>
          <button onClick={handleScan} disabled={scanning}
            className="text-[10px] text-primary hover:opacity-70 transition-opacity font-medium disabled:opacity-40">
            {scanning ? 'סורק...' : 'סרוק עכשיו'}
          </button>
        </div>
      ) : (
        <div className="space-y-0">
          {moves.slice(0, 8).map(move => (
            <TimelineEntry key={move.id} alert={move} />
          ))}
          {moves.length > 8 && (
            <p className="text-[10px] text-foreground-muted text-center pt-1">
              +{moves.length - 8} מהלכים נוספים
            </p>
          )}
        </div>
      )}
    </div>
  );
}
