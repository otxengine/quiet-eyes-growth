import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminClient } from '@/api/adminClient';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ChevronDown, ChevronUp, Heart } from 'lucide-react';

const CARD = 'bg-[#161b25] border border-[#2a3042] rounded-xl';

const fmtDate = (iso) => iso
  ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
  : '—';

function healthColor(score) {
  if (score == null) return 'text-slate-500';
  if (score >= 70) return 'text-emerald-400';
  if (score >= 40) return 'text-amber-400';
  return 'text-red-400';
}

function healthBadge(score) {
  if (score == null) return 'bg-slate-700 text-slate-400';
  if (score >= 70) return 'bg-emerald-900/60 text-emerald-400 border border-emerald-800';
  if (score >= 40) return 'bg-amber-900/60 text-amber-400 border border-amber-800';
  return 'bg-red-900/60 text-red-400 border border-red-800';
}

function churnBadge(risk) {
  if (!risk) return 'bg-slate-700 text-slate-400';
  const r = risk.toLowerCase();
  if (r === 'low')    return 'bg-emerald-900/60 text-emerald-400 border border-emerald-800';
  if (r === 'medium') return 'bg-amber-900/60 text-amber-400 border border-amber-800';
  return 'bg-red-900/60 text-red-400 border border-red-800';
}

const COMPONENTS = [
  { key: 'reputation_score',  label: 'מוניטין' },
  { key: 'leads_score',       label: 'לידים' },
  { key: 'competition_score', label: 'תחרות' },
  { key: 'market_score',      label: 'שוק' },
  { key: 'engagement_score',  label: 'מעורבות' },
  { key: 'seo_score',         label: 'SEO' },
];

