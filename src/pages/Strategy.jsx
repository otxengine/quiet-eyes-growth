import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Target, Zap, TrendingUp, ShieldAlert, CheckCircle2, Loader2, RefreshCw, BarChart3 } from 'lucide-react';
import RiskMatrix from '@/components/agents/RiskMatrix';

const EFFORT_LABEL = { low: 'מאמץ נמוך', medium: 'מאמץ בינוני', high: 'מאמץ גבוה' };
const EFFORT_COLOR = { low: 'text-success', medium: 'text-warning', high: 'text-danger' };
const CAT_COLOR = {
  acquisition: 'bg-blue-100 text-blue-700',
  retention: 'bg-purple-100 text-purple-700',
  reputation: 'bg-amber-100 text-amber-700',
  marketing: 'bg-pink-100 text-pink-700',
  operations: 'bg-gray-100 text-gray-700',
};
const PRIORITY_DOT = { high: 'bg-danger', medium: 'bg-warning', low: 'bg-success' };

function InitiativeCard({ item }) {
  return (
    <div className="flex gap-3 p-3 rounded-xl bg-secondary/50 border border-border/60">
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-2 ${PRIORITY_DOT[item.priority] || 'bg-foreground-muted'}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="text-[12px] font-semibold text-foreground">{item.title}</span>
          {item.category && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${CAT_COLOR[item.category] || 'bg-secondary text-foreground-muted'}`}>
              {item.category}
            </span>
          )}
          {item.effort && (
            <span className={`text-[9px] font-medium ${EFFORT_COLOR[item.effort]}`}>
              {EFFORT_LABEL[item.effort]}
            </span>
          )}
        </div>
        <p className="text-[11px] text-foreground-muted">{item.description}</p>
        {item.expected_impact && (
          <p className="text-[10px] text-success mt-1 font-medium">השפעה: {item.expected_impact}</p>
        )}
      </div>
    </div>
  );
}

function KpiRow({ kpi }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-[11px] text-foreground-muted">{kpi.metric}</span>
      <div className="flex items-center gap-3">
        {kpi.current && <span className="text-[10px] text-foreground-muted">{kpi.current}</span>}
        <span className="text-[11px] font-semibold text-primary">{kpi.target}</span>
      </div>
    </div>
  );
}

export default function Strategy() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);

  const { data: alerts, isLoading } = useQuery({
    queryKey: ['monthlyStrategy', bpId],
    queryFn: () => base44.entities.ProactiveAlert.filter({ linked_business: bpId, alert_type: 'monthly_strategy' }),
    enabled: !!bpId,
    select: data => data?.sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0)),
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
      toast.success('האסטרטגיה החודשית נוצרה בהצלחה');
    } catch (err) {
      toast.error('שגיאה ביצירת האסטרטגיה');
    }
    setGenerating(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-foreground-muted" />
      </div>
    );
  }

  if (!strategy) {
    return (
      <div className="max-w-2xl space-y-4">
        <div>
          <h1 className="text-[16px] font-bold text-foreground">אסטרטגיה חודשית</h1>
          <p className="text-[12px] text-foreground-muted mt-0.5">תכנית פעולה חודשית מותאמת אישית לעסק שלך</p>
        </div>
        <div className="card-base p-8 text-center">
          <Target className="w-10 h-10 text-foreground-muted opacity-20 mx-auto mb-4" />
          <p className="text-[13px] font-semibold text-foreground mb-2">טרם נוצרה אסטרטגיה חודשית</p>
          <p className="text-[11px] text-foreground-muted mb-5">AI ינתח את נתוני העסק שלך ויכין תכנית פעולה מפורטת</p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 px-5 py-2.5 bg-foreground text-background rounded-lg text-[12px] font-semibold hover:opacity-90 transition-all mx-auto disabled:opacity-60"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {generating ? 'מייצר אסטרטגיה...' : 'צור אסטרטגיה חודשית'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[16px] font-bold text-foreground">אסטרטגיה חודשית</h1>
          {strategyAlert?.title && (
            <p className="text-[11px] text-foreground-muted mt-0.5">{strategyAlert.title}</p>
          )}
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

      {/* Summary */}
      {strategy.summary && (
        <div className="card-base p-5 border-r-4 border-primary">
          <p className="text-[12px] text-foreground leading-relaxed">{strategy.summary}</p>
          <div className="flex items-center gap-3 mt-3">
            {strategy.focus_theme && (
              <span className="text-[11px] px-2.5 py-1 rounded-full bg-primary/10 text-primary font-semibold">
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
      )}

      {/* Quick Wins */}
      {strategy.quick_wins?.length > 0 && (
        <div className="card-base p-5">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-amber-500" />
            <h2 className="text-[13px] font-semibold text-foreground">פעולות מהירות לשבוע הקרוב</h2>
          </div>
          <div className="space-y-2">
            {strategy.quick_wins.map((win, i) => (
              <div key={i} className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-success flex-shrink-0 mt-0.5" />
                <span className="text-[12px] text-foreground">{win}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Initiatives */}
      {strategy.initiatives?.length > 0 && (
        <div className="card-base p-5">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h2 className="text-[13px] font-semibold text-foreground">יוזמות מרכזיות</h2>
          </div>
          <div className="space-y-2">
            {strategy.initiatives.map((item, i) => (
              <InitiativeCard key={i} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* KPIs */}
      {strategy.kpis?.length > 0 && (
        <div className="card-base p-5">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4 text-blue-500" />
            <h2 className="text-[13px] font-semibold text-foreground">מדדי הצלחה (KPIs)</h2>
          </div>
          <div>
            {strategy.kpis.map((kpi, i) => (
              <KpiRow key={i} kpi={kpi} />
            ))}
          </div>
        </div>
      )}

      {/* Risk Matrix */}
      {strategy.risks?.length > 0 && (
        <RiskMatrix risks={strategy.risks} />
      )}
    </div>
  );
}
