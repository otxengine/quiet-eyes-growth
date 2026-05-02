import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Lightbulb, Zap, Target, TrendingUp, AlertTriangle, Trophy,
  ArrowRight, CheckCircle2, Circle, ClipboardList, ChevronLeft,
  Loader2, Clock, CheckCheck
} from 'lucide-react';
import { toast } from 'sonner';

const TYPE_META = {
  action_needed:      { label: 'פעולה נדרשת', color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-100',    icon: Zap },
  negative_review:    { label: 'ביקורת שלילית',color: 'text-red-600',   bg: 'bg-red-50',    border: 'border-red-100',    icon: AlertTriangle },
  opportunity:        { label: 'הזדמנות',      color: 'text-green-600', bg: 'bg-green-50',  border: 'border-green-100',  icon: Target },
  market_opportunity: { label: 'הזדמנות שוק', color: 'text-green-600', bg: 'bg-green-50',  border: 'border-green-100',  icon: TrendingUp },
  risk:               { label: 'סיכון',        color: 'text-amber-600', bg: 'bg-amber-50',  border: 'border-amber-100',  icon: AlertTriangle },
  retention_risk:     { label: 'סיכון שימור', color: 'text-amber-600', bg: 'bg-amber-50',  border: 'border-amber-100',  icon: AlertTriangle },
  competitor_move:    { label: 'מהלך מתחרה',  color: 'text-indigo-600',bg: 'bg-indigo-50', border: 'border-indigo-100', icon: Trophy },
  milestone:          { label: 'אבן דרך',      color: 'text-purple-600',bg: 'bg-purple-50', border: 'border-purple-100', icon: Trophy },
  hot_lead:           { label: 'ליד חם',       color: 'text-amber-600', bg: 'bg-amber-50',  border: 'border-amber-100',  icon: Zap },
  competitive:        { label: 'תחרותי',       color: 'text-indigo-600',bg: 'bg-indigo-50', border: 'border-indigo-100', icon: Target },
  defensive:          { label: 'הגנתי',        color: 'text-amber-600', bg: 'bg-amber-50',  border: 'border-amber-100',  icon: AlertTriangle },
  general:            { label: 'כללי',         color: 'text-blue-600',  bg: 'bg-blue-50',   border: 'border-blue-100',   icon: Lightbulb },
};

const PRIORITY_BADGE = {
  critical: { label: 'קריטי', color: 'text-red-700',    bg: 'bg-red-100' },
  high:     { label: 'גבוה',  color: 'text-orange-700', bg: 'bg-orange-100' },
  medium:   { label: 'בינוני',color: 'text-yellow-700', bg: 'bg-yellow-100' },
  low:      { label: 'נמוך',  color: 'text-gray-600',   bg: 'bg-gray-100' },
};

/** Parse execution_plan / suggested_action text into steps array */
function parseSteps(text) {
  if (!text) return [];
  // Split on numbered lines: "1. ...", "1) ...", or bullet lines
  const lines = text
    .split(/\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const steps = [];
  for (const line of lines) {
    const cleaned = line.replace(/^[\d]+[.)]\s*/, '').replace(/^[-•*]\s*/, '').trim();
    if (cleaned) steps.push(cleaned);
  }
  return steps.length > 1 ? steps : [text.trim()];
}

function useStepChecks(insightId, count) {
  const storageKey = `insight_steps_${insightId}`;
  const [checks, setChecks] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (Array.isArray(saved) && saved.length === count) return saved;
    } catch {}
    return Array(count).fill(false);
  });

  useEffect(() => {
    if (checks.length !== count) setChecks(Array(count).fill(false));
  }, [count]);

  const toggle = (idx) => {
    setChecks(prev => {
      const next = [...prev];
      next[idx] = !next[idx];
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  return { checks, toggle };
}

function StatusTimeline({ status, isActedOn }) {
  const stages = [
    { key: 'proposed',    label: 'הוצע' },
    { key: 'in_progress', label: 'בביצוע' },
    { key: 'completed',   label: 'הושלם' },
  ];

  const currentIdx = isActedOn ? 2
    : status === 'in_progress' ? 1
    : status === 'completed'   ? 2
    : 0;

  return (
    <div className="flex items-center gap-0">
      {stages.map((stage, i) => {
        const done   = i <= currentIdx;
        const active = i === currentIdx;
        return (
          <React.Fragment key={stage.key}>
            <div className="flex flex-col items-center">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all
                ${done ? 'bg-primary border-primary' : 'bg-white border-border'}`}>
                {done
                  ? <CheckCheck className="w-3.5 h-3.5 text-white" />
                  : <div className="w-2 h-2 rounded-full bg-border" />}
              </div>
              <span className={`text-[10px] mt-1 font-medium ${active ? 'text-primary' : done ? 'text-foreground-secondary' : 'text-foreground-muted'}`}>
                {stage.label}
              </span>
            </div>
            {i < stages.length - 1 && (
              <div className={`h-0.5 flex-1 mx-1 mb-4 ${i < currentIdx ? 'bg-primary' : 'bg-border'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function RelatedCard({ item, onClick }) {
  const meta = TYPE_META[item.alert_type || item.category || 'general'] || TYPE_META.general;
  const Icon = meta.icon;
  return (
    <button
      onClick={onClick}
      className={`text-right rounded-xl border ${meta.border} ${meta.bg} p-3 hover:shadow-sm transition-all w-full`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
        <span className={`text-[9px] font-bold ${meta.color}`}>{meta.label}</span>
      </div>
      <p className="text-[11px] font-semibold text-foreground leading-snug line-clamp-2">{item.title}</p>
    </button>
  );
}

export default function InsightDetail() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const { businessProfile } = useOutletContext();
  const queryClient = useQueryClient();
  const bpId = businessProfile?.id;

  // Parse id format: "alert-{uuid}" or "action-{uuid}"
  const [kind, entityId] = id?.includes('-')
    ? [id.startsWith('action-') ? 'action' : 'alert', id.replace(/^(alert|action)-/, '')]
    : ['alert', id];

  // Fetch entity
  const { data: alert, isLoading: loadingAlert } = useQuery({
    queryKey: ['proactiveAlert', entityId],
    queryFn: () => base44.entities.ProactiveAlert.get(entityId),
    enabled: kind === 'alert' && !!entityId,
  });

  const { data: action, isLoading: loadingAction } = useQuery({
    queryKey: ['action', entityId],
    queryFn: () => base44.entities.Action.get(entityId),
    enabled: kind === 'action' && !!entityId,
  });

  const loading = loadingAlert || loadingAction;
  const entity  = kind === 'alert' ? alert : action;

  // Normalize fields
  const title       = entity?.title || '';
  const description = entity?.description || '';
  const reasoning   = kind === 'action' ? entity?.reasoning : null;
  const impact      = kind === 'action' ? entity?.impact_estimate : null;
  const stepsText   = kind === 'action'
    ? (entity?.execution_plan || entity?.suggested_action || '')
    : (entity?.suggested_action || '');
  const typeKey  = kind === 'alert'
    ? (entity?.alert_type || 'action_needed')
    : (entity?.category || 'general');
  const priority    = entity?.priority || 'medium';
  const sourceAgent = entity?.source_agent || null;
  const createdAt   = entity?.created_date || entity?.created_at;
  const status      = kind === 'action' ? (entity?.status || 'proposed') : null;
  const isActedOn   = kind === 'alert' ? (entity?.is_acted_on || false) : (entity?.status === 'completed');

  const typeMeta    = TYPE_META[typeKey] || TYPE_META.general;
  const priorityMeta = PRIORITY_BADGE[priority] || PRIORITY_BADGE.medium;
  const TypeIcon    = typeMeta.icon;

  const steps = parseSteps(stepsText);
  const { checks, toggle } = useStepChecks(id, steps.length);

  // Fetch related alerts (same type, same business, exclude current)
  const { data: relatedAlerts = [] } = useQuery({
    queryKey: ['relatedAlerts', bpId, typeKey],
    queryFn: () => base44.entities.ProactiveAlert.filter(
      { linked_business: bpId, alert_type: typeKey, is_dismissed: false },
      '-created_at',
      5
    ),
    enabled: !!bpId && kind === 'alert',
    select: data => data.filter(a => a.id !== entityId).slice(0, 3),
  });

  // Mark as completed mutation
  const completeMutation = useMutation({
    mutationFn: () => kind === 'alert'
      ? base44.entities.ProactiveAlert.update(entityId, { is_acted_on: true })
      : base44.entities.Action.update(entityId, { status: 'completed' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [kind === 'alert' ? 'proactiveAlert' : 'action', entityId] });
      queryClient.invalidateQueries({ queryKey: ['proactiveAlerts'] });
      queryClient.invalidateQueries({ queryKey: ['activeInsights'] });
      toast.success('סומן כהושלם');
    },
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
      </div>
    );
  }

  if (!entity) {
    return (
      <div className="text-center py-20" dir="rtl">
        <p className="text-[13px] text-foreground-muted">התובנה לא נמצאה</p>
        <button onClick={() => navigate('/insights')} className="mt-3 text-[12px] text-primary hover:underline">
          חזור לרשימת התובנות
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-10" dir="rtl">

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
        <button onClick={() => navigate('/insights')} className="hover:text-primary transition-colors flex items-center gap-1">
          <ArrowRight className="w-3 h-3" /> תובנות
        </button>
        <ChevronLeft className="w-3 h-3" />
        <span className="text-foreground truncate max-w-[200px]">{title}</span>
      </div>

      {/* ── A. Header ── */}
      <div className={`rounded-2xl border ${typeMeta.border} ${typeMeta.bg} p-5`}>
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-white border ${typeMeta.border}`}>
            <TypeIcon className={`w-5 h-5 ${typeMeta.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${typeMeta.bg} ${typeMeta.color} border ${typeMeta.border}`}>
                {typeMeta.label}
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${priorityMeta.bg} ${priorityMeta.color}`}>
                {priorityMeta.label}
              </span>
            </div>
            <h1 className="text-[17px] font-bold text-foreground leading-snug mb-2">{title}</h1>
            <div className="flex items-center gap-3 text-[10px] text-foreground-muted flex-wrap">
              {createdAt && <span>{new Date(createdAt).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })}</span>}
              {sourceAgent && <span>· סוכן: {sourceAgent}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* ── B. למה זה חשוב ── */}
      {(description || reasoning || impact) && (
        <div className="card-base p-5 space-y-3">
          <h2 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-primary opacity-60" />
            למה זה חשוב
          </h2>
          {description && (
            <p className="text-[12px] text-foreground-secondary leading-relaxed">{description}</p>
          )}
          {reasoning && reasoning !== description && (
            <p className="text-[12px] text-foreground-secondary leading-relaxed border-t border-border pt-3">{reasoning}</p>
          )}
          {impact && (
            <div className="rounded-lg bg-green-50 border border-green-100 px-3 py-2">
              <p className="text-[11px] font-semibold text-green-700 mb-0.5">הערכת השפעה</p>
              <p className="text-[11px] text-green-600 leading-relaxed">{impact}</p>
            </div>
          )}
        </div>
      )}

      {/* ── C. שלבי ביצוע ── */}
      {steps.length > 0 && (
        <div className="card-base p-5">
          <h2 className="text-[13px] font-semibold text-foreground mb-3 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary opacity-60" />
            שלבי ביצוע
          </h2>
          <div className="space-y-2">
            {steps.map((step, i) => (
              <button
                key={i}
                onClick={() => toggle(i)}
                className="w-full flex items-start gap-3 p-2.5 rounded-lg hover:bg-secondary/40 transition-colors text-right group"
              >
                {checks[i]
                  ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                  : <Circle className="w-4 h-4 text-border flex-shrink-0 mt-0.5 group-hover:text-foreground-muted transition-colors" />}
                <div className="flex-1 min-w-0">
                  <span className={`text-[11px] font-medium leading-snug ${checks[i] ? 'line-through text-foreground-muted' : 'text-foreground'}`}>
                    {i + 1}. {step}
                  </span>
                </div>
              </button>
            ))}
          </div>
          {steps.length > 0 && (
            <p className="text-[10px] text-foreground-muted mt-2">
              {checks.filter(Boolean).length} / {steps.length} שלבים הושלמו · נשמר מקומית
            </p>
          )}
        </div>
      )}

      {/* ── D. מעקב סטטוס ── */}
      <div className="card-base p-5">
        <h2 className="text-[13px] font-semibold text-foreground mb-4 flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary opacity-60" />
          מעקב סטטוס
        </h2>
        <StatusTimeline status={status} isActedOn={isActedOn} />
        <div className="flex items-center gap-3 mt-5 flex-wrap">
          {!isActedOn && (
            <button
              onClick={() => completeMutation.mutate()}
              disabled={completeMutation.isPending}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-white text-[12px] font-semibold hover:opacity-90 transition-all disabled:opacity-50"
            >
              {completeMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <CheckCheck className="w-3.5 h-3.5" />}
              סמן כהושלם
            </button>
          )}
          {isActedOn && (
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-green-600">
              <CheckCheck className="w-4 h-4" /> הושלם
            </span>
          )}
          <button
            onClick={() => {
              const params = new URLSearchParams({
                from_insight: id,
                title: title,
                desc: description || '',
                priority: priority === 'critical' ? 'critical' : priority === 'high' ? 'high' : 'medium',
              });
              navigate(`/tasks?${params.toString()}`);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-border bg-white text-[12px] font-medium text-foreground hover:bg-secondary/30 transition-all"
          >
            <ClipboardList className="w-3.5 h-3.5" />
            המר למשימה
          </button>
        </div>
      </div>

      {/* ── E. תובנות קשורות ── */}
      {relatedAlerts.length > 0 && (
        <div className="card-base p-5">
          <h2 className="text-[13px] font-semibold text-foreground mb-3">תובנות קשורות</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {relatedAlerts.map(rel => (
              <RelatedCard
                key={rel.id}
                item={rel}
                onClick={() => navigate(`/insights/alert-${rel.id}`)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
