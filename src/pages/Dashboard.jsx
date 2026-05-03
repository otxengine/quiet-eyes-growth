import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { parseLLMJson } from '@/lib/utils';
import { AlertTriangle, Database, BookOpen } from 'lucide-react';
import { useScanQuota } from '@/lib/useScanQuota';
import { PLAN_LABELS } from '@/lib/usePlan';

import OrchestratorPanel from '@/components/OrchestratorPanel';
import TodaysFocus from '@/components/dashboard/TodaysFocus';
import MorningBriefing from '@/components/dashboard/MorningBriefing';
import ContextStatCards from '@/components/dashboard/ContextStatCards';
import UrgentActions from '@/components/dashboard/UrgentActions';
import MarketIntelColumn from '@/components/dashboard/MarketIntelColumn';
import QuickLookColumn from '@/components/dashboard/QuickLookColumn';
import BottomActionBar from '@/components/dashboard/BottomActionBar';
import ScanOverlay from '@/components/dashboard/ScanOverlay';
import AutoActionsPanel from '@/components/dashboard/AutoActionsPanel';

const DATA_SOURCES = [
  { key: 'google',      label: 'Google Maps',  icon: '📍', always: true  },
  { key: 'facebook',    label: 'Facebook',     icon: '📘', always: true  },
  { key: 'instagram',   label: 'Instagram',    icon: '📸', always: true  },
  { key: 'wolt',        label: 'Wolt',         icon: '🛵', always: false },
  { key: 'tripadvisor', label: 'TripAdvisor',  icon: '🦉', always: false },
  { key: 'booking',     label: 'Booking.com',  icon: '🏨', always: false },
  { key: '10bis',       label: '10bis',        icon: '🍔', always: false },
  { key: 'easycil',     label: 'easy.co.il',   icon: '🌐', always: false },
];

function DataSourcesStatus({ businessProfile }) {
  const activeSources = businessProfile?.active_sources || [];
  return (
    <div className="card-base p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Database className="w-4 h-4 text-primary opacity-60" />
        <h3 className="text-[13px] font-semibold text-foreground">מקורות מידע פעילים</h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {DATA_SOURCES.map(src => {
          const isActive = src.always || activeSources.includes(src.key);
          return (
            <div key={src.key} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] ${
              isActive ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-400'
            }`}>
              <span>{src.icon}</span>
              <span className="font-medium truncate">{src.label}</span>
              <span className="mr-auto text-[9px] flex-shrink-0">{isActive ? '✓' : '—'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LearningCenter({ businessProfile }) {
  const [tips, setTips]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (businessProfile?.id && !tips && !loading) generateTips();
  }, [businessProfile?.id]);

  const generateTips = async () => {
    setLoading(true);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        model: 'haiku',
        prompt: `אתה יועץ עסקי. עסק: "${businessProfile?.name}" (${businessProfile?.category}, ${businessProfile?.city}).
הצע 3 טיפים עסקיים קצרים ומעשיים, מותאמים לסוג העסק. JSON בלבד:
{"tips":[
  {"title":"כותרת קצרה","tip":"טיפ מעשי חד-משפטי","icon":"💡"},
  {"title":"...","tip":"...","icon":"📈"},
  {"title":"...","tip":"...","icon":"🎯"}
]}`,
      });
      const parsed = parseLLMJson(res);
      if (parsed?.tips?.length) setTips(parsed.tips);
    } catch (_) {}
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="card-base p-4 mb-4 animate-pulse">
        <div className="h-3.5 bg-gray-100 rounded w-28 mb-3" />
        <div className="h-16 bg-gray-100 rounded" />
      </div>
    );
  }
  if (!tips?.length) return null;

  const tip = tips[current];
  return (
    <div className="card-base p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary opacity-60" />
          <h3 className="text-[13px] font-semibold text-foreground">טיפ של היום</h3>
        </div>
        <div className="flex gap-1">
          {tips.map((_, i) => (
            <button key={i} onClick={() => setCurrent(i)}
              className={`w-1.5 h-1.5 rounded-full transition-all ${i === current ? 'bg-primary' : 'bg-gray-200 hover:bg-gray-300'}`} />
          ))}
        </div>
      </div>
      <div className="flex items-start gap-3 p-3 rounded-xl bg-secondary">
        <span className="text-[20px] flex-shrink-0 leading-none mt-0.5">{tip.icon}</span>
        <div>
          <p className="text-[12px] font-semibold text-foreground mb-0.5">{tip.title}</p>
          <p className="text-[11px] text-foreground-muted leading-relaxed">{tip.tip}</p>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { businessProfile } = useOutletContext();
  const queryClient = useQueryClient();
  const bpId = businessProfile?.id;
  const [showScan, setShowScan] = useState(false);
  const scanQuota = useScanQuota(bpId);

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

  const { data: proactiveAlerts = [] } = useQuery({
    queryKey: ['proactiveAlerts', bpId],
    queryFn: () => base44.entities.ProactiveAlert.filter({ linked_business: bpId, is_dismissed: false }, '-created_at', 10),
    enabled: !!bpId,
    refetchInterval: 60000,
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

  // Expose scan trigger for TopBar — blocked if quota exhausted
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
      {/* Stale agents warning — hidden per UX spec */}
      {/* {agentsStale && (...)} */}

      {/* Scan quota warning */}
      {scanQuota.isExhausted && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-2.5 text-[12px] text-amber-800">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>מגבלת הסריקות של תוכנית <strong>{PLAN_LABELS[scanQuota.plan]}</strong> הגיעה לקצה ({scanQuota.quota} סריקות/חודש).</span>
          <a href="/subscription" className="mr-auto font-semibold text-amber-700 underline underline-offset-2">שדרג תוכנית →</a>
        </div>
      )}
      {!scanQuota.isExhausted && scanQuota.quota !== Infinity && scanQuota.pctUsed >= 75 && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-blue-50 border border-blue-200 flex items-center gap-2 text-[11px] text-blue-700">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>השתמשת ב-{scanQuota.scansThisMonth} מתוך {scanQuota.quota} סריקות החודש. נשארו {scanQuota.remaining}.</span>
        </div>
      )}

      {/* OTX Orchestrator status strip */}
      <OrchestratorPanel />

      {/* ROW 0: Today's Focus */}
      <TodaysFocus
        bpId={bpId}
        alerts={proactiveAlerts}
        reviews={allReviews}
        leads={allLeads}
        tasks={[]}
      />

      {/* ROW 1: Morning Briefing */}
      <MorningBriefing businessProfile={businessProfile} stats={stats} />

      {/* ROW 1b: Autonomous Actions Panel */}
      <AutoActionsPanel bpId={bpId} />

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

      {/* ROW 5: Learning Center */}
      <LearningCenter businessProfile={businessProfile} />

      {/* ROW 6: Data Sources Status */}
      <DataSourcesStatus businessProfile={businessProfile} />

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