import React from 'react';
import { useNavigate } from 'react-router-dom';
import WeeklyScoreRing from './WeeklyScoreRing';

const HOUR = new Date().getHours();
const GREETING =
  HOUR >= 5  && HOUR < 12 ? 'בוקר טוב' :
  HOUR >= 12 && HOUR < 17 ? 'צהריים טובים' :
  HOUR >= 17 && HOUR < 21 ? 'ערב טוב' : 'לילה טוב';

function localScore(stats) {
  let s = 6.5;
  s += stats.hotLeads > 3 ? 1 : stats.hotLeads > 0 ? 0.5 : 0;
  s -= stats.negativeReviews > 2 ? 1.5 : stats.negativeReviews > 0 ? 0.5 : 0;
  s += stats.highImpactSignals > 0 ? 0.5 : 0;
  s -= stats.competitorChanges > 2 ? 1 : stats.competitorChanges > 0 ? 0.3 : 0;
  return Math.min(9.9, Math.max(1.0, s));
}

const KPIS = [
  { key: 'unreadSignals',  label: 'סיגנלים',  icon: '📊', route: '/signals',     color: 'text-primary', bg: 'bg-primary/8' },
  { key: 'pendingReviews', label: 'ביקורות',  icon: '⭐', route: '/reviews',     color: 'text-amber-600',  bg: 'bg-amber-50'  },
  { key: 'hotLeads',       label: 'לידים חמים', icon: '🔥', route: '/leads',    color: 'text-orange-600', bg: 'bg-orange-50' },
  { key: 'monthRevenue',   label: 'הכנסה חודשית', icon: '₪', route: '/leads',  color: 'text-green-600',  bg: 'bg-green-50'  },
];

function fmtKpi(key, val) {
  if (key === 'monthRevenue') return val > 0 ? `₪${(val / 1000).toFixed(0)}K` : '—';
  return String(val ?? 0);
}

function urgentLine(stats) {
  const parts = [];
  if (stats.negativeReviews > 0) parts.push(`${stats.negativeReviews} ביקורות שליליות ממתינות לתגובה`);
  else if (stats.pendingReviews > 0) parts.push(`${stats.pendingReviews} ביקורות ממתינות`);
  if (stats.hotLeads > 0) parts.push(`${stats.hotLeads} לידים חמים`);
  if (stats.competitorChanges > 0) parts.push(`${stats.competitorChanges} שינויים אצל מתחרים`);
  if (parts.length === 0) return { text: 'הכל טופל — אין פעולות דחופות ✓', urgent: false };
  return { text: parts.join(' · '), urgent: true };
}

export default function DashboardHeader({ businessProfile, stats = {} }) {
  const navigate = useNavigate();
  const score = localScore(stats);
  const { text, urgent } = urgentLine(stats);

  return (
    <div className="card-base overflow-hidden mb-4" style={{ borderTop: '3px solid hsl(var(--primary))' }}>
      <div className="flex items-center gap-4 px-5 py-4">

        {/* Score ring */}
        <div className="flex flex-col items-center flex-shrink-0">
          <WeeklyScoreRing score={score} size={52} />
          <span className="text-[8px] text-foreground-muted mt-0.5">ציון עסקי</span>
        </div>

        {/* Greeting + status */}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-foreground-muted leading-none mb-0.5">{GREETING}</p>
          <h1 className="text-[16px] font-bold text-foreground leading-tight truncate">
            {businessProfile?.name || 'העסק שלך'}
          </h1>
          <p className={`text-[11px] mt-0.5 truncate ${urgent ? 'text-red-600 font-medium' : 'text-green-600'}`}>
            {urgent ? '⚡ ' : '✓ '}{text}
          </p>
        </div>

        {/* 4 KPI chips */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {KPIS.map(kpi => (
            <button
              key={kpi.key}
              onClick={() => navigate(kpi.route)}
              className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl border border-border ${kpi.bg} hover:shadow-sm transition-all group cursor-pointer`}
            >
              <span className={`text-[17px] font-bold leading-none ${kpi.color} group-hover:scale-110 transition-transform`}>
                {fmtKpi(kpi.key, stats[kpi.key])}
              </span>
              <span className="text-[9px] text-foreground-muted mt-0.5 leading-none text-center px-0.5">{kpi.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
