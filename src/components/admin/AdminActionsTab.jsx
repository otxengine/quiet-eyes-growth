import React, { useState } from 'react';
import { adminClient, adminFetch } from '@/api/adminClient';
import { Loader2, Zap, Database } from 'lucide-react';
import { toast } from 'sonner';

const CARD = 'bg-[#161b25] border border-[#2a3042] rounded-xl';

const AGENTS = [
  { id: 'runMarketIntelligence',       label: 'ניתוח שוק' },
  { id: 'detectEvents',                label: 'זיהוי אירועים' },
  { id: 'findSocialLeads',             label: 'לידים חברתיים' },
  { id: 'collectWebSignals',           label: 'איסוף אותות רשת' },
  { id: 'runCompetitorIdentification', label: 'זיהוי מתחרים' },
  { id: 'competitorIntelAgent',        label: 'OSINT מתחרים' },
  { id: 'detectCompetitorChanges',     label: 'שינויי מתחרים' },
  { id: 'cleanupAndLearn',             label: 'ניקוי ולמידה' },
  { id: 'scanServicesAndPrices',       label: 'סריקת שירותים ומחירים' },
  { id: 'generateWeeklyReport',        label: 'דוח שבועי' },
];

export default function AdminActionsTab({ allBusinesses, onLogsRefresh }) {
  const [selectedBiz, setSelectedBiz]     = useState('');
  const [selectedAgent, setSelectedAgent] = useState(AGENTS[0].id);
  const [running, setRunning]             = useState(false);
  const [agentResult, setAgentResult]     = useState(null);
  const [migrating, setMigrating]         = useState(false);
  const [migrateResult, setMigrateResult] = useState(null);

  const handleMigrate = async () => {
    setMigrating(true);
    setMigrateResult(null);
    try {
      const res = await adminFetch('/migrate', { method: 'POST' });
      setMigrateResult(res);
      const ok = (res.results || []).length;
      const err = (res.errors || []).length;
      toast.success(`מיגרציה הושלמה — ${ok} הצלחות, ${err} שגיאות`);
    } catch (e) {
      toast.error('מיגרציה נכשלה: ' + e.message);
      setMigrateResult({ error: e.message });
    }
    setMigrating(false);
  };

  const handleRun = async () => {
    if (!selectedBiz) { toast.error('בחר עסק'); return; }
    setRunning(true);
    setAgentResult(null);
    try {
      const res = await adminClient.functions.invoke(selectedAgent, { businessProfileId: selectedBiz });
      setAgentResult(res?.data || res);
      toast.success('Agent הסתיים ✓');
      onLogsRefresh?.();
    } catch (err) {
      toast.error('שגיאה: ' + err.message);
      setAgentResult({ error: err.message });
    }
    setRunning(false);
  };

  return (
    <div className="space-y-4 max-w-lg">

      {/* ── Database migrations ─────────────────────────────────── */}
      <div className={`${CARD} p-5 space-y-3`}>
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-amber-400" />
          <h3 className="text-[13px] font-semibold text-white">מיגרציות DB</h3>
        </div>
        <p className="text-[11px] text-slate-400">
          מריץ את כל ה-ALTER TABLE והאינדקסים החסרים. בטוח להריץ כמה פעמים (IF NOT EXISTS).
        </p>
        <button
          onClick={handleMigrate}
          disabled={migrating}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[12px] font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-all"
        >
          {migrating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
          {migrating ? 'מריץ מיגרציות...' : 'הרץ מיגרציות'}
        </button>
        {migrateResult && (
          <div className="p-3 bg-[#0d0f14] rounded-lg border border-[#2a3042]">
            <p className="text-[10px] font-semibold text-slate-400 mb-1">
              {(migrateResult.results || []).length} הצלחות · {(migrateResult.errors || []).length} שגיאות
            </p>
            {(migrateResult.errors || []).length > 0 && (
              <pre className="text-[10px] text-red-400 font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                {(migrateResult.errors || []).join('\n')}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* ── Manual agent run ─────────────────────────────────────── */}
      <div className={`${CARD} p-5 space-y-4`}>
        <h3 className="text-[13px] font-semibold text-white">הרצת Agent ידנית</h3>

        <div>
          <label className="text-[11px] font-medium text-slate-400 block mb-1.5">עסק</label>
          <select
            value={selectedBiz}
            onChange={e => setSelectedBiz(e.target.value)}
            className="w-full text-[12px] border border-[#2a3042] rounded-lg px-3 py-2.5 bg-[#0d0f14] text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            dir="rtl"
          >
            <option value="">— בחר עסק —</option>
            {allBusinesses.map(b => (
              <option key={b.id} value={b.id}>{b.name} — {b.city}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[11px] font-medium text-slate-400 block mb-1.5">Agent</label>
          <select
            value={selectedAgent}
            onChange={e => setSelectedAgent(e.target.value)}
            className="w-full text-[12px] border border-[#2a3042] rounded-lg px-3 py-2.5 bg-[#0d0f14] text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            dir="rtl"
          >
            {AGENTS.map(a => (
              <option key={a.id} value={a.id}>{a.label} — {a.id}</option>
            ))}
          </select>
        </div>

        <button
          onClick={handleRun}
          disabled={running || !selectedBiz}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-all"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          {running ? 'מריץ...' : 'הרץ Agent'}
        </button>

        {agentResult && (
          <div className="p-3 bg-[#0d0f14] rounded-lg border border-[#2a3042]">
            <p className="text-[10px] font-semibold text-slate-400 mb-2">תוצאה:</p>
            <pre className="text-[10px] text-emerald-400 font-mono whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
              {JSON.stringify(agentResult, null, 2).slice(0, 1200)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
