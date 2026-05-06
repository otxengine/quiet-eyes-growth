import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { AlertTriangle } from 'lucide-react';
import { useScanQuota } from '@/lib/useScanQuota';
import { PLAN_LABELS } from '@/lib/usePlan';

import DailyFocus from '@/components/dashboard/DailyFocus';
import KpiStrip from '@/components/dashboard/KpiStrip';
import MorningBriefing from '@/components/dashboard/MorningBriefing';
import MarketIntelColumn from '@/components/dashboard/MarketIntelColumn';
import SentimentVelocityCard from '@/components/dashboard/SentimentVelocityCard';
import AutoActionsPanel from '@/components/dashboard/AutoActionsPanel';
import ScanOverlay from '@/components/dashboard/ScanOverlay';

export default function Dashboard() {
  const { businessProfile } = useOutletContext();
  const queryClient = useQueryClient();
  const bpId = businessProfile?.id;
  const [showScan, setShowScan] = useState(false);
  const scanQuota = useScanQuota(bpId);

  // Core data queries
  const { data: allSignals = [] } = useQuery({
    queryKey: ['allSignals', bpId],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId }, '-detected_at', 50),
    enabled: !!bpId,
  });

  const { data: competitors = [] } = useQuery({
    queryKey: ['competitors', bpId],
    queryFn: () => base44.entities.Competitor.filter({ linked_business: bpId }),
    enabled: !!bpId,
  });

  const { data: allReviews = [] } = useQuery({
    queryKey: ['allReviews', bpId],
    queryFn: () => base44.entities.Review.filter({ linked_business: bpId }, '-created_date', 50),
    enabled: !!bpId,
  });

  const { data: allLeads = [] } = useQuery({
    queryKey: ['allLeads', bpId],
    queryFn: () => base44.entities.Lead.filter({ linked_business: bpId }, '-score', 50),
    enabled: !!bpId,
  });

  const { data: pendingActions = [] } = useQuery({
    queryKey: ['autoActionsPending', bpId],
    queryFn: () => base44.entities.AutoAction
      ? base44.entities.AutoAction.filter({ linked_business: bpId, status: 'pending' }, '-created_date', 10)
      : Promise.resolve([]),
    enabled: !!bpId,
  });

  // Computed stats for KpiStrip
  const pendingReviews   = allReviews.filter(r => r.response_status === 'pending');
  const hotLeads         = allLeads.filter(l => l.status === 'hot');
  const unreadSignals    = allSignals.filter(s => !s.is_read);
  const thisMonth        = new Date().toISOString().slice(0, 7);
  const closedThisMonth  = allLeads.filter(l =>
    (l.lifecycle_stage === 'closed_won' || l.status === 'completed') &&
    (l.closed_at || l.created_at || '').startsWith(thisMonth)
  );
  const monthRevenue = closedThisMonth.reduce((sum, l) => sum + (l.closed_value || l.total_value || 0), 0);

  const stats = {
    pendingReviews: pendingReviews.length,
    negativeReviews: pendingReviews.filter(r => r.sentiment === 'negative' || (r.rating && r.rating <= 2)).length,
    hotLeads: hotLeads.length,
    unreadSignals: unreadSignals.length,
    highImpactSignals: unreadSignals.filter(s => s.impact_level === 'high').length,
    competitorChanges: competitors.filter(c => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
      return c.price_changed_at && c.price_changed_at >= weekAgo;
    }).length,
    monthRevenue,
  };

  const refreshAll = () => {
    ['allSignals','competitors','allReviews','allLeads','morningBriefing','autoActionsPending'].forEach(k =>
      queryClient.invalidateQueries({ queryKey: [k] })
    );
  };

  // Expose scan trigger for TopBar
  React.useEffect(() => {
    window.__quieteyes_scan = () => {
      if (scanQuota.isExhausted) {
        import('sonner').then(({ toast }) =>
          toast.error(`הגעת למגבלת הסריקות של תוכנית ${PLAN_LABELS[scanQuota.plan]} (${scanQuota.quota}/חודש). שדרג כדי להמשיך.`, { duration: 5000 })
        );
        return;
      }
      setShowScan(true);
    };
    return () => { delete window.__quieteyes_scan; };
  }, [scanQuota.isExhausted, scanQuota.plan, scanQuota.quota]);

  return (
    <div className="flex flex-col">
      {/* Quota warnings */}
      {scanQuota.isExhausted && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-2.5 text-[12px] text-amber-800">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>מגבלת הסריקות של תוכנית <strong>{PLAN_LABELS[scanQuota.plan]}</strong> הגיעה לקצה ({scanQuota.quota} סריקות/חודש).</span>
          <a href="/subscription" className="mr-auto font-semibold text-amber-700 underline underline-offset-2">שדרג תוכנית &rarr;</a>
        </div>
      )}
      {!scanQuota.isExhausted && scanQuota.quota !== Infinity && scanQuota.pctUsed >= 75 && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-blue-50 border border-blue-200 flex items-center gap-2 text-[11px] text-blue-700">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>השתמשת ב-{scanQuota.scansThisMonth} מתוך {scanQuota.quota} סריקות החודש. נשארו {scanQuota.remaining}.</span>
        </div>
      )}

      {/* KPI strip — 4 clickable numbers */}
      <KpiStrip stats={stats} />

      {/* Hero: action-oriented to-do list */}
      <DailyFocus
        reviews={allReviews}
        leads={allLeads}
        signals={allSignals}
        competitors={competitors}
        pendingActions={pendingActions}
      />

      {/* Morning briefing — collapsible AI summary */}
      <MorningBriefing businessProfile={businessProfile} stats={stats} />

      {/* Auto-actions needing approval */}
      <AutoActionsPanel bpId={bpId} />

      {/* Bottom two-column: market intel + sentiment */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MarketIntelColumn signals={allSignals} />
        <SentimentVelocityCard bpId={bpId} />
      </div>

      {/* Scan Overlay */}
      {showScan && (
        <ScanOverlay
          businessProfile={businessProfile}
          onComplete={() => { setShowScan(false); refreshAll(); }}
          onClose={() => setShowScan(false)}
        />
      )}
    </div>
  );
}