export default function BusinessHealthTab({ allBusinesses }) {
  const [expanded, setExpanded] = useState(null);

  const { data: healthScores = [] } = useQuery({
    queryKey: ['admin_health_scores'],
    queryFn: () => adminClient.entities.HealthScore.filter({}, '-updated_date', 300).catch(() => []),
  });

  // Map health by business id
  const healthMap = useMemo(() => {
    const m = {};
    for (const h of healthScores) {
      if (h.linked_business) m[h.linked_business] = h;
    }
    return m;
  }, [healthScores]);

  // Platform aggregates
  const withHealth = allBusinesses.filter(b => healthMap[b.id]);
  const avgHealth  = withHealth.length
    ? Math.round(withHealth.reduce((s, b) => s + (healthMap[b.id]?.overall_score || 0), 0) / withHealth.length)
    : 0;
  const highChurnPct = withHealth.length
    ? Math.round(withHealth.filter(b => healthMap[b.id]?.churn_risk?.toLowerCase() === 'high').length / withHealth.length * 100)
    : 0;
  const lowTrustPct = withHealth.length
    ? Math.round(withHealth.filter(b => (healthMap[b.id]?.trust_score || 100) < 40).length / withHealth.length * 100)
    : 0;

  // Chart data — top 15 by health score
  const chartData = allBusinesses
    .filter(b => healthMap[b.id])
    .map(b => ({ name: b.name?.slice(0, 16) || '—', score: healthMap[b.id]?.overall_score || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  return (
    <div className="space-y-5">
      {/* Platform KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className={`${CARD} p-4`}>
          <p className="text-[11px] text-slate-400 mb-2">ממוצע ציון בריאות</p>
          <p className={`text-[28px] font-bold ${healthColor(avgHealth)}`}>{avgHealth || '—'}</p>
        </div>
        <div className={`${CARD} p-4`}>
          <p className="text-[11px] text-slate-400 mb-2">% סיכון נטישה גבוה</p>
          <p className={`text-[28px] font-bold ${highChurnPct > 30 ? 'text-red-400' : 'text-amber-400'}`}>
            {highChurnPct}%
          </p>
        </div>
        <div className={`${CARD} p-4`}>
          <p className="text-[11px] text-slate-400 mb-2">% אמון נמוך (&lt;40)</p>
          <p className={`text-[28px] font-bold ${lowTrustPct > 20 ? 'text-red-400' : 'text-slate-300'}`}>
            {lowTrustPct}%
          </p>
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className={`${CARD} p-0 overflow-hidden`}>
          <div className="px-5 py-3 border-b border-[#2a3042] flex items-center gap-2">
            <Heart className="w-4 h-4 text-rose-400" />
            <h3 className="text-[13px] font-semibold text-white">ציוני בריאות לפי עסק</h3>
          </div>
          <div className="p-4 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} width={120} />
                <Tooltip
                  contentStyle={{ background: '#161b25', border: '1px solid #2a3042', borderRadius: 8, fontSize: 11 }}
                />
                <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                  {chartData.map((e, i) => (
                    <Cell key={i} fill={e.score >= 70 ? '#34d399' : e.score >= 40 ? '#fbbf24' : '#f87171'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Health table */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="px-5 py-3 border-b border-[#2a3042] flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-white">בריאות עסקים</h3>
          <span className="text-[10px] text-slate-500">{allBusinesses.length} עסקים</span>
        </div>

        {/* Table header */}
        <div className="hidden md:grid grid-cols-[1fr_80px_80px_100px_70px_70px_110px] gap-2 px-5 py-2 text-[10px] font-semibold text-slate-500 bg-[#0d0f14] border-b border-[#2a3042]">
          <span>עסק</span>
          <span>ציון</span>
          <span>אמון</span>
          <span>סיכון נטישה</span>
          <span>לידים</span>
          <span>מתחרים</span>
          <span>עדכון אחרון</span>
        </div>

        <div className="divide-y divide-[#2a3042]">
          {allBusinesses.map(biz => {
            const h   = healthMap[biz.id];
            const isExpanded = expanded === biz.id;
            return (
              <div key={biz.id}>
                <div
                  className="grid grid-cols-1 md:grid-cols-[1fr_80px_80px_100px_70px_70px_110px] gap-2 px-5 py-3 items-center hover:bg-white/5 transition-colors cursor-pointer"
                  onClick={() => setExpanded(isExpanded ? null : biz.id)}
                >
                  <div className="flex items-center gap-2">
                    {isExpanded
                      ? <ChevronUp className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      : <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    }
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-white truncate">{biz.name}</p>
                      <p className="text-[10px] text-slate-500">{biz.category} · {biz.city}</p>
                    </div>
                  </div>
                  {/* Overall score */}
                  <span className={`text-[13px] font-bold ${healthColor(h?.overall_score)}`}>
                    {h?.overall_score ?? '—'}
                  </span>
                  {/* Trust */}
                  <span className={`text-[13px] font-bold ${healthColor(h?.trust_score)}`}>
                    {h?.trust_score ?? '—'}
                  </span>
                  {/* Churn risk */}
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full w-fit ${churnBadge(h?.churn_risk)}`}>
                    {h?.churn_risk || '—'}
                  </span>
                  <span className="text-[11px] text-slate-400">{h?.leads_count ?? '—'}</span>
                  <span className="text-[11px] text-slate-400">{h?.competitor_count ?? '—'}</span>
                  <span className="text-[10px] text-slate-500">{fmtDate(h?.updated_date)}</span>
                </div>

                {/* Expanded: 6-component breakdown */}
                {isExpanded && h && (
                  <div className="px-5 pb-4 bg-[#0d0f14]/50">
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-2 pt-2">
                      {COMPONENTS.map(({ key, label }) => {
                        const val = h[key];
                        return (
                          <div key={key} className="bg-[#0d0f14] rounded-lg p-3 border border-[#2a3042]">
                            <p className="text-[10px] text-slate-500 mb-1">{label}</p>
                            <p className={`text-[18px] font-bold ${healthColor(val)}`}>{val ?? '—'}</p>
                          </div>
                        );
                      })}
                    </div>
                    {h.insights && (
                      <p className="mt-2 text-[10px] text-slate-400 leading-snug">{h.insights}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
