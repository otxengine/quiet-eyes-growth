import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminClient, adminFetch } from '@/api/adminClient';
import { AlertCircle, CheckCircle2, Activity, TrendingUp, Users, Zap, DollarSign } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { agentCost } from '@/lib/planConfig';

const CARD = 'bg-[#161b25] border border-[#2a3042] rounded-xl p-4';

function KpiCard({ label, value, color = 'text-white', icon: Icon }) {
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-medium text-slate-400">{label}</p>
        {Icon && <Icon className="w-4 h-4 text-slate-600" />}
      </div>
      <span className={`text-[28px] font-bold tracking-tight ${color}`}>{value}</span>
    </div>
  );
}

const fmtDate = (iso) => iso
  ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
  : '—';

export default function OverviewTab({ allBusinesses, allLogs, allSignals, allLeads }) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

  const { data: agentStatus = [] } = useQuery({
    queryKey: ['admin_agent_status'],
    queryFn: () => adminFetch('/agents/status').catch(() => []),
    refetchInterval: 60000,
  });

  const activeIds = useMemo(() =>
    new Set(allLogs.filter(l => l.start_time > sevenDaysAgo).map(l => l.linked_business)),
    [allLogs, sevenDaysAgo]
  );

  const failedLogs   = allLogs.filter(l => l.status === 'failed');
  const successLogs  = allLogs.filter(l => l.status === 'success');
  const successRate  = allLogs.length > 0 ? Math.round(successLogs.length / allLogs.length * 100) : 0;

  const monthStart = new Date();
  monthStart.setUTCDate(1); monthStart.setUTCHours(0,0,0,0);
  const monthStartISO = monthStart.toISOString();
  const estMonthlyCost = allLogs
    .filter(l => (l.start_time || '') >= monthStartISO)
    .reduce((s, l) => s + agentCost(l.automation_name), 0)
    .toFixed(2);

  const agentBreakdown = useMemo(() => {
    const map = {};
    for (const l of allLogs) {
      if (!map[l.automation_name]) map[l.automation_name] = { total: 0, success: 0 };
      map[l.automation_name].total++;
      if (l.status === 'success') map[l.automation_name].success++;
    }
    return Object.entries(map)
      .map(([name, s]) => ({ name, rate: Math.round(s.success / s.total * 100), total: s.total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
  }, [allLogs]);

  return (
    <div className="space-y-5">
      {/* KPI row 1 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="עסקים רשומים"   value={allBusinesses.length} color="text-indigo-400" icon={Users} />
        <KpiCard label="פעילים 7 ימים"  value={activeIds.size}       color="text-emerald-400" icon={Activity} />
        <KpiCard label="אותות שוק"       value={allSignals.length}    color="text-sky-400" icon={TrendingUp} />
        <KpiCard label="לידים"           value={allLeads.length}      color="text-violet-400" icon={Zap} />
      </div>

      {/* KPI row 2 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label='ריצות Agent סה"כ' value={allLogs.length}     color="text-white" icon={Activity} />
        <KpiCard label="הצלחות"           value={successLogs.length}  color="text-emerald-400" />
        <KpiCard label="כשלים"            value={failedLogs.length}   color="text-red-400" />
        <KpiCard
          label="עלות חודשית מוערכת"
          value={`$${estMonthlyCost}`}
          color="text-amber-400"
          icon={DollarSign}
        />
      </div>

      {/* Agent Heartbeat */}
      {agentStatus.length > 0 && (
        <div className={`${CARD} p-0 overflow-hidden`}>
          <div className="px-5 py-3 border-b border-[#2a3042]">
            <h3 className="text-[13px] font-semibold text-white">Agent Heartbeat</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-[#2a3042]">
            {agentStatus.map((a) => {
              const lastPing = a.last_ping ? new Date(a.last_ping) : null;
              const minsAgo  = lastPing ? Math.round((Date.now() - lastPing) / 60000) : null;
              const healthy  = minsAgo !== null && minsAgo < 30;
              return (
                <div key={a.agent_name} className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${healthy ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    <span className="text-[11px] font-medium text-white truncate">{a.agent_name}</span>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    {minsAgo === null ? 'לא ידוע' : minsAgo < 60 ? `${minsAgo}m ago` : `${Math.round(minsAgo/60)}h ago`}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Agent success rate bar chart */}
      {agentBreakdown.length > 0 && (
        <div className={`${CARD} p-0 overflow-hidden`}>
          <div className="px-5 py-3 border-b border-[#2a3042]">
            <h3 className="text-[13px] font-semibold text-white">Success Rate לפי Agent</h3>
          </div>
          <div className="p-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agentBreakdown} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => `${v}%`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} width={140} />
                <Tooltip
                  contentStyle={{ background: '#161b25', border: '1px solid #2a3042', borderRadius: 8, fontSize: 11 }}
                  formatter={(v) => [`${v}%`, 'Success']}
                />
                <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
                  {agentBreakdown.map((e) => (
                    <Cell key={e.name} fill={e.rate >= 90 ? '#34d399' : e.rate >= 70 ? '#fbbf24' : '#f87171'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Recent errors */}
      {failedLogs.length > 0 && (
        <div className={`${CARD} p-0 overflow-hidden`}>
          <div className="px-5 py-3 border-b border-[#2a3042] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <h3 className="text-[13px] font-semibold text-white">כשלים אחרונים</h3>
            <span className="text-[10px] text-slate-500 mr-auto">{failedLogs.length}</span>
          </div>
          <div className="divide-y divide-[#2a3042]">
            {failedLogs.slice(0, 8).map(log => {
              const biz = allBusinesses.find(b => b.id === log.linked_business);
              return (
                <div key={log.id} className="px-5 py-3">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[12px] font-medium text-white">{log.automation_name}</span>
                    <span className="text-[10px] text-slate-500">· {biz?.name || 'Unknown'}</span>
                    <span className="text-[10px] text-slate-600 mr-auto">{fmtDate(log.start_time)}</span>
                  </div>
                  {log.error_message && (
                    <p className="text-[10px] text-red-400 font-mono leading-snug">{log.error_message.slice(0, 200)}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Agent breakdown table */}
      <div className={`${CARD} p-0 overflow-hidden`}>
        <div className="px-5 py-3 border-b border-[#2a3042] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-slate-500" />
          <h3 className="text-[13px] font-semibold text-white">פעילות לפי Agent</h3>
        </div>
        <div className="divide-y divide-[#2a3042]">
          {agentBreakdown.map(({ name, rate, total }) => (
            <div key={name} className="px-5 py-3 flex items-center gap-3">
              <span className="text-[12px] font-medium text-white flex-1 truncate">{name}</span>
              <span className="text-[11px] text-slate-400">{total} ריצות</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                rate >= 90 ? 'bg-emerald-900/60 text-emerald-400' :
                rate >= 70 ? 'bg-amber-900/60 text-amber-400' : 'bg-red-900/60 text-red-400'
              }`}>{rate}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
