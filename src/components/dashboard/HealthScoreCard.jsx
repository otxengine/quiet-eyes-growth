import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Activity } from 'lucide-react';

function ScoreBar({ label, value, change }) {
  const pct = Math.max(0, Math.min(100, value || 0));
  const color = pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
  const textColor = pct >= 75 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-500';

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-foreground-secondary w-16 shrink-0 text-right">{label}</span>
      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[11px] font-bold w-8 text-right ${textColor}`}>{Math.round(pct)}</span>
      {change !== undefined && change !== null && (
        <span className={`text-[9px] w-6 text-right ${change > 0 ? 'text-emerald-500' : change < 0 ? 'text-red-500' : 'text-foreground-muted'}`}>
          {change > 0 ? `+${change}` : change < 0 ? change : '→'}
        </span>
      )}
    </div>
  );
}

export default function HealthScoreCard({ businessProfileId }) {
  const { data: scores = [] } = useQuery({
    queryKey: ['healthScore', businessProfileId],
    queryFn: () => base44.entities.HealthScore.filter(
      { linked_business: businessProfileId }, '-created_date', 2
    ),
    enabled: !!businessProfileId,
    staleTime: 5 * 60 * 1000,
  });

  const latest = scores[0];
  const prev   = scores[1];

  if (!latest) return null;

  const overall = Math.round(latest.overall_score || 0);
  const statusColor = overall >= 75 ? 'text-emerald-600' : overall >= 50 ? 'text-amber-500' : 'text-red-500';
  const statusEmoji = overall >= 75 ? '🟢' : overall >= 50 ? '🟡' : '🔴';

  function delta(key) {
    if (!prev) return null;
    const d = Math.round((latest[key] || 0) - (prev[key] || 0));
    return d;
  }

  const updatedAgo = (() => {
    if (!latest.created_date) return null;
    const h = Math.floor((Date.now() - new Date(latest.created_date).getTime()) / 3600000);
    if (h < 1) return 'עכשיו';
    if (h < 24) return `לפני ${h} שע'`;
    return `לפני ${Math.floor(h / 24)} ימים`;
  })();

  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary opacity-70" />
          <span className="text-[13px] font-bold text-foreground">ציון בריאות עסקי</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-[22px] font-bold ${statusColor}`}>{overall}</span>
          <span className="text-[13px] text-foreground-muted">/100</span>
          <span className="text-[14px]">{statusEmoji}</span>
        </div>
      </div>

      <div className="space-y-2">
        <ScoreBar label="מוניטין"  value={latest.reputation_score}  change={delta('reputation_score')} />
        <ScoreBar label="לידים"    value={latest.leads_score}        change={delta('leads_score')} />
        <ScoreBar label="תחרות"    value={latest.competition_score}  change={delta('competition_score')} />
        <ScoreBar label="ביקורות"  value={latest.market_score}       change={delta('market_score')} />
      </div>

      {updatedAgo && (
        <p className="text-[9px] text-foreground-muted mt-3 text-left">עדכון אחרון: {updatedAgo}</p>
      )}
    </div>
  );
}
