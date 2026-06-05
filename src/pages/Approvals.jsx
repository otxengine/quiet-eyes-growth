import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import {
  CheckCircle2, XCircle, Clock, Zap, Bot, Copy, CheckCheck,
  Loader2, ShieldAlert, TrendingUp, MessageSquare, Megaphone
} from 'lucide-react';

const ACTION_TYPE_META = {
  social_post:    { label: 'פוסט שיווקי',   icon: Megaphone,     color: 'text-primary',  bg: 'bg-primary/8',  border: 'border-primary/20' },
  review_reply:   { label: 'תגובה לביקורת', icon: MessageSquare,  color: 'text-blue-600',    bg: 'bg-blue-50',    border: 'border-blue-100' },
  whatsapp_send:  { label: 'הודעת וואטסאפ', icon: Zap,            color: 'text-green-600',   bg: 'bg-green-50',   border: 'border-green-100' },
  campaign:       { label: 'קמפיין',         icon: TrendingUp,     color: 'text-orange-600',  bg: 'bg-orange-50',  border: 'border-orange-100' },
  review_request: { label: 'בקשת ביקורת',   icon: ShieldAlert,    color: 'text-amber-600',   bg: 'bg-amber-50',   border: 'border-amber-100' },
};

const DECISION_META = {
  auto_execute:        { label: 'ביצוע אוטומטי', color: 'text-green-700',  bg: 'bg-green-100' },
  present_for_approval:{ label: 'ממתין לאישור',  color: 'text-amber-700',  bg: 'bg-amber-100' },
  discard:             { label: 'בוטל',           color: 'text-foreground-secondary',   bg: 'bg-secondary' },
};

const STATUS_META = {
  pending_approval: { label: 'ממתין לאישור', color: 'text-amber-700',  bg: 'bg-amber-100' },
  approved:         { label: 'אושר',          color: 'text-green-700',  bg: 'bg-green-100' },
  executing:        { label: 'בביצוע',        color: 'text-blue-700',   bg: 'bg-blue-100' },
  completed:        { label: 'הושלם',         color: 'text-green-700',  bg: 'bg-green-100' },
  rejected:         { label: 'נדחה',          color: 'text-red-700',    bg: 'bg-red-100' },
  failed:           { label: 'נכשל',          color: 'text-red-700',    bg: 'bg-red-100' },
};

function ConfidenceBar({ score }) {
  const color = score >= 85 ? 'bg-green-500' : score >= 60 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[10px] text-foreground-muted w-7 text-left">{score}%</span>
    </div>
  );
}

