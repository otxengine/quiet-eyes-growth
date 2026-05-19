import React from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

const CARD = 'bg-[#161b25] border border-[#2a3042] rounded-xl overflow-hidden';

const fmtDate = (iso) => iso
  ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
  : '—';

export default function AgentLogsTab({ allLogs, allBusinesses }) {
  return (
    <div className={CARD}>
      <div className="px-5 py-3 border-b border-[#2a3042] flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-white">כל ריצות ה-Agents</h3>
        <span className="text-[10px] text-slate-500">{allLogs.length} רשומות</span>
      </div>
      <div className="divide-y divide-[#2a3042] max-h-[70vh] overflow-y-auto">
        {allLogs.map(log => {
          const biz = allBusinesses.find(b => b.id === log.linked_business);
          return (
            <div key={log.id} className="px-5 py-3 hover:bg-white/5 transition-colors">
              <div className="flex items-center gap-2">
                {log.status === 'success'
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  : <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                }
                <span className="text-[12px] font-medium text-white">{log.automation_name}</span>
                <span className="text-[10px] text-slate-600">·</span>
                <span className="text-[11px] text-slate-400 truncate flex-1">{biz?.name || log.linked_business?.slice(0, 16)}</span>
                <span className="text-[10px] text-slate-500 shrink-0">{log.items_processed || 0} תוצרים</span>
                <span className="text-[10px] text-slate-600 shrink-0">{fmtDate(log.start_time)}</span>
              </div>
              {log.error_message && (
                <p className="mt-1 pr-5 text-[10px] text-red-400 font-mono leading-snug">
                  {log.error_message.slice(0, 200)}
                </p>
              )}
            </div>
          );
        })}
        {allLogs.length === 0 && (
          <p className="px-5 py-8 text-center text-[12px] text-slate-500">אין לוגים</p>
        )}
      </div>
    </div>
  );
}
