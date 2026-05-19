import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminClient, adminFetch } from '@/api/adminClient';
import { CheckCircle2, XCircle, Clock, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const CARD = 'bg-[#161b25] border border-[#2a3042] rounded-xl';

const fmtDate = (iso) => iso
  ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
  : '—';

const isExpiringSoon = (iso) => {
  if (!iso) return false;
  return new Date(iso) - Date.now() < 3600_000; // < 1 hour
};

export default function ApprovalsTab({ allBusinesses }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('pending');
  const [acting, setActing]  = useState(null);

  const { data: approvals = [], isLoading } = useQuery({
    queryKey: ['admin_approvals', filter],
    queryFn: async () => {
      try {
        // Try entity endpoint for v3_approval_requests
        const rows = await adminClient.entities.BusinessProfile
          .filter({}, '-created_date', 1)
          .catch(() => []);

        // Fall back to direct API calls per business
        const results = [];
        for (const biz of allBusinesses.slice(0, 30)) {
          try {
            const data = await adminFetch(`/approvals/${biz.id}`);
            if (Array.isArray(data)) {
              results.push(...data.map(a => ({ ...a, _bizName: biz.name })));
            }
          } catch { /* no approvals for this biz */ }
        }
        return results;
      } catch {
        return [];
      }
    },
    refetchInterval: 30000,
  });

  const filtered = filter === 'pending'
    ? approvals.filter(a => a.status === 'pending' || !a.status)
    : approvals;

  const act = async (id, action) => {
    setActing(id + action);
    try {
      await adminFetch(`/approvals/${id}/${action}`, { method: 'POST' });
      toast.success(action === 'approve' ? 'אושר ✓' : 'נדחה');
      qc.invalidateQueries({ queryKey: ['admin_approvals'] });
    } catch (e) {
      toast.error('שגיאה: ' + e.message);
    }
    setActing(null);
  };

  return (
    <div className="space-y-4">
      {/* Filter toggle */}
      <div className="flex gap-2">
        {[
          { key: 'pending', label: 'ממתינים בלבד' },
          { key: 'all',     label: 'כל האישורים' },
        ].map(opt => (
          <button
            key={opt.key}
            onClick={() => setFilter(opt.key)}
            className={`px-4 py-1.5 rounded-full text-[11px] font-semibold transition-all ${
              filter === opt.key
                ? 'bg-indigo-600 text-white'
                : 'bg-[#2a3042] text-slate-400 hover:text-white'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <span className="mr-auto text-[11px] text-slate-500 self-center">
          {filtered.length} רשומות
        </span>
      </div>

      <div className={`${CARD} overflow-hidden`}>
        <div className="px-5 py-3 border-b border-[#2a3042]">
          <h3 className="text-[13px] font-semibold text-white">אישורים ממתינים</h3>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-400/50" />
            <p className="text-[12px] text-slate-500">אין אישורים ממתינים</p>
          </div>
        ) : (
          <div className="divide-y divide-[#2a3042]">
            {/* Header row */}
            <div className="hidden md:grid grid-cols-[1fr_120px_1fr_100px_100px_120px] gap-3 px-5 py-2 text-[10px] font-semibold text-slate-500 bg-[#0d0f14]">
              <span>עסק</span>
              <span>סוג פעולה</span>
              <span>תיאור</span>
              <span>התקבל מ</span>
              <span>תפוגה</span>
              <span>פעולות</span>
            </div>

            {filtered.map(a => {
              const expiring = isExpiringSoon(a.expires_at);
              const bizName  = a._bizName || allBusinesses.find(b => b.id === a.business_id)?.name || 'Unknown';
              return (
                <div key={a.id} className={`px-5 py-3.5 hover:bg-white/5 transition-colors ${expiring ? 'border-r-2 border-amber-500' : ''}`}>
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_1fr_100px_100px_120px] gap-3 items-center">
                    <div>
                      <p className="text-[12px] font-semibold text-white">{bizName}</p>
                      <p className="text-[10px] text-slate-500">{a.id?.slice(0, 8)}</p>
                    </div>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#2a3042] text-slate-300 w-fit">
                      {a.action_type || a.type || 'פעולה'}
                    </span>
                    <p className="text-[11px] text-slate-400 leading-snug line-clamp-2">
                      {a.description || a.message || JSON.stringify(a.payload || {}).slice(0, 80)}
                    </p>
                    <span className="text-[10px] text-slate-500">{a.requested_by || a.source || '—'}</span>
                    <div className="flex items-center gap-1">
                      {expiring && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                      <span className={`text-[10px] ${expiring ? 'text-amber-400' : 'text-slate-500'}`}>
                        {a.expires_at ? fmtDate(a.expires_at) : '—'}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      {(a.status === 'pending' || !a.status) && (
                        <>
                          <button
                            onClick={() => act(a.id, 'approve')}
                            disabled={!!acting}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-emerald-900/60 text-emerald-400 hover:bg-emerald-900 border border-emerald-800 disabled:opacity-50 transition"
                          >
                            {acting === a.id + 'approve' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                            אשר
                          </button>
                          <button
                            onClick={() => act(a.id, 'reject')}
                            disabled={!!acting}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-red-900/60 text-red-400 hover:bg-red-900 border border-red-800 disabled:opacity-50 transition"
                          >
                            {acting === a.id + 'reject' ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                            דחה
                          </button>
                        </>
                      )}
                      {a.status && a.status !== 'pending' && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                          a.status === 'approved' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'
                        }`}>{a.status}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
