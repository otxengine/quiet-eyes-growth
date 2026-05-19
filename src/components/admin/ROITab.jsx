import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminClient } from '@/api/adminClient';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { DollarSign, TrendingUp, Zap, Percent } from 'lucide-react';

const CARD = 'bg-[#161b25] border border-[#2a3042] rounded-xl';

const PLAN_MRR = {
  free_trial: 0,
  starter:    99,
  growth:     249,
  pro:        499,
  enterprise: 999,
};

const AGENT_COST_ESTIMATE = 0.015; // $ per run

function KpiCard({ label, value, sub, icon: Icon, color = 'text-white' }) {
  return (
    <div className={`${CARD} p-4`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-medium text-slate-400">{label}</p>
        {Icon && <Icon className="w-4 h-4 text-slate-600" />}
      </div>
      <p className={`text-[26px] font-bold tracking-tight ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function ROITab({ allBusinesses, allLogs }) {
  const { data: outcomeLogs = [] } = useQuery({
    queryKey: ['admin_outcome_logs'],
    queryFn: () => adminClient.entities.OutcomeLog.filter({}, '-created_date', 500).catch(() => []),
  });

  const monthStart = new Date();
  monthStart.setUTCDate(1); monthStart.setUTCHours(0,0,0,0);
  const monthStartISO = monthStart.toISOString();

  const monthLogs = allLogs.filter(l => (l.start_time || '') >= monthStartISO);

  const totalRevImpact = outcomeLogs.reduce((s, o) => s + (Number(o.revenue_impact) || 0), 0);
  const totalMRR       = allBusinesses.reduce((s, b) => s + (PLAN_MRR[b.subscription_plan || b.plan_id || 'free_trial'] || 0), 0);
  const totalCost      = monthLogs.length * AGENT_COST_ESTIMATE;
  const grossMargin    = totalMRR > 0 ? Math.round(((totalMRR - totalCost) / totalMRR) * 100) : 0;

  const bizRows = useMemo(() => {
    return allBusinesses.map(biz => {
      const plan    = biz.subscription_plan || biz.plan_id || 'free_trial';
      const mrr     = PLAN_MRR[plan] || 0;
      const bizLogs = monthLogs.filter(l => l.linked_business === biz.id);
      const cost    = +(bizLogs.length * AGENT_COST_ESTIMATE).toFixed(2);
      const revenue = outcomeLogs
        .filter(o => o.linked_business === biz.id)
        .reduce((s, o) => s + (Number(o.revenue_impact) || 0), 0);
      const profit  = mrr - cost;
      const roi     = cost > 0 ? Math.round(((mrr - cost) / cost) * 100) : 0;
      return { biz, plan, mrr, cost, revenue, profit, roi, runs: bizLogs.length };
    }).sort((a, b) => b.roi - a.roi);
  }, [allBusinesses, monthLogs, outcomeLogs]);

  const top10Chart = bizRows.slice(0, 10).map(r => ({
    name: r.biz.name?.slice(0, 18) || '—',
    roi: Math.max(r.roi, 0),
  }));

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label='סה"כ השפעת הכנסה'
          value={`₪${totalRevImpact.toLocaleString()}`}
          color="text-emerald-400"
          icon={TrendingUp}
          sub="מ-OutcomeLog"
        />
        <KpiCard
          label="MRR מחושב"
          value={`$${totalMRR.toLocaleString()}`}
          color="text-indigo-400"
          icon={DollarSign}
          sub={`${allBusinesses.length} עסקים`}
        />
        <KpiCard
          label="עלות Agent חודשית"
          value={`$${totalCost.toFixed(0)}`}
          color="text-amber-400"
          icon={Zap}
          sub={`${monthLogs.length} ריצות`}
        />
        <KpiCard
          label="מרג'ין ברוטו מוערך"
          value={`${grossMargin}%`}
          color={grossMargin > 60 ? 'text-emerald-400' : grossMargin > 30 ? 'text-amber-400' : 'text-red-400'}
          icon={Percent}
        />
      </div>

      {/* ROI chart */}
      {top10Chart.length > 0 && (
        <div className={`${CARD} p-0 overflow-hidden`}>
          <div className="px-5 py-3 border-b border-[#2a3042]">
            <h3 className="text-[13px] font-semibold text-white">Top 10 עסקים לפי ROI</h3>
          </div>
          <div className="p-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={top10Chart} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => `${v}%`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} width={130} />
                <Tooltip
                  contentStyle={{ background: '#161b25', border: '1px solid #2a3042', borderRadius: 8, fontSize: 11 }}
                  formatter={(v) => [`${v}%`, 'ROI']}
                />
                <Bar dataKey="roi" radius={[0, 4, 4, 0]}>
                  {top10Chart.map((e, i) => (
                    <Cell key={i} fill={e.roi > 1000 ? '#34d399' : e.roi > 300 ? '#818cf8' : '#fbbf24'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Per-business table */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="px-5 py-3 border-b border-[#2a3042]">
          <h3 className="text-[13px] font-semibold text-white">פירוט לפי עסק</h3>
        </div>

        {/* Table header */}
        <div className="hidden md:grid grid-cols-[1fr_80px_70px_70px_70px_70px_70px] gap-2 px-5 py-2 text-[10px] font-semibold text-slate-500 bg-[#0d0f14] border-b border-[#2a3042]">
          <span>עסק</span>
          <span>תכנית</span>
          <span>MRR</span>
          <span>עלות</span>
          <span>רווח</span>
          <span>ROI%</span>
          <span>ריצות</span>
        </div>

        <div className="divide-y divide-[#2a3042] max-h-96 overflow-y-auto">
          {bizRows.map(({ biz, plan, mrr, cost, profit, roi, runs }) => (
            <div key={biz.id} className="grid grid-cols-1 md:grid-cols-[1fr_80px_70px_70px_70px_70px_70px] gap-2 px-5 py-3 items-center hover:bg-white/5 transition-colors">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-white truncate">{biz.name}</p>
                <p className="text-[10px] text-slate-500">{biz.city}</p>
              </div>
              <span className="text-[10px] text-slate-400">{plan}</span>
              <span className="text-[11px] text-indigo-400">${mrr}</span>
              <span className="text-[11px] text-amber-400">${cost}</span>
              <span className={`text-[11px] font-semibold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                ${profit.toFixed(0)}
              </span>
              <span className={`text-[11px] font-bold ${
                roi > 500 ? 'text-emerald-400' : roi > 100 ? 'text-amber-400' : 'text-slate-400'
              }`}>
                {roi > 0 ? `${roi}%` : '—'}
              </span>
              <span className="text-[11px] text-slate-400">{runs}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
