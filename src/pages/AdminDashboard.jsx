import React, { useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, Zap, ChevronLeft, AlertCircle, CheckCircle2, Activity, Crown, Search } from 'lucide-react';
import { toast } from 'sonner';
import { PLAN_LABELS, PLAN_COLORS, PLAN_ORDER } from '@/lib/usePlan';
import { COST_PER_SCAN, COST_PER_POST } from '@/lib/planConfig';

function useIsAdmin() {
  try {
    const email = window.__clerk?.user?.primaryEmailAddress?.emailAddress || '';
    return email === 'contact@otxengine.io' || email.endsWith('@otx.ai') || email.endsWith('@quieteyes.ai');
  } catch { return false; }
}

const AGENTS = [
  { id: 'runMarketIntelligence',      label: 'ניתוח שוק' },
  { id: 'detectEvents',               label: 'זיהוי אירועים' },
  { id: 'findSocialLeads',            label: 'לידים חברתיים' },
  { id: 'collectWebSignals',          label: 'איסוף אותות רשת' },
  { id: 'runCompetitorIdentification',label: 'זיהוי מתחרים' },
  { id: 'competitorIntelAgent',       label: 'OSINT מתחרים' },
  { id: 'detectCompetitorChanges',    label: 'שינויי מתחרים' },
  { id: 'cleanupAndLearn',            label: 'ניקוי ולמידה' },
  { id: 'scanServicesAndPrices',      label: 'סריקת שירותים ומחירים' },
  { id: 'generateWeeklyReport',       label: 'דוח שבועי' },
];

const TABS = [
  { key: 'overview',       label: 'Overview' },
  { key: 'subscriptions',  label: 'מנויים' },
  { key: 'users',          label: 'משתמשים' },
  { key: 'usage',          label: 'עלויות & שימוש' },
  { key: 'agents',         label: 'Agent Logs' },
  { key: 'actions',        label: 'פעולות מנהל' },
];

const PLAN_FEATURES = {
  free_trial: [
    'Dashboard + Briefing',
    '5 תובנות שוק',
    '3 מתחרים (צפייה)',
    'סריקה אחת',
    'פוסט AI אחד',
  ],
  starter: [
    'Dashboard + Briefing',
    '15 תובנות שוק',
    '5 מתחרים (צפייה)',
    '4 סריקות/חודש',
    '5 פוסטים AI',
  ],
  growth: [
    'תובנות ללא הגבלה',
    '10 מתחרים + Battlecard',
    '30 סריקות/חודש',
    '30 פוסטים + 10 תמונות AI',
    'מגמות, Viral, לידים חברתיים',
    'דוח שבועי + מרכז למידה',
    'שימור לקוחות + מרכז שיווק',
  ],
  pro: [
    'הכל ב-Growth',
    'סריקות + מתחרים ללא הגבלה',
    'תמונות AI ללא הגבלה',
    'אינטגרציות FB/IG/Apify',
    'תמיכה Priority 4h',
    'Onboarding אישי',
  ],
  enterprise: [
    'הכל ב-Pro',
    'Account Manager ייעודי',
    'SLA 99.5%',
    'Onboarding מלא + הדרכה',
    'חשבונית / העברה בנקאית',
    'ניהול מרובה סניפים',
  ],
};

function StatCard({ label, value, color = 'text-foreground' }) {
  return (
    <div className="card-base p-4">
      <p className="text-[10px] font-medium text-foreground-muted mb-1">{label}</p>
      <span className={`text-[26px] font-bold tracking-tight ${color}`}>{value}</span>
    </div>
  );
}

