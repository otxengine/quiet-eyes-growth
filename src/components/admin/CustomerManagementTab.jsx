import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminClient, adminFetch } from '@/api/adminClient';
import { PLAN_LABELS, PLAN_COLORS, PLAN_ORDER } from '@/lib/usePlan';
import {
  Loader2, Search, Crown, ChevronDown, X, Plus, AlertCircle, CheckCircle2, Zap,
  ChevronLeft,
} from 'lucide-react';
import { toast } from 'sonner';

const CARD   = 'bg-[#161b25] border border-[#2a3042] rounded-xl';
const INPUT  = 'text-[12px] border border-[#2a3042] rounded-lg px-3 py-2 bg-[#0d0f14] text-white focus:outline-none focus:ring-1 focus:ring-indigo-500';
const SELECT = `${INPUT} cursor-pointer`;
const BTN    = 'px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all';

const PLAN_BADGE = {
  pro:         'bg-indigo-900/70 text-indigo-300 border border-indigo-700',
  growth:      'bg-violet-900/70 text-violet-300 border border-violet-700',
  starter:     'bg-sky-900/70 text-sky-300 border border-sky-700',
  free_trial:  'bg-slate-700/70 text-slate-300 border border-slate-600',
  enterprise:  'bg-amber-900/70 text-amber-300 border border-amber-700',
};

const fmtDate = (iso) => iso
  ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
  : '—';

const AGENTS = [
  { id: 'runMarketIntelligence', label: 'ניתוח שוק' },
  { id: 'detectEvents',          label: 'זיהוי אירועים' },
  { id: 'findSocialLeads',       label: 'לידים חברתיים' },
  { id: 'collectWebSignals',     label: 'איסוף אותות רשת' },
  { id: 'generateWeeklyReport',  label: 'דוח שבועי' },
];

// ── Add Business Modal ─────────────────────────────────────────────────────────
function AddBusinessModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ name: '', email: '', plan: 'starter', city: '', category: '' });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.name || !form.email) { toast.error('שם ואימייל חובה'); return; }
    setSaving(true);
    try {
      await adminClient.entities.BusinessProfile.create({
        name: form.name,
        created_by: form.email,
        city: form.city,
        category: form.category,
        subscription_plan: form.plan,
        plan_id: form.plan,
        onboarding_completed: true,
      });
      toast.success('עסק נוצר בהצלחה');
      onAdded();
      onClose();
    } catch (e) {
      toast.error('שגיאה: ' + e.message);
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className={`${CARD} p-6 w-full max-w-md space-y-4`}>
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-bold text-white">הוסף עסק חדש</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        {[
          { key: 'name',     label: 'שם עסק*' },
          { key: 'email',    label: 'אימייל*' },
          { key: 'city',     label: 'עיר' },
          { key: 'category', label: 'קטגוריה' },
        ].map(({ key, label }) => (
          <div key={key}>
            <label className="text-[11px] text-slate-400 block mb-1">{label}</label>
            <input
              value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
              className={`${INPUT} w-full`}
              dir="rtl"
            />
          </div>
        ))}
        <div>
          <label className="text-[11px] text-slate-400 block mb-1">תכנית</label>
          <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))} className={`${SELECT} w-full`} dir="rtl">
            {PLAN_ORDER.map(p => <option key={p} value={p}>{PLAN_LABELS[p]}</option>)}
          </select>
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className={`${BTN} flex-1 bg-[#2a3042] text-white hover:bg-[#3a4052]`}>ביטול</button>
          <button onClick={submit} disabled={saving} className={`${BTN} flex-1 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50`}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : 'צור עסק'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Cancel Confirm Modal ───────────────────────────────────────────────────────
