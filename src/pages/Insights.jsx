import React, { useState } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Lightbulb, Zap, Target, TrendingUp, AlertTriangle, Trophy,
  ChevronLeft, Filter, CheckCircle2, Clock
} from 'lucide-react';

const ALERT_TYPE_META = {
  action_needed:      { label: 'פעולה נדרשת', color: 'text-red-600',    bg: 'bg-red-50',     border: 'border-red-100',    icon: Zap },
  negative_review:    { label: 'ביקורת שלילית', color: 'text-red-600',  bg: 'bg-red-50',     border: 'border-red-100',    icon: AlertTriangle },
  opportunity:        { label: 'הזדמנות',       color: 'text-green-600', bg: 'bg-green-50',   border: 'border-green-100',  icon: Target },
  market_opportunity: { label: 'הזדמנות שוק',  color: 'text-green-600', bg: 'bg-green-50',   border: 'border-green-100',  icon: TrendingUp },
  risk:               { label: 'סיכון',         color: 'text-amber-600', bg: 'bg-amber-50',   border: 'border-amber-100',  icon: AlertTriangle },
  retention_risk:     { label: 'סיכון שימור',  color: 'text-amber-600', bg: 'bg-amber-50',   border: 'border-amber-100',  icon: AlertTriangle },
  competitor_move:    { label: 'מהלך מתחרה',   color: 'text-indigo-600',bg: 'bg-indigo-50',  border: 'border-indigo-100', icon: Trophy },
  milestone:          { label: 'אבן דרך',       color: 'text-purple-600',bg: 'bg-purple-50',  border: 'border-purple-100', icon: Trophy },
  hot_lead:           { label: 'ליד חם',        color: 'text-amber-600', bg: 'bg-amber-50',   border: 'border-amber-100',  icon: Zap },
};

const ACTION_STATUS_META = {
  proposed:    { label: 'מוצע',     color: 'text-blue-600',   bg: 'bg-blue-50',   icon: Lightbulb },
  in_progress: { label: 'בביצוע',  color: 'text-amber-600',  bg: 'bg-amber-50',  icon: Clock },
  completed:   { label: 'הושלם',   color: 'text-green-600',  bg: 'bg-green-50',  icon: CheckCircle2 },
};

