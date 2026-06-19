import React, { useMemo } from 'react';
import { CheckCircle2, AlertCircle, Clock, AlertTriangle } from 'lucide-react';

const CARD = 'bg-[#161b25] border border-[#2a3042] rounded-xl overflow-hidden';

function fmtAgo(iso) {
  if (!iso) return '—';
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return 'עכשיו';
  if (h < 24) return `לפני ${h}ש`;
  return `לפני ${Math.floor(h / 24)} ימים`;
}

function statusOf(log) {
  if (log.status === 'error' || log.status === 'failed') return 'error';
  const h = Math.floor((Date.now() - new Date(log.start_time || 0).getTime()) / 3600000);
  if (h > 24) return 'stale';
  if (h > 12) return 'warning';
  return 'ok';
}

const STATUS_META = {
  ok:      { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'פעיל' },
  warning: { icon: Clock,        color: 'text-amber-400',   bg: 'bg-amber-500/10',   label: 'ממתין' },
  stale:   { icon: AlertTriangle,color: 'text-red-400',     bg: 'bg-red-500/10',     label: 'עצור' },
  error:   { icon: AlertCircle,  color: 'text-red-500',     bg: 'bg-red-500/15',     label: 'שגיאה' },
};

export default function AgentHealthTab({ allLogs }) {
  const agentRows = useMemo(() => {
    const map = {};
    for (const log of allLogs) {
      const name = log.automation_name || 'unknown';
      if (!map[name]) map[name] = log;
      else if (new Date(log.start_time) > new Date(map[name].start_time)) map[name] = log;
    }
    return Object.values(map)
      .map(log => ({ ...log, _status: statusOf(log) }))
      .sort((a, b) => {
        const o = { error: 0, stale: 1, warning: 2, ok: 3 };
        return (o[a._status] ?? 3) - (o[b._status] ?? 3);
      });
  }, [allLogs]);

  const counts = useMemo(() => ({
    total: agentRows.length,
    ok: agentRows.filter(r => r._status === 'ok').length,
    warning: agentRows.filter(r => r._status === 'warning').length,
    stale: agentRows.filter(r => r._status === 'stale').length,
    error: agentRows.filter(r => r._status === 'error').length,
  }), [agentRows]);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'סה"כ סוכנים', value: counts.total, color: 'text-white' },
          { label: 'פעילים', value: counts.ok, color: 'text-emerald-400' },
          { label: 'ממתינים', value: counts.warning, color: 'text-amber-400' },
          { label: 'שגיאות / עצורים', value: counts.error + counts.stale, color: 'text-red-400' },
        ].map(s => (
          <div key={s.label} className="bg-[#161b25] border border-[#2a3042] rounded-xl p-4 text-center">
            <div className={`text-[24px] font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[11px] text-slate-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Agent table */}
      <div className={CARD}>
        <div className="px-5 py-3 border-b border-[#2a3042]">
          <h3 className="text-[13px] font-semibold text-white">ניטור סוכנים — הרצה אחרונה</h3>
        </div>
        <div className="divide-y divide-[#2a3042] max-h-[65vh] overflow-y-auto">
          {agentRows.length === 0 && (
            <p className="text-center py-8 text-[12px] text-slate-500">אין נתוני הרצה ב-48 שעות האחרונות</p>
          )}
          {agentRows.map(log => {
            const s = STATUS_META[log._status] || STATUS_META.ok;
            const Icon = s.icon;
            return (
              <div key={log.automation_name} className="px-5 py-3 hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${s.bg}`}>
                    <Icon className={`w-3.5 h-3.5 ${s.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-medium text-white truncate">{log.automation_name}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${s.bg} ${s.color}`}>
                        {s.label}
                      </span>
                    </div>
                    {log.error_message && (
                      <p className="text-[10px] text-red-400 mt-0.5 truncate">{log.error_message}</p>
                    )}
                  </div>
                  <div className="text-left shrink-0 space-y-0.5">
                    <div className="text-[11px] text-slate-400">{fmtAgo(log.start_time)}</div>
                    <div className="text-[10px] text-slate-600">{log.items_processed ?? 0} פריטים</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
