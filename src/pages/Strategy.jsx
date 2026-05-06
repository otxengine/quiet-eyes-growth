import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import {
  Target, Zap, TrendingUp, ShieldAlert, CheckCircle2, Loader2,
  RefreshCw, BarChart3, Trophy, Calendar, ArrowLeft,
} from 'lucide-react';
import RiskMatrix from '@/components/agents/RiskMatrix';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EFFORT_LABEL = { low: 'מאמץ נמוך', medium: 'מאמץ בינוני', high: 'מאמץ גבוה' };
const EFFORT_COLOR = { low: 'text-green-600', medium: 'text-amber-600', high: 'text-red-600' };
const EFFORT_BG    = { low: 'bg-green-50',    medium: 'bg-amber-50',    high: 'bg-red-50'   };
const CAT_BADGE = {
  acquisition: 'bg-blue-100 text-blue-700',
  retention:   'bg-purple-100 text-purple-700',
  reputation:  'bg-amber-100 text-amber-700',
  marketing:   'bg-pink-100 text-pink-700',
  operations:  'bg-gray-100 text-gray-700',
};
const PRIORITY_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' };

function ProgressRing({ done, total, size = 48 }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const pct = total > 0 ? done / total : 0;
  const color = pct === 1 ? '#10b981' : pct > 0.5 ? '#f59e0b' : '#6366f1';
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 transform">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f0f0f0" strokeWidth="4" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="4"
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[13px] font-bold leading-none" style={{ color }}>{done}</span>
        <span className="text-[8px] text-foreground-muted">/{total}</span>
      </div>
    </div>
  );
}

