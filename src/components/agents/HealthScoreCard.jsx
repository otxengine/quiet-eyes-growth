import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Heart, TrendingUp, Star, Users, BarChart3, Zap, Loader2 } from 'lucide-react';

const categories = [
  { key: 'reputation_score', label: 'מוניטין', icon: Star, color: '#f59e0b' },
  { key: 'leads_score', label: 'לידים', icon: TrendingUp, color: '#10b981' },
  { key: 'competition_score', label: 'תחרות', icon: Users, color: '#6366f1' },
  { key: 'market_score', label: 'שוק', icon: BarChart3, color: '#3b82f6' },
  { key: 'engagement_score', label: 'פעילות', icon: Zap, color: '#ec4899' },
];

function ScoreRing({ score, size = 80 }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 75 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="hsl(var(--border))" strokeWidth="4" />
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          className="transition-all duration-1000" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[18px] font-bold" style={{ color }}>{score}</span>
        <span className="text-[9px] text-foreground-muted">מתוך 100</span>
      </div>
    </div>
  );
}

export default function HealthScoreCard({ bpId }) {
  const { data: health, isLoading } = useQuery({
    queryKey: ['healthScore', bpId],
    queryFn: async () => {
      const scores = await base44.entities.HealthScore.filter({ linked_business: bpId });
      return scores[0] || null;
    },
    enabled: !!bpId,
  });

  const [calculating, setCalculating] = React.useState(false);

  const calculate = async () => {
    setCalculating(true);
    await base44.functions.invoke('calculateHealthScore', { businessProfileId: bpId });
    setCalculating(false);
  };

  if (isLoading) return null;

  if (!health) {
    return (
      <div className="card-base p-6 text-center">
        <Heart className="w-8 h-8 text-foreground-muted opacity-20 mx-auto mb-3" />
        <p className="text-[12px] text-foreground-muted mb-4">טרם חושב ציון בריאות</p>
        <button onClick={calculate} disabled={calculating}
          className="btn-subtle px-5 py-2 rounded-lg text-[11px] font-medium bg-foreground text-background hover:opacity-90 transition-all">
          {calculating ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'חשב עכשיו'}
        </button>
      </div>
    );
  }

  let improvements = [];
  try { improvements = JSON.parse(health.improvements || '[]'); } catch (_) {}

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
          <Heart className="w-4 h-4 text-danger" /> אינדקס בריאות עסקית
        </h3>
        <button onClick={calculate} disabled={calculating}
          className="text-[10px] text-foreground-muted hover:text-foreground transition-colors font-medium">
          {calculating ? '...' : 'עדכן'}
        </button>
      </div>

      <div className="flex items-center gap-4 mb-3">
        <ScoreRing score={health.overall_score} />
        <div className="flex-1 grid grid-cols-2 gap-1.5">
          {categories.map(cat => {
            const Icon = cat.icon;
            const val = health[cat.key] || 0;
            return (
              <div key={cat.key} className="flex items-center gap-1.5">
                <Icon className="w-3 h-3 flex-shrink-0" style={{ color: cat.color }} />
                <span className="text-[10px] text-foreground-secondary">{cat.label}</span>
                <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${val}%`, backgroundColor: cat.color }} />
                </div>
                <span className="text-[10px] font-semibold text-foreground-muted w-5 text-left">{val}</span>
              </div>
            );
          })}
        </div>
      </div>

      {improvements.length > 0 && (
        <div className="border-t border-border pt-3 space-y-1.5">
          {improvements.slice(0, 3).map((imp, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px]">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${
                imp.priority === 'critical' ? 'bg-danger' : imp.priority === 'high' ? 'bg-warning' : 'bg-success'
              }`} />
              <span className="text-foreground-secondary">{imp.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}