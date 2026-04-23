import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { AlertTriangle } from 'lucide-react';

import OrchestratorPanel from '@/components/OrchestratorPanel';
import MorningBriefing from '@/components/dashboard/MorningBriefing';
import ContextStatCards from '@/components/dashboard/ContextStatCards';
import UrgentActions from '@/components/dashboard/UrgentActions';
import MarketIntelColumn from '@/components/dashboard/MarketIntelColumn';
import QuickLookColumn from '@/components/dashboard/QuickLookColumn';
import BottomActionBar from '@/components/dashboard/BottomActionBar';
import ScanOverlay from '@/components/dashboard/ScanOverlay';

export default function Dashboard() {
  const { businessProfile } = useOutletContext();
  const queryClient = useQueryClient();
  const bpId = businessProfile?.id;
  const [showScan, setShowScan] = useState(false);

  // Check if agents ran recently
  const { data: recentLogs = [] } = useQuery({
    queryKey: ['recentAutomationLogs', bpId],
    queryFn: () => base44.entities.AutomationLog.filter({ linked_business: bpId }, '-start_time', 1),
    enabled: !!bpId,
  });
  const eightHoursAgo = new Date(Date.now() - 8 * 3600000).toISOString();
  const agentsStale = recentLogs.length === 0 || (recentLogs[0]?.start_time || '') < eightHoursAgo;

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

  const { data: weeklyReports = [] } = useQuery({
    queryKey: ['weeklyReport', bpId],
    queryFn: () => base44.entities.WeeklyReport.filter({ linked_business: bpId }, '-created_date', 1),
    enabled: !!bpId,
  });

  // Computed stats
  const pendingReviews = allReviews.filter(r => r.response_status === 'pending');
  const negativeReviews = pendingReviews.filter(r => r.sentiment === 'negative' || (r.rating && r.rating <= 2));
  const hotLeads = allLeads.filter(l => l.status === 'hot');
  const todayStr = new Date().toISOString().split('T')[0];
  const thisMonth = new Date().toISOString().slice(0, 7);
  const newLeadsToday = allLeads.filter(l => (l.created_at || l.created_date || '').startsWith(todayStr));
  const unreadSignals = allSignals.filter(s => !s.is_read);
  const highImpactSignals = unreadSignals.filter(s => s.impact_level === 'high');
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const competitorChanges = competitors.filter(c => c.price_changed_at && c.price_changed_at >= weekAgo);
  const closedThisMonth = allLeads.filter(l =>
    (l.lifecycle_stage === 'closed_won' || l.status === 'completed') &&
    (l.closed_at || l.created_at || '').startsWith(thisMonth)
  );
  const monthRevenue = closedThisMonth.reduce((sum, l) => sum + (l.closed_value || l.total_value || 0), 0);

  const stats = {
    pendingReviews: pendingReviews.length,
    negativeReviews: negativeReviews.length,
    hotLeads: hotLeads.length,
    newLeadsToday: newLeadsToday.length,
    unreadSignals: unreadSignals.length,
    highImpactSignals: highImpactSignals.length,
    competitorChanges: competitorChanges.length,
    totalCompetitors: competitors.length,
    totalReviews: allReviews.length,
    totalLeads: allLeads.length,
    monthRevenue,
    closedThisMonth: closedThisMonth.length,
  };

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['allSignals'] });
    queryClient.invalidateQueries({ queryKey: ['competitors'] });
    queryClient.invalidateQueries({ queryKey: ['allReviews'] });
    queryClient.invalidateQueries({ queryKey: ['allLeads'] });
    queryClient.invalidateQueries({ queryKey: ['morningBriefing'] });
    queryClient.invalidateQueries({ queryKey: ['weeklyReport'] });
    queryClient.invalidateQueries({ queryKey: ['unreadSignals'] });
    queryClient.invalidateQueries({ queryKey: ['hotLeads'] });
    queryClient.invalidateQueries({ queryKey: ['pendingReviews'] });
  };

  // Expose scan trigger for TopBar
  React.useEffect(() => {
    window.__quieteyes_scan = () => setShowScan(true);
    return () => { delete window.__quieteyes_scan; };
  }, []);

  return (
    <div className="flex flex-col">
      {/* Stale agents warning — hidden per UX spec */}
      {/* {agentsStale && (...)} */}

      {/* OTX Orchestrator status strip */}
      <OrchestratorPanel />

      {/* ROW 1: Morning Briefing */}
      <MorningBriefing businessProfile={businessProfile} stats={stats} />

      {/* ROW 2: Stat Cards with Context */}
      <ContextStatCards stats={stats} />

      {/* ROW 3: Three Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <UrgentActions
          reviews={allReviews}
          leads={allLeads}
          signals={allSignals}
          competitors={competitors}
        />
        <MarketIntelColumn signals={allSignals} />
        <QuickLookColumn
          competitors={competitors}
          leads={allLeads}
          reviews={allReviews}
        />
      </div>

      {/* ROW 4: Bottom Action Bar */}
      <BottomActionBar stats={stats} hasWeeklyReport={weeklyReports.length > 0} />

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