function InitiativeCard({ item }) {
  return (
    <div className="flex gap-3 p-3 rounded-xl border border-border/60 bg-white hover:shadow-sm transition-shadow">
      <div className="w-1 rounded-full flex-shrink-0 self-stretch" style={{ background: PRIORITY_COLOR[item.priority] || '#d1d5db' }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
          <span className="text-[12px] font-semibold text-foreground">{item.title}</span>
          {item.category && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${CAT_BADGE[item.category] || 'bg-secondary text-foreground-muted'}`}>
              {item.category}
            </span>
          )}
        </div>
        <p className="text-[11px] text-foreground-muted leading-relaxed">{item.description}</p>
        {item.effort && (
          <span className={`inline-block mt-1.5 text-[9px] font-semibold px-2 py-0.5 rounded-full ${EFFORT_COLOR[item.effort]} ${EFFORT_BG[item.effort]}`}>
            {EFFORT_LABEL[item.effort]}
          </span>
        )}
        {item.expected_impact && (
          <p className="text-[10px] text-green-600 font-medium mt-1">↑ {item.expected_impact}</p>
        )}
      </div>
    </div>
  );
}

// ─── Quick Wins with local checkbox state ─────────────────────────────────────

function QuickWins({ wins, storageKey }) {
  const [checked, setChecked] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; }
  });

  const toggle = (idx) => {
    const next = checked.includes(idx) ? checked.filter(i => i !== idx) : [...checked, idx];
    setChecked(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
  };

  const done  = checked.length;
  const total = wins.length;

  return (
    <div className="card-base p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
          <Zap className="w-4 h-4 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[13px] font-semibold text-foreground">פעולות מהירות לשבוע</h2>
          <p className="text-[10px] text-foreground-muted">{done === total && total > 0 ? '🎉 הכל בוצע!' : `${done} מתוך ${total} בוצעו`}</p>
        </div>
        <ProgressRing done={done} total={total} size={44} />
      </div>

      <div className="space-y-2">
        {wins.map((win, i) => (
          <button
            key={i}
            onClick={() => toggle(i)}
            className={`w-full flex items-center gap-2.5 text-right p-2.5 rounded-lg border transition-all ${
              checked.includes(i)
                ? 'bg-green-50 border-green-200 opacity-70'
                : 'bg-secondary/30 border-transparent hover:bg-secondary/60'
            }`}
          >
            <CheckCircle2 className={`w-4 h-4 flex-shrink-0 ${checked.includes(i) ? 'text-green-500' : 'text-foreground-muted opacity-30'}`} />
            <span className={`text-[12px] flex-1 text-right leading-snug ${checked.includes(i) ? 'line-through text-foreground-muted' : 'text-foreground'}`}>
              {win}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────

function KpisCard({ kpis }) {
  return (
    <div className="card-base p-5">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-4 h-4 text-blue-500" />
        <h2 className="text-[13px] font-semibold text-foreground">מדדי הצלחה</h2>
      </div>
      <div className="space-y-0">
        {kpis.map((kpi, i) => (
          <div key={i} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
            <span className="text-[11px] text-foreground-muted">{kpi.metric}</span>
            <div className="flex items-center gap-2">
              {kpi.current && <span className="text-[10px] text-foreground-muted line-through opacity-60">{kpi.current}</span>}
              <span className="text-[11px] font-bold text-primary">{kpi.target}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ generating, onGenerate }) {
  return (
    <div className="max-w-md mx-auto mt-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
        <Target className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-[15px] font-bold text-foreground mb-2">אסטרטגיה חודשית</h2>
      <p className="text-[12px] text-foreground-muted mb-6 leading-relaxed">
        AI ינתח את נתוני העסק שלך — ביקורות, לידים, מתחרים ואותות שוק — ויכין תכנית פעולה מפורטת לחודש הקרוב.
      </p>
      <button
        onClick={onGenerate}
        disabled={generating}
        className="flex items-center gap-2 px-6 py-3 bg-foreground text-background rounded-xl text-[13px] font-semibold hover:opacity-90 transition-all mx-auto disabled:opacity-60"
      >
        {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
        {generating ? 'מייצר אסטרטגיה...' : 'צור אסטרטגיה חודשית'}
      </button>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Strategy() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);

  const { data: alerts, isLoading } = useQuery({
    queryKey: ['monthlyStrategy', bpId],
    queryFn: () => base44.entities.ProactiveAlert.filter({ linked_business: bpId, alert_type: 'monthly_strategy' }),
    enabled: !!bpId,
    select: data => (data || []).sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0)),
  });

  const strategyAlert = alerts?.[0];
  let strategy = null;
  if (strategyAlert?.suggested_action) {
    try { strategy = JSON.parse(strategyAlert.suggested_action); } catch {}
  }

  const handleGenerate = async () => {
    if (!bpId) return;
    setGenerating(true);
    try {
      await base44.functions.invoke('generateMonthlyStrategy', { businessProfileId: bpId });
      await queryClient.invalidateQueries({ queryKey: ['monthlyStrategy', bpId] });
      toast.success('האסטרטגיה החודשית נוצרה');
    } catch {
      toast.error('שגיאה ביצירת האסטרטגיה');
    }
    setGenerating(false);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-foreground-muted" /></div>;
  }

  if (!strategy) {
    return <EmptyState generating={generating} onGenerate={handleGenerate} />;
  }

  const winStorageKey = `strategy_wins_${strategyAlert?.id || bpId}`;
  const month = new Date().toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[16px] font-bold text-foreground flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            אסטרטגיה חודשית
          </h1>
          <p className="text-[11px] text-foreground-muted mt-0.5 flex items-center gap-1">
            <Calendar className="w-3 h-3" /> {month}
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[11px] font-medium text-foreground-muted hover:text-foreground hover:border-foreground-muted transition-all disabled:opacity-60"
        >
          {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          עדכן
        </button>
      </div>

      {/* Summary banner */}
      {strategy.summary && (
        <div className="card-base p-5 border-r-4 border-primary bg-primary/3">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <p className="text-[13px] text-foreground leading-relaxed">{strategy.summary}</p>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                {strategy.focus_theme && (
                  <span className="text-[11px] px-3 py-1 rounded-full bg-primary/10 text-primary font-semibold">
                    {strategy.focus_theme}
                  </span>
                )}
                {strategy.top_goal && (
                  <span className="text-[11px] text-foreground-muted flex items-center gap-1">
                    <Target className="w-3 h-3" /> {strategy.top_goal}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2-column main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT: Quick wins + Initiatives */}
        <div className="space-y-4">
          {strategy.quick_wins?.length > 0 && (
            <QuickWins wins={strategy.quick_wins} storageKey={winStorageKey} />
          )}

          {strategy.initiatives?.length > 0 && (
            <div className="card-base p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-primary" />
                <h2 className="text-[13px] font-semibold text-foreground">יוזמות מרכזיות</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold mr-auto">
                  {strategy.initiatives.length}
                </span>
              </div>
              <div className="space-y-2.5">
                {strategy.initiatives.map((item, i) => (
                  <InitiativeCard key={i} item={item} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: KPIs + Risks */}
        <div className="space-y-4">
          {strategy.kpis?.length > 0 && (
            <KpisCard kpis={strategy.kpis} />
          )}

          {strategy.risks?.length > 0 && (
            <RiskMatrix risks={strategy.risks} />
          )}
        </div>
      </div>
    </div>
  );
}
