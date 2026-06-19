import React, { useState, useMemo } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import StatCards from '@/components/shared/StatCards';
import UrgentActionsSection from '@/components/shared/UrgentActionsSection';
import DataTable from '@/components/shared/DataTable';

const TYPE_META = {
  action_needed:       { label: 'פעולה נדרשת',    color: 'text-red-600',    bg: 'bg-red-50' },
  negative_review:     { label: 'ביקורת שלילית',  color: 'text-red-600',    bg: 'bg-red-50' },
  opportunity:         { label: 'הזדמנות',         color: 'text-green-600',  bg: 'bg-green-50' },
  market_opportunity:  { label: 'הזדמנות שוק',    color: 'text-green-600',  bg: 'bg-green-50' },
  risk:                { label: 'סיכון',           color: 'text-amber-600',  bg: 'bg-amber-50' },
  retention_risk:      { label: 'סיכון שימור',    color: 'text-amber-600',  bg: 'bg-amber-50' },
  competitor_move:     { label: 'מהלך מתחרה',     color: 'text-violet-600', bg: 'bg-violet-50' },
  trend_opportunity:   { label: 'טרנד עולה',       color: 'text-purple-600', bg: 'bg-purple-50' },
  hot_lead:            { label: 'ליד חם',          color: 'text-amber-600',  bg: 'bg-amber-50' },
  reputation_risk:     { label: 'סיכון מוניטין',   color: 'text-red-600',    bg: 'bg-red-50' },
  demand_gap:          { label: 'פער ביקוש',       color: 'text-cyan-600',   bg: 'bg-cyan-50' },
  content_opportunity: { label: 'תוכן לפרסום',    color: 'text-rose-600',   bg: 'bg-rose-50' },
  campaign_opportunity:{ label: 'הזדמנות קמפיין', color: 'text-purple-600', bg: 'bg-purple-50' },
};

const VALUE_MAP = {
  high:     { label: 'גבוה',   color: 'text-green-700',  bg: 'bg-green-50' },
  critical: { label: 'קריטי',  color: 'text-red-700',    bg: 'bg-red-50' },
  medium:   { label: 'בינוני', color: 'text-amber-700',  bg: 'bg-amber-50' },
  low:      { label: 'נמוך',   color: 'text-gray-500',   bg: 'bg-gray-50' },
};

const CATEGORY_MAP = {
  risk:        'סיכון',
  opportunity: 'הזדמנות',
  trend:       'טרנד',
  competitor:  'מתחרה',
  lead:        'ליד',
  content:     'תוכן',
};

const COLUMNS = [
  { key: 'title',    label: 'תובנה' },
  { key: 'value',    label: 'ערך עסקי' },
  { key: 'category', label: 'קטגוריה' },
  { key: 'action',   label: 'פעולה' },
];

function classifyCategory(item) {
  const t = item.type || '';
  if (t.includes('risk') || t.includes('negative') || t.includes('reputation')) return 'risk';
  if (t.includes('opportunity') || t.includes('demand') || t.includes('campaign')) return 'opportunity';
  if (t.includes('trend') || t.includes('social') || t.includes('viral')) return 'trend';
  if (t.includes('competitor')) return 'competitor';
  if (t.includes('lead')) return 'lead';
  if (t.includes('content')) return 'content';
  return 'opportunity';
}