const PRIORITY_BADGE = {
  critical: { label: 'קריטי', color: 'text-red-700',    bg: 'bg-red-100' },
  high:     { label: 'גבוה',  color: 'text-orange-700', bg: 'bg-orange-100' },
  medium:   { label: 'בינוני',color: 'text-yellow-700', bg: 'bg-yellow-100' },
  low:      { label: 'נמוך',  color: 'text-gray-600',   bg: 'bg-gray-100' },
};

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function InsightCard({ item, onOpen }) {
  const typeMeta = ALERT_TYPE_META[item.type] || ALERT_TYPE_META.action_needed;
  const Icon = typeMeta.icon;
  const priorityMeta = PRIORITY_BADGE[item.priority] || PRIORITY_BADGE.medium;
  const statusMeta = item.statusLabel
    ? (ACTION_STATUS_META[item.rawStatus] || ACTION_STATUS_META.proposed)
    : null;

  return (
    <div className={`rounded-xl border ${typeMeta.border} ${typeMeta.bg} p-4 hover:shadow-sm transition-all duration-150`}>
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-white border ${typeMeta.border}`}>
          <Icon className={`w-4 h-4 ${typeMeta.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${typeMeta.bg} ${typeMeta.color} border ${typeMeta.border}`}>
              {typeMeta.label}
            </span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${priorityMeta.bg} ${priorityMeta.color}`}>
              {priorityMeta.label}
            </span>
            {statusMeta && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusMeta.bg} ${statusMeta.color}`}>
                {statusMeta.label}
              </span>
            )}
          </div>
          <p className="text-[13px] font-semibold text-foreground leading-snug mb-1">{item.title}</p>
          {item.description && (
            <p className="text-[11px] text-foreground-secondary leading-relaxed line-clamp-2">{item.description}</p>
          )}
          <div className="flex items-center justify-between mt-3">
            <span className="text-[10px] text-foreground-muted">
              {item.createdAt ? new Date(item.createdAt).toLocaleDateString('he-IL') : ''}
              {item.sourceAgent && ` · ${item.sourceAgent}`}
            </span>
            <button
              onClick={() => onOpen(item.navId)}
              className={`flex items-center gap-1 text-[11px] font-semibold ${typeMeta.color} hover:opacity-70 transition-all`}
            >
              פתח תובנה מלאה
              <ChevronLeft className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Insights() {
  const { businessProfile } = useOutletContext();
  const navigate = useNavigate();
  const bpId = businessProfile?.id;

  const [filterType, setFilterType]   = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const { data: alerts = [], isLoading: loadingAlerts } = useQuery({
    queryKey: ['proactiveAlerts', bpId, 'all'],
    queryFn: () => base44.entities.ProactiveAlert.filter({ linked_business: bpId, is_dismissed: false }, '-created_at', 50),
    enabled: !!bpId,
  });

  const { data: actions = [], isLoading: loadingActions } = useQuery({
    queryKey: ['actions', bpId, 'all'],
    queryFn: () => base44.entities.Action.filter({ linked_business: bpId }, '-created_date', 50),
    enabled: !!bpId,
  });

  const loading = loadingAlerts || loadingActions;

  // Normalize to unified list
  const unified = [
    ...alerts.map(a => ({
      id:          a.id,
      navId:       `alert-${a.id}`,
      kind:        'alert',
      title:       a.title,
      description: a.description,
      type:        a.alert_type || 'action_needed',
      priority:    a.priority || 'medium',
      rawStatus:   a.is_acted_on ? 'completed' : 'proposed',
      statusLabel: a.is_acted_on ? 'הושלם' : null,
      createdAt:   a.created_date || a.created_at,
      sourceAgent: null,
    })),
    ...actions.map(a => ({
      id:          a.id,
      navId:       `action-${a.id}`,
      kind:        'action',
      title:       a.title,
      description: a.description,
      type:        a.category || 'opportunity',
      priority:    a.priority || 'medium',
      rawStatus:   a.status || 'proposed',
      statusLabel: a.status,
      createdAt:   a.created_date || a.created_at,
      sourceAgent: a.source_agent,
    })),
  ].sort((a, b) => {
    const po = (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3);
    if (po !== 0) return po;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });

  const TYPE_OPTIONS = [
    { value: 'all',             label: 'כל הסוגים' },
    { value: 'action_needed',   label: 'פעולה נדרשת' },
    { value: 'opportunity',     label: 'הזדמנות' },
    { value: 'risk',            label: 'סיכון' },
    { value: 'milestone',       label: 'אבן דרך' },
  ];

  const STATUS_OPTIONS = [
    { value: 'all',         label: 'כל הסטטוסים' },
    { value: 'proposed',    label: 'מוצע' },
    { value: 'in_progress', label: 'בביצוע' },
    { value: 'completed',   label: 'הושלם' },
  ];

  const filtered = unified.filter(item => {
    if (filterType !== 'all') {
      // group-match: opportunity covers market_opportunity, risk covers retention_risk etc.
      const t = item.type;
      if (filterType === 'opportunity' && !t.includes('opportunity')) return false;
      if (filterType === 'risk'        && !t.includes('risk'))        return false;
      if (filterType !== 'opportunity' && filterType !== 'risk' && t !== filterType) return false;
    }
    if (filterStatus !== 'all' && item.rawStatus !== filterStatus) return false;
    return true;
  });

  const activeCount = unified.filter(i => i.rawStatus !== 'completed').length;

  return (
    <div className="max-w-3xl mx-auto space-y-5" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-primary opacity-70" />
          <h1 className="text-[18px] font-bold text-foreground">תובנות</h1>
          {activeCount > 0 && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-foreground text-background">
              {activeCount} פעילות
            </span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-foreground-muted flex-shrink-0" />
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="text-[11px] border border-border rounded-lg px-2 py-1 bg-white text-foreground focus:outline-none"
        >
          {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="text-[11px] border border-border rounded-lg px-2 py-1 bg-white text-foreground focus:outline-none"
        >
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {filtered.length !== unified.length && (
          <span className="text-[10px] text-foreground-muted">{filtered.length} מתוך {unified.length}</span>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Lightbulb className="w-10 h-10 text-foreground-muted opacity-30 mx-auto mb-3" />
          <p className="text-[13px] text-foreground-muted">אין תובנות תואמות לסינון שנבחר</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(item => (
            <InsightCard
              key={item.navId}
              item={item}
              onOpen={navId => navigate(`/insights/${navId}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