export default function AdminDashboard({ skipAdminCheck = false }) {
  const isAdmin = skipAdminCheck || useIsAdmin();
  if (!isAdmin) return <Navigate to="/" replace />;

  const qc = useQueryClient();
  const [tab, setTab]               = useState('overview');
  const [drillBiz, setDrillBiz]     = useState(null);
  const [selectedBiz, setSelectedBiz]       = useState('');
  const [selectedAgent, setSelectedAgent]   = useState(AGENTS[0].id);
  const [running, setRunning]               = useState(false);
  const [agentResult, setAgentResult]       = useState(null);
  const [subSearch, setSubSearch]           = useState('');
  const [savingPlan, setSavingPlan]         = useState(null); // bizId being saved

  // ── Queries (no created_by filter = all data) ──────────────────
  const { data: allBusinesses = [], isLoading: loadingBiz } = useQuery({
    queryKey: ['admin_businesses'],
    queryFn: () => base44.entities.BusinessProfile.filter({}, '-created_date', 300),
  });

  const { data: allLogs = [], isLoading: loadingLogs } = useQuery({
    queryKey: ['admin_logs'],
    queryFn: () => base44.entities.AutomationLog.filter({}, '-start_time', 500),
    refetchInterval: 30000,
  });

  const { data: allSignals = [] } = useQuery({
    queryKey: ['admin_signals'],
    queryFn: () => base44.entities.MarketSignal.filter({}, '-detected_at', 1000),
  });

  const { data: allLeads = [] } = useQuery({
    queryKey: ['admin_leads'],
    queryFn: () => base44.entities.Lead.filter({}, '-created_date', 1000),
  });

  // ── Derived stats ──────────────────────────────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

  const activeIds = useMemo(() =>
    new Set(allLogs.filter(l => l.start_time > sevenDaysAgo).map(l => l.linked_business)),
    [allLogs]
  );

  const failedLogs   = allLogs.filter(l => l.status === 'failed');
  const successLogs  = allLogs.filter(l => l.status === 'success');
  const successRate  = allLogs.length > 0 ? Math.round(successLogs.length / allLogs.length * 100) : 0;

  const agentBreakdown = useMemo(() => {
    const map = {};
    for (const l of allLogs) {
      if (!map[l.automation_name]) map[l.automation_name] = { total: 0, success: 0, items: 0 };
      map[l.automation_name].total++;
      if (l.status === 'success') {
        map[l.automation_name].success++;
        map[l.automation_name].items += (l.items_processed || 0);
      }
    }
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [allLogs]);

  const bizStats = useMemo(() => {
    const map = {};
    for (const b of allBusinesses) {
      const logs = allLogs.filter(l => l.linked_business === b.id);
      map[b.id] = {
        signals: allSignals.filter(s => s.linked_business === b.id).length,
        leads:   allLeads.filter(l => l.linked_business === b.id).length,
        logs,
        lastRun: logs[0]?.start_time || null,
      };
    }
    return map;
  }, [allBusinesses, allSignals, allLeads, allLogs]);

  // ── Drill-down queries ─────────────────────────────────────────
  const { data: drillSignals = [] } = useQuery({
    queryKey: ['admin_drill_signals', drillBiz],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: drillBiz }, '-detected_at', 30),
    enabled: !!drillBiz,
  });
  const { data: drillLeads = [] } = useQuery({
    queryKey: ['admin_drill_leads', drillBiz],
    queryFn: () => base44.entities.Lead.filter({ linked_business: drillBiz }, '-created_date', 20),
    enabled: !!drillBiz,
  });
  const { data: drillAlerts = [] } = useQuery({
    queryKey: ['admin_drill_alerts', drillBiz],
    queryFn: () => base44.entities.ProactiveAlert.filter({ linked_business: drillBiz }, '-created_date', 20),
    enabled: !!drillBiz,
  });
  const drillBusiness = allBusinesses.find(b => b.id === drillBiz);
  const drillLogs     = allLogs.filter(l => l.linked_business === drillBiz).slice(0, 25);

  // ── Update subscription plan ──────────────────────────────────
  const updatePlan = async (bizId, newPlan) => {
    setSavingPlan(bizId);
    try {
      await base44.entities.BusinessProfile.update(bizId, { subscription_plan: newPlan });
      qc.invalidateQueries({ queryKey: ['admin_businesses'] });
      qc.invalidateQueries({ queryKey: ['subscriptionStatus'] });
      qc.invalidateQueries({ queryKey: ['businessProfiles'] });
      toast.success(`תוכנית עודכנה ל-${PLAN_LABELS[newPlan]} ✓`);
    } catch (e) {
      toast.error('שגיאה בעדכון: ' + e.message);
    }
    setSavingPlan(null);
  };

  // ── Run agent ─────────────────────────────────────────────────
  const handleRunAgent = async (bizId = selectedBiz) => {
    if (!bizId) { toast.error('בחר עסק'); return; }
    setRunning(true);
    setAgentResult(null);
    try {
      const res = await base44.functions.invoke(selectedAgent, { businessProfileId: bizId });
      const data = res?.data || res;
      setAgentResult(data);
      toast.success('Agent הסתיים ✓');
      qc.invalidateQueries({ queryKey: ['admin_logs'] });
      qc.invalidateQueries({ queryKey: ['admin_signals'] });
      qc.invalidateQueries({ queryKey: ['admin_leads'] });
    } catch (err) {
      toast.error('שגיאה: ' + err.message);
      setAgentResult({ error: err.message });
    }
    setRunning(false);
  };

  const fmtDate = (iso) => iso
    ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
    : '—';

  const loading = loadingBiz || loadingLogs;

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[16px] font-bold text-foreground tracking-tight">Admin Dashboard</h1>
          <p className="text-[11px] text-foreground-muted mt-0.5">ניהול פלטפורמה — גישה מוגבלת לבעלים בלבד</p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="w-4 h-4 animate-spin text-foreground-muted" />}
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-50 text-red-600 border border-red-200 tracking-wide">
            ADMIN ONLY
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-border">
        {TABS.map(t => (
          <button key={t.key}
            onClick={() => { setTab(t.key); setDrillBiz(null); }}
            className={`px-4 py-2.5 text-[12px] font-medium transition-all relative ${
              tab === t.key ? 'text-foreground' : 'text-foreground-muted hover:text-foreground-secondary'
            }`}>
            {t.label}
            {tab === t.key && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-t" />}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* OVERVIEW                                                  */}
      {/* ══════════════════════════════════════════════════════════ */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {/* KPI row 1 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="עסקים רשומים"   value={allBusinesses.length} color="text-primary" />
            <StatCard label="פעילים 7 ימים"  value={activeIds.size}       color="text-green-600" />
            <StatCard label="סיגנלים"         value={allSignals.length}    color="text-blue-600" />
            <StatCard label="לידים"           value={allLeads.length}      color="text-purple-600" />
          </div>

          {/* KPI row 2 — agents */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label='ריצות Agent סה"כ' value={allLogs.length}   color="text-foreground" />
            <StatCard label="הצלחות"           value={successLogs.length} color="text-green-600" />
            <StatCard label="כשלים"            value={failedLogs.length}  color="text-red-500" />
            <StatCard
              label="Success Rate"
              value={`${successRate}%`}
              color={successRate >= 90 ? 'text-green-600' : successRate >= 70 ? 'text-amber-500' : 'text-red-500'}
            />
          </div>

          {/* Recent errors */}
          {failedLogs.length > 0 && (
            <div className="card-base">
              <div className="px-5 py-3 border-b border-border flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-500" />
                <h3 className="text-[13px] font-semibold text-foreground">כשלים אחרונים</h3>
                <span className="text-[10px] text-foreground-muted mr-auto">{failedLogs.length}</span>
              </div>
              <div className="divide-y divide-border">
                {failedLogs.slice(0, 8).map(log => {
                  const biz = allBusinesses.find(b => b.id === log.linked_business);
                  return (
                    <div key={log.id} className="px-5 py-3">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[12px] font-medium text-foreground">{log.automation_name}</span>
                        <span className="text-[10px] text-foreground-muted">· {biz?.name || 'Unknown'}</span>
                        <span className="text-[10px] text-foreground-muted opacity-50 mr-auto">{fmtDate(log.start_time)}</span>
                      </div>
                      {log.error_message && (
                        <p className="text-[10px] text-red-500 font-mono leading-snug">{log.error_message.slice(0, 180)}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Agent breakdown table */}
          <div className="card-base">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <Activity className="w-4 h-4 text-foreground-muted opacity-60" />
              <h3 className="text-[13px] font-semibold text-foreground">פעילות לפי Agent</h3>
            </div>
            <div className="divide-y divide-border">
              {agentBreakdown.map(([name, s]) => {
                const rate = Math.round(s.success / s.total * 100);
                return (
                  <div key={name} className="px-5 py-3 flex items-center gap-3">
                    <span className="text-[12px] font-medium text-foreground flex-1 truncate">{name}</span>
                    <span className="text-[11px] text-foreground-muted">{s.total} ריצות</span>
                    <span className="text-[11px] text-green-600">{s.items} תוצרים</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      rate >= 90 ? 'bg-green-50 text-green-600' :
                      rate >= 70 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-500'
                    }`}>{rate}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* SUBSCRIPTIONS                                            */}
      {/* ══════════════════════════════════════════════════════════ */}
      {tab === 'subscriptions' && (
        <div className="space-y-4">
          {/* Plan stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {PLAN_ORDER.map(planId => {
              const count = allBusinesses.filter(b => (b.subscription_plan || 'free_trial') === planId).length;
              return (
                <div key={planId} className="card-base p-4 border-t-4" style={{ borderTopColor: PLAN_COLORS[planId] }}>
                  <p className="text-[10px] font-semibold text-foreground-muted mb-1">{PLAN_LABELS[planId]}</p>
                  <span className="text-[26px] font-bold tracking-tight" style={{ color: PLAN_COLORS[planId] }}>{count}</span>
                  <p className="text-[9px] text-foreground-muted mt-0.5">משתמשים</p>
                </div>
              );
            })}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted" />
            <input
              value={subSearch}
              onChange={e => setSubSearch(e.target.value)}
              placeholder="חיפוש לפי שם עסק..."
              className="w-full pr-9 pl-3 py-2.5 text-[12px] border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              dir="rtl"
            />
          </div>

          {/* Users table */}
          <div className="card-base overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
                <Crown className="w-4 h-4 text-warning" /> ניהול מנויים
              </h3>
              <span className="text-[10px] text-foreground-muted">{allBusinesses.length} עסקים</span>
            </div>
            <div className="divide-y divide-border">
              {allBusinesses
                .filter(b => !subSearch || b.name?.toLowerCase().includes(subSearch.toLowerCase()) || b.city?.includes(subSearch))
                .map(biz => {
                  const currentPlan = biz.subscription_plan || 'free_trial';
                  const isSaving    = savingPlan === biz.id;
                  const active      = activeIds.has(biz.id);
                  return (
                    <div key={biz.id} className="px-5 py-4 hover:bg-secondary/20 transition-colors">
                      <div className="flex items-center gap-4 flex-wrap">
                        {/* Business info */}
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${active ? 'bg-green-400' : 'bg-gray-300'}`} />
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-foreground truncate">{biz.name}</p>
                            <p className="text-[10px] text-foreground-muted">{biz.category} · {biz.city}</p>
                            <p className="text-[9px] text-foreground-muted opacity-50 truncate">{biz.created_by}</p>
                          </div>
                        </div>

                        {/* Current plan badge */}
                        <div className="shrink-0">
                          <span
                            className="text-[11px] font-bold px-2.5 py-1 rounded-full text-white"
                            style={{ background: PLAN_COLORS[currentPlan] }}
                          >
                            {PLAN_LABELS[currentPlan]}
                          </span>
                        </div>

                        {/* Plan selector */}
                        <div className="flex items-center gap-2 shrink-0">
                          <select
                            defaultValue={currentPlan}
                            key={currentPlan}
                            disabled={isSaving}
                            onChange={e => updatePlan(biz.id, e.target.value)}
                            className="text-[12px] border border-border rounded-lg px-3 py-1.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                          >
                            {PLAN_ORDER.map(p => (
                              <option key={p} value={p}>{PLAN_LABELS[p]}</option>
                            ))}
                          </select>
                          {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin text-foreground-muted" />}
                        </div>
                      </div>

                      {/* Features list for current plan */}
                      <div className="mt-2.5 flex flex-wrap gap-1.5 pr-5">
                        {(PLAN_FEATURES[currentPlan] || []).map(f => (
                          <span key={f} className="text-[9px] px-1.5 py-0.5 rounded-full bg-secondary border border-border text-foreground-muted">
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Quick bulk actions */}
          <div className="card-base p-5">
            <h4 className="text-[13px] font-semibold text-foreground mb-3">פעולות מהירות</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {PLAN_ORDER.filter(p => p !== 'free_trial').map(planId => (
                <div key={planId} className="p-3 rounded-xl border border-border bg-secondary/20">
                  <p className="text-[11px] font-bold mb-1" style={{ color: PLAN_COLORS[planId] }}>
                    {PLAN_LABELS[planId]}
                  </p>
                  <p className="text-[10px] text-foreground-muted mb-2">
                    {allBusinesses.filter(b => (b.subscription_plan || 'free_trial') === planId).length} משתמשים פעילים
                  </p>
                  <p className="text-[9px] text-foreground-muted leading-relaxed">
                    {PLAN_FEATURES[planId]?.slice(0, 3).join(' · ')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* USERS LIST                                                */}
      {/* ══════════════════════════════════════════════════════════ */}
      {tab === 'users' && !drillBiz && (
        <div className="card-base">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-foreground">כל העסקים</h3>
            <span className="text-[10px] text-foreground-muted">{allBusinesses.length} עסקים</span>
          </div>
          <div className="divide-y divide-border">
            {allBusinesses.map(biz => {
              const s = bizStats[biz.id] || {};
              const active = activeIds.has(biz.id);
              const isChurn = !s.lastRun || s.lastRun < sevenDaysAgo;
              return (
                <div key={biz.id}
                  onClick={() => setDrillBiz(biz.id)}
                  className={`px-5 py-3.5 hover:bg-secondary/30 transition-colors cursor-pointer ${isChurn ? 'bg-red-50/30' : ''}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${active ? 'bg-green-400' : 'bg-gray-300'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[13px] font-semibold text-foreground truncate">{biz.name}</span>
                        {biz.category && (
                          <span className="text-[9px] px-1.5 py-0.5 bg-secondary rounded-full text-foreground-muted border border-border shrink-0">
                            {biz.category}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-foreground-muted">{biz.city}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="flex items-center gap-3 text-[10px] text-foreground-muted mb-0.5">
                        <span>💡 {s.signals || 0}</span>
                        <span>👤 {s.leads || 0}</span>
                        <span>⚙️ {s.logs?.length || 0}</span>
                        {isChurn && <span className="text-red-500 font-semibold">⚠ לא פעיל</span>}
                      </div>
                      <p className="text-[10px] text-foreground-muted opacity-50">
                        {s.lastRun ? fmtDate(s.lastRun) : 'לא רץ'}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* USER DRILL-DOWN                                          */}
      {/* ══════════════════════════════════════════════════════════ */}
      {tab === 'users' && drillBiz && (
        <div className="space-y-4">
          {/* Back + title */}
          <div className="flex items-center gap-3">
            <button onClick={() => setDrillBiz(null)}
              className="flex items-center gap-1 text-[12px] text-foreground-muted hover:text-foreground transition-colors">
              <ChevronLeft className="w-4 h-4" /> חזרה
            </button>
            <div>
              <h2 className="text-[14px] font-bold text-foreground">{drillBusiness?.name}</h2>
              <p className="text-[10px] text-foreground-muted">{drillBusiness?.category} · {drillBusiness?.city} · {drillBusiness?.created_by}</p>
            </div>
          </div>

          {/* Plan + Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="סיגנלים"     value={drillSignals.length} />
            <StatCard label="לידים"       value={drillLeads.length} />
            <StatCard label="ריצות Agent" value={drillLogs.length} />
            {/* Plan change inline */}
            <div className="card-base p-4">
              <p className="text-[10px] font-medium text-foreground-muted mb-2 flex items-center gap-1">
                <Crown className="w-3 h-3 text-warning" /> תוכנית מנוי
              </p>
              <div className="flex items-center gap-2">
                <select
                  defaultValue={drillBusiness?.subscription_plan || 'free_trial'}
                  key={drillBusiness?.subscription_plan}
                  disabled={!!savingPlan}
                  onChange={e => updatePlan(drillBiz, e.target.value)}
                  className="flex-1 text-[11px] border border-border rounded-lg px-2 py-1.5 bg-background text-foreground focus:outline-none"
                >
                  {PLAN_ORDER.map(p => (
                    <option key={p} value={p}>{PLAN_LABELS[p]}</option>
                  ))}
                </select>
                {savingPlan === drillBiz && <Loader2 className="w-3 h-3 animate-spin text-foreground-muted shrink-0" />}
              </div>
              <p className="text-[9px] text-foreground-muted mt-1.5">
                נוכחי: <span className="font-semibold" style={{ color: PLAN_COLORS[drillBusiness?.subscription_plan || 'free_trial'] }}>
                  {PLAN_LABELS[drillBusiness?.subscription_plan || 'free_trial']}
                </span>
              </p>
            </div>
          </div>

          {/* Signals */}
          <div className="card-base">
            <div className="px-5 py-3 border-b border-border">
              <h4 className="text-[12px] font-semibold text-foreground">סיגנלים אחרונים</h4>
            </div>
            <div className="divide-y divide-border max-h-56 overflow-y-auto">
              {drillSignals.length === 0
                ? <p className="px-5 py-4 text-[12px] text-foreground-muted">אין סיגנלים</p>
                : drillSignals.map(s => (
                  <div key={s.id} className="px-5 py-2.5 flex items-start gap-2">
                    <span className={`shrink-0 mt-0.5 text-[9px] px-1.5 py-0.5 rounded-full border ${
                      s.impact_level === 'high' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-blue-50 text-blue-600 border-blue-100'
                    }`}>{s.impact_level}</span>
                    <span className="text-[11px] text-foreground flex-1 leading-snug">{s.summary}</span>
                    <span className="text-[9px] text-foreground-muted shrink-0">{s.category}</span>
                  </div>
                ))
              }
            </div>
          </div>

          {/* Leads */}
          <div className="card-base">
            <div className="px-5 py-3 border-b border-border">
              <h4 className="text-[12px] font-semibold text-foreground">לידים</h4>
            </div>
            <div className="divide-y divide-border max-h-48 overflow-y-auto">
              {drillLeads.length === 0
                ? <p className="px-5 py-4 text-[12px] text-foreground-muted">אין לידים</p>
                : drillLeads.map(l => (
                  <div key={l.id} className="px-5 py-2.5 flex items-center gap-2">
                    <span className="text-[11px] text-foreground truncate flex-1">{l.name || l.source || 'ליד'}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full border shrink-0 ${
                      l.status === 'hot' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-gray-50 text-gray-500 border-gray-200'
                    }`}>{l.status}</span>
                    <span className="text-[10px] text-foreground-muted shrink-0">{l.score || 0}pts</span>
                  </div>
                ))
              }
            </div>
          </div>

          {/* Alerts */}
          <div className="card-base">
            <div className="px-5 py-3 border-b border-border">
              <h4 className="text-[12px] font-semibold text-foreground">התראות פעילות</h4>
            </div>
            <div className="divide-y divide-border max-h-48 overflow-y-auto">
              {drillAlerts.length === 0
                ? <p className="px-5 py-4 text-[12px] text-foreground-muted">אין התראות</p>
                : drillAlerts.map(a => (
                  <div key={a.id} className="px-5 py-2.5 flex items-center gap-2">
                    <span className="text-[11px] text-foreground truncate flex-1">{a.title}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full border shrink-0 ${
                      a.priority === 'high' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-amber-50 text-amber-600 border-amber-100'
                    }`}>{a.priority}</span>
                  </div>
                ))
              }
            </div>
          </div>

          {/* Agent logs */}
          <div className="card-base">
            <div className="px-5 py-3 border-b border-border">
              <h4 className="text-[12px] font-semibold text-foreground">ריצות Agents</h4>
            </div>
            <div className="divide-y divide-border max-h-48 overflow-y-auto">
              {drillLogs.length === 0
                ? <p className="px-5 py-4 text-[12px] text-foreground-muted">אין ריצות</p>
                : drillLogs.map(l => (
                  <div key={l.id} className="px-5 py-2 flex items-center gap-2">
                    {l.status === 'success'
                      ? <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                      : <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
                    }
                    <span className="text-[11px] text-foreground flex-1">{l.automation_name}</span>
                    <span className="text-[10px] text-foreground-muted">{l.items_processed || 0} תוצרים</span>
                    <span className="text-[10px] text-foreground-muted opacity-50 shrink-0">{fmtDate(l.start_time)}</span>
                  </div>
                ))
              }
            </div>
          </div>

          {/* Run agent for this user */}
          <div className="card-base p-5">
            <h4 className="text-[12px] font-semibold text-foreground mb-3">הרץ Agent על משתמש זה</h4>
            <div className="flex gap-2">
              <select
                value={selectedAgent}
                onChange={e => setSelectedAgent(e.target.value)}
                className="flex-1 text-[12px] border border-border rounded-lg px-3 py-2 bg-background text-foreground"
              >
                {AGENTS.map(a => <option key={a.id} value={a.id}>{a.label} ({a.id})</option>)}
              </select>
              <button
                onClick={() => handleRunAgent(drillBiz)}
                disabled={running}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold bg-foreground text-background hover:opacity-90 disabled:opacity-50 transition-all shrink-0"
              >
                {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                הרץ
              </button>
            </div>
            {agentResult && (
              <div className="mt-3 p-3 bg-secondary rounded-lg border border-border">
                <p className="text-[10px] font-semibold text-foreground-muted mb-1">תוצאה:</p>
                <pre className="text-[10px] text-foreground font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                  {JSON.stringify(agentResult, null, 2).slice(0, 800)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* USAGE & COSTS                                            */}
      {/* ══════════════════════════════════════════════════════════ */}
      {tab === 'usage' && (() => {
        const monthStart = new Date();
        monthStart.setUTCDate(1);
        monthStart.setUTCHours(0, 0, 0, 0);
        const monthStartISO = monthStart.toISOString();

        const usageRows = allBusinesses.map(biz => {
          const bizLogs = allLogs.filter(l => l.linked_business === biz.id);
          const scansMonth = bizLogs.filter(l => l.automation_name === 'runFullScan' && (l.start_time || '') >= monthStartISO).length;
          const postsMonth = bizLogs.filter(l => l.automation_name === 'generatePost' && (l.start_time || '') >= monthStartISO).length;
          const totalRuns  = bizLogs.filter(l => (l.start_time || '') >= monthStartISO).length;
          const estCost    = +(scansMonth * COST_PER_SCAN + postsMonth * COST_PER_POST).toFixed(2);
          const lastRun    = bizLogs[0]?.start_time || null;
          const isChurn    = !lastRun || lastRun < sevenDaysAgo;
          return { biz, scansMonth, postsMonth, totalRuns, estCost, lastRun, isChurn };
        }).sort((a, b) => b.estCost - a.estCost);

        const totalCost  = +usageRows.reduce((s, r) => s + r.estCost, 0).toFixed(2);
        const churnCount = usageRows.filter(r => r.isChurn).length;
        const totalScans = usageRows.reduce((s, r) => s + r.scansMonth, 0);

        return (
          <div className="space-y-4">
            {/* Summary KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label='עלות חודשית מוערכת' value={`$${totalCost}`} color="text-primary" />
              <StatCard label='סריקות החודש (סה"כ)' value={totalScans} color="text-blue-600" />
              <StatCard label="משתמשי סיכון (churn)" value={churnCount} color="text-red-500" />
              <StatCard label="עלות לסריקה" value={`$${COST_PER_SCAN}`} color="text-foreground-muted" />
            </div>

            {/* Per-user table */}
            <div className="card-base overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-foreground">שימוש ועלויות לפי משתמש — {new Date().toLocaleString('he-IL', { month: 'long', year: 'numeric' })}</h3>
                <span className="text-[10px] text-foreground-muted">{usageRows.length} עסקים</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-border bg-secondary/30">
                      <th className="px-4 py-2.5 text-right font-medium text-foreground-muted">עסק</th>
                      <th className="px-4 py-2.5 text-center font-medium text-foreground-muted">תוכנית</th>
                      <th className="px-4 py-2.5 text-center font-medium text-foreground-muted">סריקות</th>
                      <th className="px-4 py-2.5 text-center font-medium text-foreground-muted">ריצות</th>
                      <th className="px-4 py-2.5 text-center font-medium text-foreground-muted">עלות מוערכת</th>
                      <th className="px-4 py-2.5 text-center font-medium text-foreground-muted">ריצה אחרונה</th>
                      <th className="px-4 py-2.5 text-center font-medium text-foreground-muted">סטטוס</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {usageRows.map(({ biz, scansMonth, totalRuns, estCost, lastRun, isChurn }) => {
                      const plan = biz.subscription_plan || 'free_trial';
                      return (
                        <tr key={biz.id} className={`hover:bg-secondary/20 transition-colors ${isChurn ? 'bg-red-50/40' : ''}`}>
                          <td className="px-4 py-2.5">
                            <p className="font-semibold text-foreground truncate max-w-[160px]">{biz.name}</p>
                            <p className="text-[9px] text-foreground-muted opacity-60">{biz.created_by}</p>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white" style={{ background: PLAN_COLORS[plan] }}>
                              {PLAN_LABELS[plan]}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center font-semibold text-foreground">{scansMonth}</td>
                          <td className="px-4 py-2.5 text-center text-foreground-muted">{totalRuns}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`font-bold ${estCost > 1 ? 'text-amber-600' : 'text-foreground'}`}>
                              ${estCost.toFixed(2)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center text-foreground-muted text-[10px]">
                            {lastRun ? fmtDate(lastRun) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            {isChurn ? (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-red-50 text-red-600 border border-red-100">
                                ⚠ לא פעיל
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-green-50 text-green-600 border border-green-100">
                                פעיל
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* AGENT LOGS                                               */}
      {/* ══════════════════════════════════════════════════════════ */}
      {tab === 'agents' && (
        <div className="card-base">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-foreground">כל ריצות ה-Agents</h3>
            <span className="text-[10px] text-foreground-muted">{allLogs.length} רשומות</span>
          </div>
          <div className="divide-y divide-border max-h-[70vh] overflow-y-auto">
            {allLogs.map(log => {
              const biz = allBusinesses.find(b => b.id === log.linked_business);
              return (
                <div key={log.id} className="px-5 py-3 hover:bg-secondary/20 transition-colors">
                  <div className="flex items-center gap-2">
                    {log.status === 'success'
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      : <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    }
                    <span className="text-[12px] font-medium text-foreground">{log.automation_name}</span>
                    <span className="text-[10px] text-foreground-muted">·</span>
                    <span className="text-[11px] text-foreground-muted truncate flex-1">{biz?.name || log.linked_business?.slice(0, 16)}</span>
                    <span className="text-[10px] text-foreground-muted shrink-0">{log.items_processed || 0} תוצרים</span>
                    <span className="text-[10px] text-foreground-muted opacity-50 shrink-0">{fmtDate(log.start_time)}</span>
                  </div>
                  {log.error_message && (
                    <p className="mt-1 pr-5 text-[10px] text-red-500 font-mono leading-snug">
                      {log.error_message.slice(0, 200)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ADMIN ACTIONS                                            */}
      {/* ══════════════════════════════════════════════════════════ */}
      {tab === 'actions' && (
        <div className="space-y-4 max-w-lg">
          <div className="card-base p-5 space-y-4">
            <h3 className="text-[13px] font-semibold text-foreground">הרצת Agent ידנית</h3>

            <div>
              <label className="text-[11px] font-medium text-foreground-muted block mb-1.5">עסק</label>
              <select
                value={selectedBiz}
                onChange={e => setSelectedBiz(e.target.value)}
                className="w-full text-[12px] border border-border rounded-lg px-3 py-2.5 bg-background text-foreground"
              >
                <option value="">— בחר עסק —</option>
                {allBusinesses.map(b => (
                  <option key={b.id} value={b.id}>{b.name} — {b.city}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] font-medium text-foreground-muted block mb-1.5">Agent</label>
              <select
                value={selectedAgent}
                onChange={e => setSelectedAgent(e.target.value)}
                className="w-full text-[12px] border border-border rounded-lg px-3 py-2.5 bg-background text-foreground"
              >
                {AGENTS.map(a => (
                  <option key={a.id} value={a.id}>{a.label} — {a.id}</option>
                ))}
              </select>
            </div>

            <button
              onClick={() => handleRunAgent()}
              disabled={running || !selectedBiz}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[12px] font-semibold bg-foreground text-background hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {running ? 'מריץ...' : 'הרץ Agent'}
            </button>

            {agentResult && (
              <div className="p-3 bg-secondary rounded-lg border border-border">
                <p className="text-[10px] font-semibold text-foreground-muted mb-2">תוצאה:</p>
                <pre className="text-[10px] text-foreground font-mono whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
                  {JSON.stringify(agentResult, null, 2).slice(0, 1200)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
