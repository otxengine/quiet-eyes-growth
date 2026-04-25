import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { CheckCircle, XCircle, Clock, Zap, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_CONFIG = {
  completed:        { label: 'בוצע',      color: '#10b981', icon: CheckCircle },
  executing:        { label: 'מבצע...',   color: '#6366f1', icon: Loader2 },
  pending_approval: { label: 'ממתין',     color: '#d97706', icon: Clock },
  failed:           { label: 'נכשל',      color: '#dc2626', icon: XCircle },
  rejected:         { label: 'נדחה',      color: '#94a3b8', icon: XCircle },
};

const ACTION_LABELS = {
  review_reply:   'תגובה לביקורת',
  whatsapp_send:  'שליחת WhatsApp',
  review_request: 'בקשת ביקורת',
  post_publish:   'פרסום תוכן',
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'עכשיו';
  if (mins < 60) return `לפני ${mins} דק'`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `לפני ${h}ש'`;
  return `לפני ${Math.floor(h / 24)} ימים`;
}

function timeUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3600000);
  if (h < 1) return `${Math.floor(diff / 60000)} דק'`;
  return `${h}ש'`;
}

export default function AutoActionsPanel({ bpId }) {
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [actioning, setActioning] = useState({});

  const { data: roiData } = useQuery({
    queryKey: ['roi', bpId],
    queryFn: () => base44.raw.get(`/roi/${bpId}`),
    enabled: !!bpId,
    staleTime: 2 * 60 * 1000,
  });

  const { data: pendingData } = useQuery({
    queryKey: ['autoActionsPending', bpId],
    queryFn: () => base44.raw.get(`/auto-actions/${bpId}?status=pending_approval&take=10`),
    enabled: !!bpId,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  const pending = pendingData?.actions || [];
  const roi = roiData || {};

  const handleApprove = async (actionId, description) => {
    setActioning(prev => ({ ...prev, [actionId]: 'approving' }));
    try {
      await base44.raw.put(`/auto-actions/${actionId}/approve`, {});
      toast.success(`בוצע: ${description}`);
      queryClient.invalidateQueries({ queryKey: ['autoActionsPending', bpId] });
      queryClient.invalidateQueries({ queryKey: ['roi', bpId] });
    } catch (err) {
      toast.error(`שגיאה: ${err.message}`);
    } finally {
      setActioning(prev => ({ ...prev, [actionId]: null }));
    }
  };

  const handleReject = async (actionId) => {
    setActioning(prev => ({ ...prev, [actionId]: 'rejecting' }));
    try {
      await base44.raw.put(`/auto-actions/${actionId}/reject`, { reason: 'נדחה על ידי המשתמש' });
      toast.success('פעולה נדחתה');
      queryClient.invalidateQueries({ queryKey: ['autoActionsPending', bpId] });
    } catch (err) {
      toast.error(`שגיאה: ${err.message}`);
    } finally {
      setActioning(prev => ({ ...prev, [actionId]: null }));
    }
  };

  const hasPending = pending.length > 0;

  return (
    <div
      className="rounded-xl border bg-white overflow-hidden mb-4"
      style={{ borderTop: `3px solid ${hasPending ? '#d97706' : '#10b981'}` }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary opacity-70" />
          <span className="text-[13px] font-semibold">פעולות אוטומטיות</span>
          {hasPending && (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-[9px] font-bold">
              {pending.length}
            </span>
          )}
        </div>

        {/* ROI summary */}
        <div className="flex items-center gap-4 mr-auto ml-3">
          {roi.completed != null && (
            <span className="text-[10px] text-foreground-muted">
              <span className="font-semibold text-foreground">{roi.completed}</span> בוצעו
            </span>
          )}
          {roi.total_revenue_impact > 0 && (
            <span className="text-[10px] text-success font-semibold">
              +₪{roi.total_revenue_impact.toLocaleString()} השפעה
            </span>
          )}
        </div>

        {collapsed
          ? <ChevronDown className="w-4 h-4 text-foreground-muted opacity-50 flex-shrink-0" />
          : <ChevronUp className="w-4 h-4 text-foreground-muted opacity-50 flex-shrink-0" />
        }
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="border-t border-border">
          {pending.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-[12px] text-success">אין פעולות ממתינות לאישור</p>
              {roi.recent_actions?.length > 0 && (
                <div className="mt-3 space-y-1">
                  {roi.recent_actions.slice(0, 3).map(a => {
                    const cfg = STATUS_CONFIG[a.status] || STATUS_CONFIG.completed;
                    const Icon = cfg.icon;
                    return (
                      <div key={a.id} className="flex items-center gap-2 text-[10px] text-foreground-muted px-2 py-1 rounded hover:bg-secondary/30">
                        <Icon className="w-3 h-3 flex-shrink-0" style={{ color: cfg.color }} />
                        <span className="flex-1 text-right truncate">{a.description}</span>
                        {a.revenue_impact > 0 && (
                          <span className="text-success font-medium">+₪{a.revenue_impact}</span>
                        )}
                        <span className="opacity-50 flex-shrink-0">{timeAgo(a.executed_at || a.created_date)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {pending.map(action => {
                const until = timeUntil(action.auto_execute_at);
                const isActioning = actioning[action.id];
                return (
                  <div key={action.id} className="px-4 py-3 hover:bg-secondary/20 transition-colors" style={{ borderRight: '2px solid #d97706' }}>
                    <div className="flex items-start gap-2">
                      <Clock className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium text-foreground leading-snug">{action.description}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[9px] text-foreground-muted">
                            {ACTION_LABELS[action.action_type] || action.action_type}
                          </span>
                          {action.revenue_impact > 0 && (
                            <span className="text-[9px] text-success font-medium">+₪{action.revenue_impact}</span>
                          )}
                          {until && (
                            <span className="text-[9px] text-amber-600">אוטומטי בעוד {until}</span>
                          )}
                          <span className="text-[9px] text-foreground-muted opacity-50">{timeAgo(action.created_date)}</span>
                        </div>
                        <div className="flex gap-1.5 mt-2">
                          <button
                            onClick={() => handleApprove(action.id, action.description)}
                            disabled={!!isActioning}
                            className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-medium bg-success text-white hover:opacity-90 transition-all disabled:opacity-60"
                          >
                            {isActioning === 'approving' && <Loader2 className="w-3 h-3 animate-spin" />}
                            {isActioning === 'approving' ? 'מבצע...' : 'אשר ובצע'}
                          </button>
                          <button
                            onClick={() => handleReject(action.id)}
                            disabled={!!isActioning}
                            className="px-2.5 py-1 rounded text-[10px] text-foreground-muted border border-border hover:bg-secondary transition-all disabled:opacity-60"
                          >
                            דחה
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
