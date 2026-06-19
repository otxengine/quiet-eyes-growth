import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminClient } from '@/api/adminClient';
import { MessageSquare, Clock, CheckCircle, AlertCircle } from 'lucide-react';

const STATUS_CONFIG = {
  open:        { label: 'פתוח',      color: '#E8344D', bg: '#fee2e8', Icon: AlertCircle },
  in_progress: { label: 'בטיפול',    color: '#f59e0b', bg: '#fef3c7', Icon: Clock },
  resolved:    { label: 'נפתר',      color: '#10b981', bg: '#d1fae5', Icon: CheckCircle },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.open;
  const { Icon } = cfg;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function formatDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

export default function SupportTicketsTab() {
  const { data: tickets = [], isLoading, error } = useQuery({
    queryKey: ['admin_support_tickets'],
    queryFn: () => adminClient.entities.SupportTicket.filter({}, '-created_date', 200),
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-950/40 border border-red-800 rounded-xl text-red-400 text-[13px]">
        שגיאה בטעינת פניות תמיכה. ייתכן שהישות SupportTicket טרם נוצרה.
      </div>
    );
  }

  const open     = tickets.filter(t => t.status === 'open').length;
  const resolved = tickets.filter(t => t.status === 'resolved').length;

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'סה"כ פניות', value: tickets.length, color: '#818cf8' },
          { label: 'פתוחות',     value: open,            color: '#E8344D' },
          { label: 'נפתרו',      value: resolved,        color: '#10b981' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-[#161927] rounded-xl p-4 border border-[#2a3042]">
            <p className="text-[11px] text-slate-500 mb-1">{label}</p>
            <p className="text-[22px] font-bold" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Tickets table */}
      {tickets.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-[13px]">
          <MessageSquare className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p>אין פניות תמיכה עדיין</p>
        </div>
      ) : (
        <div className="bg-[#161927] rounded-2xl border border-[#2a3042] overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[#2a3042] text-slate-500">
                <th className="text-right px-4 py-3 font-medium">תיאור</th>
                <th className="text-right px-4 py-3 font-medium">משתמש</th>
                <th className="text-right px-4 py-3 font-medium">סטטוס</th>
                <th className="text-right px-4 py-3 font-medium">תאריך</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t, i) => (
                <tr
                  key={t.id || i}
                  className="border-b border-[#2a3042]/50 hover:bg-[#1e2236] transition-colors"
                >
                  <td className="px-4 py-3 text-slate-300 max-w-[300px]">
                    <p className="truncate">{t.description || '—'}</p>
                    {t.recording_url && (
                      <span className="text-[10px] text-indigo-400 mt-0.5 block">+ הקלטה</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{t.user_email || '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(t.created_date || t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
