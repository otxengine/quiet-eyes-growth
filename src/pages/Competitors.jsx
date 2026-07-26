import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { getLimits } from '@/lib/planConfig';
import PageHeader from '@/components/shared/PageHeader';
import StatCards from '@/components/shared/StatCards';
import StrategicAnalysisPanel from '@/components/competitors/StrategicAnalysisPanel';
import CompetitorDetailCard from '@/components/competitors/CompetitorDetailCard';
import ActionPopup from '@/components/ui/ActionPopup';


function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return 'היום';
  if (d === 1) return 'אתמול';
  if (d < 30)  return `לפני ${d} ימים`;
  return `לפני ${Math.floor(d / 30)} חודשים`;
}


async function fetchCompetitorChanges(bpId) {
  const [signals, alerts] = await Promise.all([
    base44.entities.MarketSignal.filter({ linked_business: bpId, category: 'competitor_move' }, '-detected_at', 20).catch(() => []),
    base44.entities.ProactiveAlert.filter(
      { linked_business: bpId, alert_type: { in: ['competitor_move', 'competitor_intel', 'competitor_attack'] }, is_dismissed: false },
      '-created_at', 10
    ).catch(() => []),
  ]);
  return [...signals.map(s => ({ id: s.id, title: s.title || s.summary || '', summary: s.summary || '', detected_at: s.detected_at, kind: 'signal' })),
          ...alerts.map(a => ({ id: a.id, title: a.title || '', summary: a.description || '', detected_at: a.created_at, kind: 'alert' }))].slice(0, 10);
}

