import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { AlertTriangle } from 'lucide-react';
import { useScanQuota } from '@/lib/useScanQuota';
import { PLAN_LABELS } from '@/lib/usePlan';

import DashboardHeader from '@/components/dashboard/DashboardHeader';
import DailyFocus from '@/components/dashboard/DailyFocus';
import MorningBriefing from '@/components/dashboard/MorningBriefing';
import MarketIntelColumn from '@/components/dashboard/MarketIntelColumn';
import SentimentVelocityCard from '@/components/dashboard/SentimentVelocityCard';
import AutoActionsPanel from '@/components/dashboard/AutoActionsPanel';
import ScanOverlay from '@/components/dashboard/ScanOverlay';
import HealthScoreCard from '@/components/dashboard/HealthScoreCard';

export default function Dashboard() {
  const { businessProfile } = useOutletContext();
  const queryClient = useQueryClient();
  const bpId = businessProfile?.id;
  const [showScan, setShowScan] = useState(false);
  const scanQuota = useScanQuota(bpId);

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

  // Computed stats
  const pendingReviews   = allReviews.filter(r => r.response_status === 'pending');
  const negativeReviews  = pendingReviews.filter(r => r.sentiment === 'negative' || (r.rating && r.rating <= 2));
  const hotLeads         = allLeads.filter(l => l.status === 'hot');
  const unreadSignals    = allSignals.filter(s => !s.is_read);
  const thisMonth        = new Date().toISOString().slice(0, 7);
  const weekAgo          = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
  const closedThisMonth  = allLeads.filter(l =>
    (l.lifecycle_stage === 'closed_won' || l.status === 'completed') &&
    (l.closed_at || l.created_at || '').startsWith(thisMonth)
  );
  const monthRevenue = closedThisMonth.reduce((sum, l) => sum + (l.closed_value || l.total_value || 0), 0);
  const competitorChanges = competitors.filter(c => c.price_changed_at && c.price_changed_at >= weekAgo);

  const stats = {
    pendingReviews:    pendingReviews.length,
    negativeReviews:   negativeReviews.length,
    hotLeads:          hotLeads.length,
    unreadSignals:     unreadSignals.length,
    highImpactSignals: unreadSignals.filter(s => s.impact_level === 'high').length,
    competitorChanges: competitorChanges.length,
    monthRevenue,
    closedThisMonth:   closedThisMonth.length,
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

  const refreshAll = () => {
    ['allSignals', 'competitors', 'allReviews', 'allLeads', 'morningBriefing'].forEach(k =>
      queryClient.invalidateQueries({ queryKey: [k] })
    );
  };

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

      {/* ── Hero header: greeting + score + 4 KPIs ─────────────────────── */}
      <DashboardHeader businessProfile={businessProfile} stats={stats} />

      {/* ── Main 2-col layout ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

        {/* LEFT: action to-do list */}
        <div className="lg:col-span-7">
          <DailyFocus
            reviews={allReviews}
            leads={allLeads}
            signals={allSignals}
            competitors={competitors}
            pendingActions={[]}
            bpId={bpId}
          />
          {/* Auto-actions below focus list on left */}
          <AutoActionsPanel bpId={bpId} />
        </div>

        {/* RIGHT: intelligence panel */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <HealthScoreCard businessProfileId={bpId} />
          <MorningBriefing businessProfile={businessProfile} stats={stats} />
          <MarketIntelColumn signals={allSignals} />
          <SentimentVelocityCard bpId={bpId} />
        </div>
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