function ActionCard({ action, onApprove, onReject, approving, rejecting }) {
  const [copied, setCopied] = useState(false);
  const meta = ACTION_TYPE_META[action.action_type] || ACTION_TYPE_META.social_post;
  const statusMeta = STATUS_META[action.status] || STATUS_META.pending_approval;
  const Icon = meta.icon;

  let payload = {};
  try { payload = JSON.parse(action.payload || '{}'); } catch {}

  const isPending = action.status === 'pending_approval';

  const handleCopy = async () => {
    const text = payload.prefilled_text || action.description;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  // Time until auto-execute
  let autoIn = null;
  if (action.auto_execute_at && isPending) {
    const ms = new Date(action.auto_execute_at).getTime() - Date.now();
    if (ms > 0) {
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      autoIn = h > 0 ? `${h}ש' ${m}ד'` : `${m}ד'`;
    }
  }

  return (
    <div className={`rounded-xl border ${meta.border} ${meta.bg} p-4 space-y-3`}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-white/80 ${meta.color} flex-shrink-0`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-semibold text-foreground">{action.description}</p>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusMeta.bg} ${statusMeta.color}`}>
              {statusMeta.label}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-[10px] text-foreground-muted flex items-center gap-1">
              <Bot className="w-3 h-3" /> {action.agent_name}
            </span>
            <span className="text-[10px] text-foreground-muted">{meta.label}</span>
            {action.predicted_impact && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                action.predicted_impact === 'high' ? 'bg-red-100 text-red-700' :
                action.predicted_impact === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-secondary text-foreground-secondary'
              }`}>
                השפעה: {action.predicted_impact === 'high' ? 'גבוהה' : action.predicted_impact === 'medium' ? 'בינונית' : 'נמוכה'}
              </span>
            )}
          </div>
        </div>
        {action.revenue_impact > 0 && (
          <div className="text-right flex-shrink-0">
            <p className="text-[10px] text-foreground-muted">פוטנציאל</p>
            <p className="text-[13px] font-bold text-green-600">₪{action.revenue_impact.toLocaleString()}</p>
          </div>
        )}
      </div>

      {/* Confidence */}
      {action.confidence_score > 0 && (
        <div>
          <p className="text-[10px] text-foreground-muted mb-1">רמת ביטחון של הסוכן</p>
          <ConfidenceBar score={action.confidence_score} />
        </div>
      )}

      {/* Decision reason */}
      {action.decision_reason && (
        <p className="text-[10px] text-foreground-muted bg-white/60 rounded-lg px-2.5 py-1.5 border border-white/80">
          {action.decision_reason}
        </p>
      )}

      {/* Content preview */}
      {payload.prefilled_text && (
        <div className="bg-white/70 rounded-lg p-2.5 border border-white/80">
          <p className="text-[11px] text-foreground-secondary leading-relaxed whitespace-pre-wrap">
            {payload.prefilled_text}
          </p>
          <button onClick={handleCopy}
            className="mt-1.5 flex items-center gap-1 text-[10px] text-foreground-muted hover:text-foreground transition-colors">
            {copied ? <CheckCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? 'הועתק' : 'העתק טקסט'}
          </button>
        </div>
      )}

      {/* Auto-execute timer */}
      {autoIn && (
        <div className="flex items-center gap-1.5 text-[10px] text-amber-600">
          <Clock className="w-3 h-3" />
          יבוצע אוטומטית בעוד {autoIn} אם לא יאושר
        </div>
      )}

      {/* Actions */}
      {isPending && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => onApprove(action.id)}
            disabled={approving === action.id || rejecting === action.id}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-[11px] font-semibold transition-all disabled:opacity-60"
          >
            {approving === action.id
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <CheckCircle2 className="w-3 h-3" />}
            אשר ובצע
          </button>
          <button
            onClick={() => onReject(action.id)}
            disabled={approving === action.id || rejecting === action.id}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-foreground-muted hover:text-red-600 hover:border-red-300 text-[11px] font-medium transition-all disabled:opacity-60"
          >
            {rejecting === action.id
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <XCircle className="w-3 h-3" />}
            דחה
          </button>
        </div>
      )}
    </div>
  );
}

export function ApprovalsPanel({ bpId }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('pending');
  const [approving, setApproving] = useState(null);
  const [rejecting, setRejecting] = useState(null);

  const { data: stats, isLoading } = useQuery({
    queryKey: ['eventBusStats', bpId],
    queryFn: () => base44.functions.invoke('getEventBusStats', { businessProfileId: bpId }),
    enabled: !!bpId,
    refetchInterval: 30000,
  });

  const pendingActions = stats?.pending_actions || [];
  const recentActions  = stats?.recent_actions  || [];

  const handleApprove = async (actionId) => {
    setApproving(actionId);
    try {
      await base44.functions.invoke('approveAction', { actionId, businessProfileId: bpId });
      toast.success('פעולה אושרה ✓');
      queryClient.invalidateQueries({ queryKey: ['eventBusStats'] });
    } catch { toast.error('שגיאה באישור'); }
    setApproving(null);
  };

  const handleReject = async (actionId) => {
    setRejecting(actionId);
    try {
      await base44.functions.invoke('rejectAction', { actionId, businessProfileId: bpId });
      toast.success('פעולה נדחתה');
      queryClient.invalidateQueries({ queryKey: ['eventBusStats'] });
    } catch { toast.error('שגיאה בדחייה'); }
    setRejecting(null);
  };

  const displayActions = tab === 'pending' ? pendingActions : recentActions;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center">
          <ShieldAlert className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <h1 className="text-[16px] font-bold text-foreground">תיבת אישורים</h1>
          <p className="text-[11px] text-foreground-muted">פעולות שנוצרו על ידי סוכנים — ממתינות לאישורך</p>
        </div>
        {pendingActions.length > 0 && (
          <span className="mr-auto text-[11px] px-2.5 py-1 rounded-full bg-amber-500 text-white font-bold">
            {pendingActions.length} ממתינות
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-secondary rounded-lg p-1 w-fit">
        {[
          { key: 'pending', label: `ממתינות (${pendingActions.length})` },
          { key: 'history', label: `היסטוריה (${recentActions.length})` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-md text-[11px] font-medium transition-all ${
              tab === t.key ? 'bg-white text-foreground shadow-sm' : 'text-foreground-muted hover:text-foreground'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
        </div>
      ) : displayActions.length === 0 ? (
        <div className="card-base p-10 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-3" />
          <p className="text-[13px] font-medium text-foreground">
            {tab === 'pending' ? 'אין פעולות הממתינות לאישור' : 'אין היסטוריית פעולות'}
          </p>
          <p className="text-[11px] text-foreground-muted mt-1">
            {tab === 'pending' ? 'הסוכנים יציעו פעולות בעת גילוי הזדמנויות' : 'פעולות שאושרו או נדחו יופיעו כאן'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayActions.map(action => (
            <ActionCard
              key={action.id}
              action={action}
              onApprove={handleApprove}
              onReject={handleReject}
              approving={approving}
              rejecting={rejecting}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Approvals() {
  const { businessProfile } = useOutletContext();
  return <ApprovalsPanel bpId={businessProfile?.id} />;
}
