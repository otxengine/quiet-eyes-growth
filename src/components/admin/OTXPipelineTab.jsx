import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminClient, adminFetch } from '@/api/adminClient';
import {
  FunnelChart, Funnel, LabelList, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Cell,
} from 'recharts';
import { Activity, Loader2, CheckCircle2, AlertCircle, Clock } from 'lucide-react';

const CARD = 'bg-[#161b25] border border-[#2a3042] rounded-xl';

const fmtDate = (iso) => iso
  ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
  : '—';

const fmtMs = (ms) => ms
  ? ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
  : '—';

const STATUS_BADGE = {
  success:   'bg-emerald-900/60 text-emerald-400 border border-emerald-800',
  failed:    'bg-red-900/60 text-red-400 border border-red-800',
  running:   'bg-sky-900/60 text-sky-400 border border-sky-800 animate-pulse',
  pending:   'bg-slate-700/60 text-slate-300 border border-slate-600',
  scheduled: 'bg-amber-900/60 text-amber-400 border border-amber-800',
};

export default function OTXPipelineTab({ allBusinesses, allLogs }) {
  // Aggregate pipeline stats from automation logs
  const { data: decisions = [] } = useQuery({
    queryKey: ['admin_otx_decisions'],
    queryFn: async () => {
      try {
        return await adminFetch('/entities/AutoAction?sort=-created_date&limit=100');
      } catch {
        return [];
      }
    },
  });

  const { data: kpiData = {} } = useQuery({
    queryKey: ['admin_otx_kpi'],
    queryFn: async () => {
      if (!allBusinesses.length) return {};
      try {
        const first = allBusinesses[0];
        return await adminFetch(`/kpi/${first.id}?days=30`);
      } catch { return {}; }
    },
    enabled: allBusinesses.length > 0,
  });

  // Build funnel data from allLogs
  const funnelData = useMemo(() => {
    const total     = allLogs.length;
    const success   = allLogs.filter(l => l.status === 'success').length;
    const withItems = allLogs.filter(l => (l.items_processed || 0) > 0).length;

    // signals processed aggregated
    const signalsTotal = allLogs.reduce((s, l) => s + (l.items_processed || 0), 0);

    return [
      { name: 'ריצות Pipeline',    value: total,        fill: '#6366f1' },
      { name: 'הצלחות',            value: success,       fill: '#818cf8' },
      { name: 'עם תוצרים',         value: withItems,     fill: '#a5b4fc' },
      { name: 'אותות מעובדים',     value: Math.min(signalsTotal, total * 5), fill: '#c7d2fe' },
    ].filter(d => d.value > 0);
  }, [allLogs]);

  // Recent pipeline runs (last 20)
  const recentRuns = allLogs.slice(0, 20);

  // Decisions from AutoAction / otx_decisions
  const recentDecisions = Array.isArray(decisions)
    ? decisions.slice(0, 20)
    : [];

  return (
    <div className="space-y-5">
      {/* Funnel chart */}
      <div className={`${CARD} p-0 overflow-hidden`}>
        <div className="px-5 py-3 border-b border-[#2a3042] flex items-center gap-2">
          <Activity className="w-4 h-4 text-indigo-400" />
          <h3 className="text-[13px] font-semibold text-white">Pipeline Funnel</h3>
        </div>
        {funnelData.length > 0 ? (
          <div className="p-4 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <FunnelChart>
                <Tooltip
                  contentStyle={{ background: '#161b25', border: '1px solid #2a3042', borderRadius: 8, fontSize: 11 }}
                />
                <Funnel dataKey="value" data={funnelData} isAnimationActive>
                  <LabelList position="center" fill="#fff" stroke="none" dataKey="name" style={{ fontSize: 11 }} />
                  <LabelList position="right" fill="#94a3b8" stroke="none" dataKey="value" style={{ fontSize: 10 }} />
                </Funnel>
              </FunnelChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="px-5 py-8 text-center text-[12px] text-slate-500">אין נתוני pipeline</p>
        )}
      </div>

      {/* KPI data (if available) */}
      {Object.keys(kpiData).length > 0 && (
        <div className={`${CARD} p-4`}>
          <h3 className="text-[12px] font-semibold text-white mb-3">KPI נתוני Pipeline</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(kpiData).slice(0, 8).map(([k, v]) => (
              <div key={k} className="bg-[#0d0f14] rounded-lg p-3 border border-[#2a3042]">
                <p className="text-[10px] text-slate-500 mb-1">{k}</p>
                <p className="text-[16px] font-bold text-indigo-400">{typeof v === 'number' ? v.toLocaleString() : String(v)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pipeline runs table */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="px-5 py-3 border-b border-[#2a3042] flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-white">ריצות Pipeline אחרונות</h3>
          <span className="text-[10px] text-slate-500">20 אחרונות</span>
        </div>

        {/* Header */}
        <div className="hidden md:grid grid-cols-[1fr_140px_80px_80px_80px_80px] gap-2 px-5 py-2 text-[10px] font-semibold text-slate-500 bg-[#0d0f14] border-b border-[#2a3042]">
          <span>Agent</span>
          <span>עסק</span>
          <span>משך</span>
          <span>תוצרים</span>
          <span>סטטוס</span>
          <span>זמן</span>
        </div>

        <div className="divide-y divide-[#2a3042]">
          {recentRuns.map(log => {
            const biz = allBusinesses.find(b => b.id === log.linked_business);
            const durationMs = log.end_time && log.start_time
              ? new Date(log.end_time) - new Date(log.start_time)
              : log.duration_ms;
            return (
              <div key={log.id} className="grid grid-cols-1 md:grid-cols-[1fr_140px_80px_80px_80px_80px] gap-2 px-5 py-3 items-center hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-2">
                  {log.status === 'success'
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    : log.status === 'running'
                    ? <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />
                    : <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  }
                  <span className="text-[12px] text-white truncate">{log.automation_name}</span>
                </div>
                <span className="text-[11px] text-slate-400 truncate">{biz?.name || '—'}</span>
                <span className="text-[11px] text-slate-400">{fmtMs(durationMs)}</span>
                <span className="text-[11px] text-slate-300">{log.items_processed || 0}</span>
                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full w-fit ${STATUS_BADGE[log.status] || STATUS_BADGE.pending}`}>
                  {log.status}
                </span>
                <span className="text-[10px] text-slate-500">{fmtDate(log.start_time)}</span>
              </div>
            );
          })}
          {recentRuns.length === 0 && (
            <p className="px-5 py-8 text-center text-[12px] text-slate-500">אין ריצות</p>
          )}
        </div>
      </div>

      {/* Decisions tracker */}
      {recentDecisions.length > 0 && (
        <div className={`${CARD} overflow-hidden`}>
          <div className="px-5 py-3 border-b border-[#2a3042]">
            <h3 className="text-[13px] font-semibold text-white">Decisions Tracker</h3>
          </div>
          <div className="divide-y divide-[#2a3042]">
            {recentDecisions.map(d => (
              <div key={d.id} className="px-5 py-3 flex items-center gap-3 hover:bg-white/5">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-900/60 text-indigo-300 border border-indigo-800 shrink-0">
                  {d.action_type || d.type || 'action'}
                </span>
                <span className="text-[12px] text-white flex-1 truncate">{d.description || d.title || JSON.stringify(d).slice(0, 60)}</span>
                {d.confidence_score != null && (
                  <span className={`text-[10px] font-semibold ${d.confidence_score >= 0.7 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {Math.round(d.confidence_score * 100)}%
                  </span>
                )}
                <span className={`text-[9px] px-2 py-0.5 rounded-full ${STATUS_BADGE[d.status] || STATUS_BADGE.pending}`}>
                  {d.status || 'pending'}
                </span>
                <span className="text-[10px] text-slate-600 shrink-0">{fmtDate(d.created_date || d.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