export default function Insights() {
  const { businessProfile } = useOutletContext();
  const navigate = useNavigate();
  const bpId = businessProfile?.id;

  const { data: alerts = [], isLoading: loadingAlerts } = useQuery({
    queryKey: ['proactiveAlerts', bpId],
    queryFn: () => base44.entities.ProactiveAlert.filter({ linked_business: bpId }, '-created_at', 100),
    enabled: !!bpId,
  });

  const { data: signals = [], isLoading: loadingSignals } = useQuery({
    queryKey: ['allSignals', bpId],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId }, '-detected_at', 50),
    enabled: !!bpId,
  });

  const isLoading = loadingAlerts || loadingSignals;

  // Merge alerts + signals into unified rows
  const rows = useMemo(() => {
    const alertRows = alerts.filter(a => a.status !== 'dismissed').map(a => ({
      id: a.id,
      kind: 'alert',
      type: a.alert_type || 'action_needed',
      title: a.title || a.message || '',
      summary: a.message || '',
      impact: a.priority || 'medium',
      raw: a,
    }));
    const signalRows = signals.filter(s => !s.is_dismissed).map(s => ({
      id: s.id,
      kind: 'signal',
      type: s.signal_type || 'opportunity',
      title: s.title || s.summary || '',
      summary: s.summary || '',
      impact: s.impact_level || 'medium',
      raw: s,
    }));
    // Sort: critical/high first
    const all = [...alertRows, ...signalRows];
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return all.sort((a, b) => (order[a.impact] ?? 2) - (order[b.impact] ?? 2));
  }, [alerts, signals]);

  const risks       = rows.filter(r => classifyCategory(r) === 'risk');
  const opps        = rows.filter(r => classifyCategory(r) === 'opportunity');
  const urgentRows  = rows.filter(r => r.impact === 'critical' || r.impact === 'high');
  const trendRows   = rows.filter(r => classifyCategory(r) === 'trend');

  const statCards = [
    { count: risks.length,      label: 'סיכונים',             borderColor: 'red' },
    { count: urgentRows.length, label: 'דורש פעולה מיידית',   borderColor: 'yellow' },
    { count: opps.length,       label: 'הזדמניות',            borderColor: 'blue' },
    { count: trendRows.length,  label: 'מגמות וטרנדים',       borderColor: 'none' },
  ];

  const urgentActions = urgentRows.slice(0, 2).map(r => ({
    title: r.title.slice(0, 60),
    description: r.summary?.slice(0, 80),
    ctaLabel: 'טפל עכשיו',
    onCta: () => navigate(`/insights/${r.id}?kind=${r.kind}`),
  }));

  const getTypeMeta = (type) => TYPE_META[type] || { label: type, color: 'text-foreground-secondary', bg: 'bg-gray-50' };
  const getValueMeta = (impact) => VALUE_MAP[impact] || VALUE_MAP.medium;

  return (
    <div className="space-y-5">
      <PageHeader
        count={rows.length}
        title="תובנות"
      />

      <StatCards cards={statCards} />

      {urgentActions.length > 0 && (
        <UrgentActionsSection actions={urgentActions} />
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
        </div>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          emptyText="אין תובנות עדיין — הסוכן יזהה הזדמנויות וסיכונים אוטומטית"
          renderCell={(row, col) => {
            if (col.key === 'title') return (
              <div>
                <div className="font-medium text-foreground text-sm">{row.title}</div>
                {row.summary && row.summary !== row.title && (
                  <div className="text-xs text-foreground-muted mt-0.5 line-clamp-1">{row.summary}</div>
                )}
              </div>
            );
            if (col.key === 'value') {
              const vm = getValueMeta(row.impact);
              return (
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${vm.bg} ${vm.color}`}>
                  {vm.label}
                </span>
              );
            }
            if (col.key === 'category') {
              const cat = classifyCategory(row);
              const tm = getTypeMeta(row.type);
              return (
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${tm.bg} ${tm.color}`}>
                  {CATEGORY_MAP[cat] || tm.label}
                </span>
              );
            }
            if (col.key === 'action') return (
              <button
                onClick={() => navigate(`/insights/${row.id}?kind=${row.kind}`)}
                className="text-xs font-semibold text-[#e8344d] hover:underline"
              >
                פעולה &rarr;
              </button>
            );
            return null;
          }}
        />
      )}

      {/* Upgrade Banner */}
      <div
        className="rounded-2xl p-5 flex items-center justify-between gap-4"
        style={{ background: 'linear-gradient(135deg, #fce4ec 0%, #e1bee7 100%)' }}
      >
        <div>
          <div className="font-semibold text-sm text-foreground">המערכת יכולה לזהות יותר עבורך</div>
          <div className="text-xs text-foreground-secondary mt-0.5">שדרג לפתיחת ניתוח מתקדם של תובנות</div>
        </div>
        <button
          onClick={() => navigate('/subscription')}
          className="flex-shrink-0 bg-[#e8344d] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#c92b40] transition-colors shadow-sm"
        >
          גלה הזדמנויות
        </button>
      </div>
    </div>
  );
}