export default function Competitors() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const plan = businessProfile?.plan || 'free_trial';
  const queryClient = useQueryClient();
  const [scanning, setScanning] = useState(false);
  const [selectedCompetitorId, setSelectedCompetitorId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newComp, setNewComp] = useState({ name: '', category: '', address: '' });
  const [adding, setAdding] = useState(false);
  const [selectedMove, setSelectedMove] = useState(null);

  const { data: competitors = [], isLoading } = useQuery({
    queryKey: ['competitorsPage', bpId],
    queryFn: () => base44.entities.Competitor.filter({ linked_business: bpId, is_dismissed: false, not_relevant: false }),
    enabled: !!bpId,
  });

  const planLimits = getLimits(plan);
  const atCap = planLimits.competitors_max !== Infinity && competitors.length >= planLimits.competitors_max;

  const { data: reviews = [] } = useQuery({
    queryKey: ['competitorsReviews', bpId],
    queryFn: () => base44.entities.Review.filter({ linked_business: bpId }),
    enabled: !!bpId,
  });

  const { data: changes = [] } = useQuery({
    queryKey: ['competitorChanges', bpId],
    queryFn: () => fetchCompetitorChanges(bpId),
    enabled: !!bpId,
  });

  const handleAdd = async () => {
    if (!newComp.name.trim()) return;
    if (atCap) { toast.error(`הגעת למכסת ${planLimits.competitors_max} מתחרים בתוכנית שלך`); return; }
    setAdding(true);
    try {
      await base44.entities.Competitor.create({ ...newComp, linked_business: bpId });
      queryClient.invalidateQueries({ queryKey: ['competitorsPage', bpId] });
      setNewComp({ name: '', category: '', address: '' });
      setShowAdd(false);
      toast.success('מתחרה נוסף');
    } catch { toast.error('שגיאה בהוספת מתחרה'); }
    setAdding(false);
  };

  const handleDelete = async (id) => {
    await base44.entities.Competitor.delete(id);
    queryClient.invalidateQueries({ queryKey: ['competitorsPage', bpId] });
    toast.success('מתחרה הוסר');
  };

  const handleScan = async () => {
    setScanning(true);
    toast.info('מתחיל סריקת מתחרים...');
    try {
      await base44.functions.invoke('runCompetitorIdentification', { businessProfileId: bpId });
      queryClient.invalidateQueries({ queryKey: ['competitorsPage', bpId] });
      queryClient.invalidateQueries({ queryKey: ['competitorChanges', bpId] });
      toast.success('סריקת מתחרים הושלמה');
    } catch { toast.error('שגיאה בסריקת מתחרים'); }
    setScanning(false);
  };

  const avgRating = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / reviews.length
    : null;

  const risingCount   = competitors.filter(c => c.trend === 'rising'   || c.trend_direction === 'up').length;
  const decliningCount= competitors.filter(c => c.trend === 'declining' || c.trend_direction === 'down').length;

  const statCards = [
    { count: competitors.length, label: 'סה"כ מתחרים',   borderColor: 'blue' },
    { count: risingCount,        label: 'מגמת עלייה',     borderColor: 'none' },
    { count: decliningCount,     label: 'מגמת ירידה',     borderColor: 'yellow' },
    { count: avgRating ? avgRating.toFixed(1) : '—', label: 'הדירוג שלי', borderColor: 'none' },
  ];

  const topChange = changes[0];
  const activityChanges = changes.slice(1, 4);

  const inputCls = "w-full bg-secondary border border-border rounded-lg px-3 py-2 text-[12px] text-foreground placeholder-foreground-muted focus:outline-none focus:border-primary/30";

  return (
    <div className="space-y-5">
      <PageHeader
        count={competitors.length}
        title="מתחרים"
        actionLabel={scanning ? 'סורק...' : 'סרוק מתחרים'}
        actionIcon={scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        onAction={handleScan}
      />

      <StatCards cards={statCards} />

      {/* Add competitor / cap message */}
      {atCap ? (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          הגעת למכסת {planLimits.competitors_max} מתחרים בתוכנית שלך — שדרג כדי להוסיף עוד
        </p>
      ) : (
        <>
          <button
            onClick={() => setShowAdd(v => !v)}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:opacity-80 transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" /> הוסף מתחרה ידנית
          </button>
          {showAdd && (
            <div className="p-4 rounded-xl bg-secondary/50 border border-border space-y-2">
              <input value={newComp.name}     onChange={e => setNewComp({ ...newComp, name:     e.target.value })} placeholder="שם המתחרה *" className={inputCls} />
              <div className="grid grid-cols-2 gap-2">
                <input value={newComp.category} onChange={e => setNewComp({ ...newComp, category: e.target.value })} placeholder="קטגוריה"  className={inputCls} />
                <input value={newComp.address}  onChange={e => setNewComp({ ...newComp, address:  e.target.value })} placeholder="כתובת"    className={inputCls} />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-[11px] text-foreground-muted hover:text-foreground transition-colors">ביטול</button>
                <button onClick={handleAdd} disabled={adding || !newComp.name.trim()} className="px-3 py-1.5 text-[11px] font-medium bg-primary text-white rounded-lg hover:opacity-90 disabled:opacity-50">
                  {adding ? 'מוסיף...' : 'הוסף'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* מהלכי מתחרים */}
      {(topChange || activityChanges.length > 0) && (
        <div className="mb-2">
          <h3 className="text-sm font-bold text-foreground-secondary mb-3 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500 inline-block" />
            מהלכי מתחרים
          </h3>
          <div className="space-y-3">
            {/* Large gradient insight card */}
            {topChange && (
              <div
                className="rounded-xl p-5"
                style={{ background: 'linear-gradient(135deg, #f3e5f5 0%, #e8eaf6 100%)' }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-violet-600">עדכון אחרון</div>
                  {topChange.detected_at && <span className="text-[10px] text-foreground-muted">{timeAgo(topChange.detected_at)}</span>}
                </div>
                <div className="font-semibold text-sm text-foreground mb-1">{topChange.title}</div>
                {topChange.summary && topChange.summary !== topChange.title && (
                  <div className="text-xs text-foreground-secondary mb-3">{topChange.summary}</div>
                )}
                <button
                  onClick={() => setSelectedMove(topChange)}
                  className="text-[11px] font-medium text-violet-600 hover:text-violet-800 bg-white/60 hover:bg-white rounded-lg px-3 py-1.5 transition-colors"
                >
                  ⚡ פעל על זה
                </button>
              </div>
            )}
            {/* 3 activity cards */}
            {activityChanges.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {activityChanges.map((c, i) => (
                  <div key={i} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <div className="font-medium text-xs text-foreground line-clamp-2">{c.title}</div>
                      {c.detected_at && <span className="text-[10px] text-foreground-muted flex-shrink-0">{timeAgo(c.detected_at)}</span>}
                    </div>
                    {c.summary && <div className="text-[10px] text-foreground-muted line-clamp-1">{c.summary}</div>}
                    <button
                      onClick={() => setSelectedMove(c)}
                      className="mt-2 text-[10px] text-violet-600 hover:text-violet-800 font-medium transition-colors"
                    >
                      פעל ←
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
        </div>
      ) : competitors.length === 0 ? (
        <p className="text-center text-sm text-foreground-muted py-12">אין מתחרים — הוסף מתחרים ידנית או הפעל סריקה</p>
      ) : (
        <div className="space-y-2">
          {competitors.map(comp => (
            <CompetitorDetailCard
              key={comp.id}
              competitor={comp}
              businessName={businessProfile?.name}
              businessProfileId={bpId}
              otxBizId={bpId}
              intelChanges={changes}
              onDelete={handleDelete}
              onDismissed={() => queryClient.invalidateQueries({ queryKey: ['competitorsPage', bpId] })}
              onDeepAnalysis={id => setSelectedCompetitorId(v => v === id ? null : id)}
            />
          ))}
        </div>
      )}

      {selectedCompetitorId && (() => {
        const comp = competitors.find(c => c.id === selectedCompetitorId);
        if (!comp) return null;
        return (
          <StrategicAnalysisPanel
            competitor={comp}
            businessProfile={businessProfile}
            competitors={competitors}
            signals={changes}
            onClose={() => setSelectedCompetitorId(null)}
          />
        );
      })()}

      {selectedMove && (
        <ActionPopup
          signal={{
            id: selectedMove.id,
            summary: selectedMove.summary || selectedMove.title,
            recommended_action: selectedMove.title,
            category: 'competitor_move',
            impact_level: 'medium',
            source_description: JSON.stringify({
              action_type: 'competitor_response',
              action_label: 'תגובה לשינוי מתחרה',
              urgency_hours: 48,
              impact_reason: selectedMove.title,
            }),
          }}
          businessProfile={businessProfile}
          onClose={() => setSelectedMove(null)}
        />
      )}
    </div>
  );
}