function CancelModal({ biz, onClose, onConfirm, deleting }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className={`${CARD} p-6 w-full max-w-sm space-y-4`}>
        <div className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <h3 className="text-[14px] font-bold text-white">מחיקת משתמש</h3>
        </div>
        <p className="text-[12px] text-slate-400">
          פעולה זו תמחק לצמיתות את <strong className="text-white">{biz?.name}</strong> ({biz?.created_by}).<br />
          <span className="text-red-400 font-semibold">המשתמש לא יוכל להתחבר יותר. כל הנתונים יימחקו. לא ניתן לבטל.</span>
        </p>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} disabled={deleting} className={`${BTN} flex-1 bg-[#2a3042] text-white disabled:opacity-50`}>ביטול</button>
          <button onClick={onConfirm} disabled={deleting} className={`${BTN} flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-1.5`}>
            {deleting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> מוחק...</> : 'מחק לצמיתות'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Drill-down Modal ───────────────────────────────────────────────────────────
function DrillModal({ biz, allLogs, onClose, onPlanChange }) {
  const [selectedAgent, setSelectedAgent] = useState(AGENTS[0].id);
  const [running, setRunning] = useState(false);
  const [agentResult, setAgentResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [localPlan, setLocalPlan] = useState(biz?.subscription_plan || biz?.plan_id || 'free_trial');

  const { data: drillSignals = [] } = useQuery({
    queryKey: ['admin_drill_signals', biz?.id],
    queryFn: () => adminClient.entities.MarketSignal.filter({ linked_business: biz.id }, '-detected_at', 30),
    enabled: !!biz?.id,
  });
  const { data: drillLeads = [] } = useQuery({
    queryKey: ['admin_drill_leads', biz?.id],
    queryFn: () => adminClient.entities.Lead.filter({ linked_business: biz.id }, '-created_date', 20),
    enabled: !!biz?.id,
  });
  const { data: drillAlerts = [] } = useQuery({
    queryKey: ['admin_drill_alerts', biz?.id],
    queryFn: () => adminClient.entities.ProactiveAlert.filter({ linked_business: biz.id }, '-created_date', 20),
    enabled: !!biz?.id,
  });

  const drillLogs = allLogs.filter(l => l.linked_business === biz?.id).slice(0, 25);

  const savePlan = async () => {
    setSaving(true);
    try {
      await adminClient.entities.BusinessProfile.update(biz.id, { subscription_plan: localPlan, plan_id: localPlan });
      toast.success(`תכנית עודכנה ל-${PLAN_LABELS[localPlan]}`);
      onPlanChange(biz.id, localPlan);
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  };

  const runAgent = async () => {
    setRunning(true); setAgentResult(null);
    try {
      const res = await adminClient.functions.invoke(selectedAgent, { businessProfileId: biz.id });
      setAgentResult(res?.data || res);
      toast.success('Agent הסתיים ✓');
    } catch (err) { toast.error(err.message); setAgentResult({ error: err.message }); }
    setRunning(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className={`${CARD} w-full max-w-2xl max-h-[90vh] overflow-y-auto`}>
        <div className="px-5 py-4 border-b border-[#2a3042] flex items-center justify-between sticky top-0 bg-[#161b25] z-10">
          <div>
            <h3 className="text-[14px] font-bold text-white">{biz?.name}</h3>
            <p className="text-[10px] text-slate-500">{biz?.category} · {biz?.city} · {biz?.created_by}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* Plan */}
          <div>
            <h4 className="text-[11px] font-semibold text-slate-400 mb-2 flex items-center gap-1.5"><Crown className="w-3.5 h-3.5" /> תכנית מנוי</h4>
            <div className="flex gap-2">
              <select value={localPlan} onChange={e => setLocalPlan(e.target.value)} className={`${SELECT} flex-1`} dir="rtl">
                {PLAN_ORDER.map(p => <option key={p} value={p}>{PLAN_LABELS[p]}</option>)}
              </select>
              <button onClick={savePlan} disabled={saving} className={`${BTN} bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50`}>
                {saving ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'שמור'}
              </button>
            </div>
          </div>

          {/* Signals */}
          <Section title={`אותות אחרונים (${drillSignals.length})`}>
            {drillSignals.map(s => (
              <div key={s.id} className="flex items-start gap-2 py-2 border-b border-[#2a3042] last:border-0">
                <span className={`shrink-0 mt-0.5 text-[9px] px-1.5 py-0.5 rounded-full border ${
                  s.impact_level === 'high' ? 'bg-red-900/50 text-red-400 border-red-800' : 'bg-sky-900/50 text-sky-400 border-sky-800'
                }`}>{s.impact_level}</span>
                <span className="text-[11px] text-white flex-1 leading-snug">{s.summary}</span>
              </div>
            ))}
            {drillSignals.length === 0 && <p className="text-[11px] text-slate-600">אין אותות</p>}
          </Section>

          {/* Leads */}
          <Section title={`לידים (${drillLeads.length})`}>
            {drillLeads.map(l => (
              <div key={l.id} className="flex items-center gap-2 py-2 border-b border-[#2a3042] last:border-0">
                <span className="text-[11px] text-white truncate flex-1">{l.name || l.source || 'ליד'}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full border shrink-0 ${
                  l.status === 'hot' ? 'bg-red-900/50 text-red-400 border-red-800' : 'bg-slate-700 text-slate-400 border-slate-600'
                }`}>{l.status}</span>
              </div>
            ))}
            {drillLeads.length === 0 && <p className="text-[11px] text-slate-600">אין לידים</p>}
          </Section>

          {/* Alerts */}
          <Section title={`התראות פרואקטיביות (${drillAlerts.length})`}>
            {drillAlerts.map(a => (
              <div key={a.id} className="flex items-center gap-2 py-2 border-b border-[#2a3042] last:border-0">
                <span className="text-[11px] text-white truncate flex-1">{a.title}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full border shrink-0 ${
                  a.priority === 'high' ? 'bg-red-900/50 text-red-400 border-red-800' : 'bg-amber-900/50 text-amber-400 border-amber-800'
                }`}>{a.priority}</span>
              </div>
            ))}
            {drillAlerts.length === 0 && <p className="text-[11px] text-slate-600">אין התראות</p>}
          </Section>

          {/* Agent runs */}
          <Section title={`ריצות Agents (${drillLogs.length})`}>
            {drillLogs.map(l => (
              <div key={l.id} className="flex items-center gap-2 py-1.5 border-b border-[#2a3042] last:border-0">
                {l.status === 'success'
                  ? <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  : <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
                }
                <span className="text-[11px] text-white flex-1">{l.automation_name}</span>
                <span className="text-[10px] text-slate-500">{fmtDate(l.start_time)}</span>
              </div>
            ))}
            {drillLogs.length === 0 && <p className="text-[11px] text-slate-600">אין ריצות</p>}
          </Section>

          {/* Run agent */}
          <div>
            <h4 className="text-[11px] font-semibold text-slate-400 mb-2 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" /> הרץ Agent</h4>
            <div className="flex gap-2">
              <select value={selectedAgent} onChange={e => setSelectedAgent(e.target.value)} className={`${SELECT} flex-1`} dir="rtl">
                {AGENTS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <button onClick={runAgent} disabled={running} className={`${BTN} bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50`}>
                {running ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'הרץ'}
              </button>
            </div>
            {agentResult && (
              <pre className="mt-2 p-3 text-[10px] text-emerald-400 font-mono bg-[#0d0f14] rounded-lg border border-[#2a3042] max-h-40 overflow-y-auto">
                {JSON.stringify(agentResult, null, 2).slice(0, 600)}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold text-slate-400 mb-2">{title}</h4>
      <div className="bg-[#0d0f14] rounded-lg border border-[#2a3042] px-3 max-h-48 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function CustomerManagementTab({ allBusinesses, allLogs, allSignals, allLeads }) {
  const qc = useQueryClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

  const [search, setSearch]       = useState('');
  const [filterPlan, setFilterPlan] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [savingPlan, setSavingPlan] = useState(null);
  const [drillBiz, setDrillBiz]   = useState(null);
  const [cancelBiz, setCancelBiz] = useState(null);
  const [deleting, setDeleting]   = useState(false);
  const [showAdd, setShowAdd]     = useState(false);

  const activeIds = useMemo(() =>
    new Set(allLogs.filter(l => l.start_time > sevenDaysAgo).map(l => l.linked_business)),
    [allLogs, sevenDaysAgo]
  );

  const bizStats = useMemo(() => {
    const map = {};
    for (const b of allBusinesses) {
      map[b.id] = {
        signals: allSignals.filter(s => s.linked_business === b.id).length,
        leads:   allLeads.filter(l => l.linked_business === b.id).length,
        runs:    allLogs.filter(l => l.linked_business === b.id).length,
      };
    }
    return map;
  }, [allBusinesses, allSignals, allLeads, allLogs]);

  const filtered = useMemo(() => {
    return allBusinesses.filter(b => {
      const plan   = b.subscription_plan || b.plan_id || 'free_trial';
      const active = activeIds.has(b.id);
      if (search && !b.name?.toLowerCase().includes(search.toLowerCase())
                 && !b.city?.includes(search)
                 && !b.category?.includes(search)) return false;
      if (filterPlan   && plan !== filterPlan) return false;
      if (filterStatus === 'active'  && !active) return false;
      if (filterStatus === 'inactive' && active) return false;
      return true;
    });
  }, [allBusinesses, search, filterPlan, filterStatus, activeIds]);

  const updatePlan = async (bizId, newPlan) => {
    setSavingPlan(bizId);
    qc.setQueryData(['admin_businesses'], (old = []) =>
      old.map(b => b.id === bizId ? { ...b, subscription_plan: newPlan, plan_id: newPlan } : b)
    );
    try {
      await adminClient.entities.BusinessProfile.update(bizId, { subscription_plan: newPlan, plan_id: newPlan });
      toast.success(`תכנית עודכנה ל-${PLAN_LABELS[newPlan]}`);
    } catch (e) {
      qc.invalidateQueries({ queryKey: ['admin_businesses'] });
      toast.error('שגיאה: ' + e.message);
    }
    setSavingPlan(null);
  };

  const confirmCancel = async () => {
    if (!cancelBiz) return;
    setDeleting(true);
    try {
      const res = await adminFetch(`/admin/users/${cancelBiz.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(`המשתמש ${cancelBiz.name} נמחק לצמיתות`);
        // Remove from local cache immediately
        qc.setQueryData(['admin_businesses'], (old = []) =>
          old.filter(b => b.id !== cancelBiz.id)
        );
      } else {
        toast.error('מחיקה חלקית — בדוק לוגים: ' + (res.errors?.[0] || ''));
        qc.invalidateQueries({ queryKey: ['admin_businesses'] });
      }
    } catch (e) {
      toast.error('שגיאה: ' + e.message);
    }
    setDeleting(false);
    setCancelBiz(null);
  };

  return (
    <div className="space-y-4">
      {/* Plan distribution */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {PLAN_ORDER.map(planId => {
          const count = allBusinesses.filter(b => (b.subscription_plan || b.plan_id || 'free_trial') === planId).length;
          return (
            <div key={planId} className={`${CARD} p-4 border-t-4`} style={{ borderTopColor: PLAN_COLORS[planId] }}>
              <p className="text-[10px] font-semibold text-slate-400 mb-1">{PLAN_LABELS[planId]}</p>
              <span className="text-[26px] font-bold" style={{ color: PLAN_COLORS[planId] }}>{count}</span>
            </div>
          );
        })}
      </div>

      {/* Filters + Add */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="חיפוש לפי שם, עיר, קטגוריה..."
            className={`${INPUT} w-full pr-9`} dir="rtl" />
        </div>
        <select value={filterPlan} onChange={e => setFilterPlan(e.target.value)} className={`${SELECT}`} dir="rtl">
          <option value="">כל התכניות</option>
          {PLAN_ORDER.map(p => <option key={p} value={p}>{PLAN_LABELS[p]}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={`${SELECT}`} dir="rtl">
          <option value="">כל הסטטוסים</option>
          <option value="active">פעיל</option>
          <option value="inactive">לא פעיל</option>
        </select>
        <button onClick={() => setShowAdd(true)} className={`${BTN} bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1.5`}>
          <Plus className="w-3.5 h-3.5" /> הוסף עסק
        </button>
      </div>

      {/* Table */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="px-5 py-3 border-b border-[#2a3042] flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-white flex items-center gap-2">
            <Crown className="w-4 h-4 text-amber-400" /> ניהול לקוחות
          </h3>
          <span className="text-[10px] text-slate-500">{filtered.length} / {allBusinesses.length} עסקים</span>
        </div>

        {/* Table header */}
        <div className="hidden md:grid grid-cols-[1fr_100px_80px_60px_60px_60px_120px_100px] gap-2 px-5 py-2 text-[10px] font-semibold text-slate-500 border-b border-[#2a3042] bg-[#0d0f14]">
          <span>עסק</span>
          <span>תכנית</span>
          <span>סטטוס</span>
          <span>אותות</span>
          <span>לידים</span>
          <span>ריצות</span>
          <span>שנה תכנית</span>
          <span>פעולות</span>
        </div>

        <div className="divide-y divide-[#2a3042]">
          {filtered.map(biz => {
            const plan   = biz.subscription_plan || biz.plan_id || 'free_trial';
            const active = activeIds.has(biz.id);
            const s      = bizStats[biz.id] || {};
            const isSaving = savingPlan === biz.id;
            return (
              <div key={biz.id} className="px-5 py-3 hover:bg-white/5 transition-colors">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_100px_80px_60px_60px_60px_120px_100px] gap-2 items-center">
                  {/* Business info */}
                  <div className="flex items-center gap-2 cursor-pointer" onClick={() => setDrillBiz(biz)}>
                    <div className={`w-2 h-2 rounded-full shrink-0 ${active ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-white truncate">{biz.name}</p>
                      <p className="text-[10px] text-slate-500">{biz.category} · {biz.city}</p>
                    </div>
                  </div>
                  {/* Plan badge */}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full w-fit ${PLAN_BADGE[plan] || PLAN_BADGE.free_trial}`}>
                    {PLAN_LABELS[plan]}
                  </span>
                  {/* Status */}
                  <span className={`text-[10px] font-medium ${active ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {active ? '● פעיל' : '○ לא פעיל'}
                  </span>
                  {/* Stats */}
                  <span className="text-[11px] text-slate-300">{s.signals || 0}</span>
                  <span className="text-[11px] text-slate-300">{s.leads || 0}</span>
                  <span className="text-[11px] text-slate-300">{s.runs || 0}</span>
                  {/* Plan change */}
                  <div className="flex items-center gap-1">
                    <select
                      defaultValue={plan}
                      key={plan}
                      disabled={isSaving}
                      onChange={e => updatePlan(biz.id, e.target.value)}
                      className="text-[11px] border border-[#2a3042] rounded-lg px-2 py-1 bg-[#0d0f14] text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                      dir="rtl"
                    >
                      {PLAN_ORDER.map(p => <option key={p} value={p}>{PLAN_LABELS[p]}</option>)}
                    </select>
                    {isSaving && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
                  </div>
                  {/* Actions */}
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setDrillBiz(biz)}
                      className="text-[10px] px-2 py-1 rounded-lg bg-[#2a3042] text-white hover:bg-[#3a4052] transition"
                    >
                      פרטים
                    </button>
                    <button
                      onClick={() => setCancelBiz(biz)}
                      className="text-[10px] px-2 py-1 rounded-lg bg-red-900/50 text-red-400 hover:bg-red-900/80 border border-red-800 transition"
                      title="מחק משתמש לצמיתות"
                    >
                      מחק
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="px-5 py-8 text-center text-[12px] text-slate-500">אין תוצאות</p>
          )}
        </div>
      </div>

      {/* Modals */}
      {showAdd     && <AddBusinessModal onClose={() => setShowAdd(false)} onAdded={() => qc.invalidateQueries({ queryKey: ['admin_businesses'] })} />}
      {cancelBiz   && <CancelModal biz={cancelBiz} onClose={() => !deleting && setCancelBiz(null)} onConfirm={confirmCancel} deleting={deleting} />}
      {drillBiz    && (
        <DrillModal
          biz={drillBiz}
          allLogs={allLogs}
          onClose={() => setDrillBiz(null)}
          onPlanChange={(id, plan) => {
            qc.setQueryData(['admin_businesses'], (old = []) =>
              old.map(b => b.id === id ? { ...b, subscription_plan: plan, plan_id: plan } : b)
            );
          }}
        />
      )}
    </div>
  );
}
