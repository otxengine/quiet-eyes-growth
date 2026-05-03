import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Search, Zap, TrendingUp, Loader2, RefreshCw, ChevronRight, Clock } from 'lucide-react';

const IMPACT_COLOR = { high: 'text-red-600 bg-red-50', medium: 'text-amber-600 bg-amber-50', low: 'text-green-600 bg-green-50' };
const IMPACT_LABEL = { high: 'גבוה', medium: 'בינוני', low: 'נמוך' };
const TIME_COLOR = { immediate: 'bg-red-100 text-red-700', immediate_action: 'bg-red-100 text-red-700', weeks: 'bg-amber-100 text-amber-700', months: 'bg-blue-100 text-blue-700' };
const TIME_LABEL = { immediate: 'מיידי', immediate_action: 'מיידי', weeks: 'שבועות', months: 'חודשים' };

function GapCard({ signal }) {
  const tags = (signal.tags || '').split(',').reduce((acc, t) => {
    const [k, v] = t.split(':');
    acc[k?.trim()] = v?.trim() || k?.trim();
    return acc;
  }, {});

  const score = parseInt(tags.score || '50');
  const timeLabel = TIME_LABEL[tags.demand_gap] || TIME_LABEL[tags[1]] || 'שבועות';
  const timeCls = TIME_COLOR[tags.demand_gap] || TIME_COLOR.weeks;

  return (
    <div className="card-base p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Search className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${IMPACT_COLOR[signal.impact_level] || IMPACT_COLOR.medium}`}>
              השפעה {IMPACT_LABEL[signal.impact_level] || 'בינונית'}
            </span>
            {timeLabel && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1 ${timeCls}`}>
                <Clock className="w-2.5 h-2.5" /> {timeLabel}
              </span>
            )}
            {score > 0 && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
                ציון {score}
              </span>
            )}
          </div>

          <p className="text-[13px] font-semibold text-foreground mb-1">{signal.summary}</p>

          {signal.source_description && (
            <p className="text-[11px] text-foreground-muted mb-2">{signal.source_description}</p>
          )}

          {signal.recommended_action && (
            <div className="flex items-start gap-1.5 mt-2 p-2.5 rounded-lg bg-primary/5 border border-primary/10">
              <ChevronRight className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-primary font-medium">{signal.recommended_action}</p>
            </div>
          )}
        </div>

        {/* Score bar */}
        <div className="flex flex-col items-center gap-1 flex-shrink-0">
          <div className="w-1.5 h-12 bg-secondary rounded-full overflow-hidden">
            <div className="w-full rounded-full bg-primary transition-all duration-700"
              style={{ height: `${score}%`, marginTop: `${100 - score}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DemandGap() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [scanning, setScanning] = useState(false);

  const { data: gaps, isLoading } = useQuery({
    queryKey: ['demandGaps', bpId],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId, source_type: 'demand_gap' }),
    enabled: !!bpId,
    select: data => [...(data || [])].sort((a, b) => {
      const scoreA = parseInt((a.tags || '').match(/score:(\d+)/)?.[1] || '50');
      const scoreB = parseInt((b.tags || '').match(/score:(\d+)/)?.[1] || '50');
      return scoreB - scoreA;
    }),
  });

  const { data: forecast } = useQuery({
    queryKey: ['revenueForecast', bpId],
    queryFn: async () => {
      const preds = await base44.entities.Prediction.filter({ linked_business: bpId, prediction_type: 'revenue_forecast' });
      const p = preds?.[0];
      if (!p?.summary) return null;
      try { return JSON.parse(p.summary); } catch { return null; }
    },
    enabled: !!bpId,
  });

  const handleScan = async () => {
    if (!bpId) return;
    setScanning(true);
    try {
      await base44.functions.invoke('demandGapEngine', { businessProfileId: bpId });
      await queryClient.invalidateQueries({ queryKey: ['demandGaps', bpId] });
      toast.success('ניתוח פערי ביקוש הושלם');
    } catch {
      toast.error('שגיאה בניתוח');
    }
    setScanning(false);
  };

  const handleForecast = async () => {
    if (!bpId) return;
    setScanning(true);
    try {
      await base44.functions.invoke('revenueForecaster', { businessProfileId: bpId });
      await queryClient.invalidateQueries({ queryKey: ['revenueForecast', bpId] });
      toast.success('תחזית הכנסות עודכנה');
    } catch {
      toast.error('שגיאה בתחזית');
    }
    setScanning(false);
  };

  return (
    <div className="max-w-2xl space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[16px] font-bold text-foreground">פערי ביקוש</h1>
          <p className="text-[12px] text-foreground-muted mt-0.5">
            ביקושים באזורך שאין להם מענה מקומי מספיק
          </p>
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-foreground text-background text-[11px] font-semibold hover:opacity-90 transition-all disabled:opacity-60"
        >
          {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          סרוק עכשיו
        </button>
      </div>

      {/* Revenue Forecast Banner */}
      {forecast && (
        <div className="card-base p-4 border-r-4 border-green-500 bg-green-50/30">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-600" />
              <span className="text-[12px] font-semibold text-foreground">תחזית הכנסות</span>
            </div>
            <button onClick={handleForecast} disabled={scanning}
              className="text-[10px] text-foreground-muted hover:text-foreground transition-colors">
              {scanning ? '...' : 'עדכן'}
            </button>
          </div>
          <div className="flex gap-4 mt-2">
            <div>
              <p className="text-[9px] text-foreground-muted">שמרני</p>
              <p className="text-[14px] font-bold text-foreground">₪{(forecast.conservative_forecast || 0).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[9px] text-foreground-muted">ריאלי</p>
              <p className="text-[14px] font-bold text-green-600">₪{(forecast.realistic_forecast || 0).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[9px] text-foreground-muted">אופטימי</p>
              <p className="text-[14px] font-bold text-foreground">₪{(forecast.optimistic_forecast || 0).toLocaleString()}</p>
            </div>
            {forecast.expected_deals > 0 && (
              <div>
                <p className="text-[9px] text-foreground-muted">עסקאות</p>
                <p className="text-[14px] font-bold text-foreground">{forecast.expected_deals}</p>
              </div>
            )}
          </div>
          {forecast.recommended_actions?.length > 0 && (
            <p className="text-[10px] text-green-700 mt-2">
              {forecast.recommended_actions[0]}
            </p>
          )}
        </div>
      )}

      {/* Demand Gaps List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-foreground-muted" />
        </div>
      ) : !gaps || gaps.length === 0 ? (
        <div className="card-base p-8 text-center">
          <Search className="w-10 h-10 text-foreground-muted opacity-20 mx-auto mb-3" />
          <p className="text-[13px] font-semibold text-foreground mb-1">טרם נמצאו פערי ביקוש</p>
          <p className="text-[11px] text-foreground-muted mb-5">
            הסוכן יסרוק אותות שוק, מתחרים ומגמות כדי למצוא הזדמנויות לא מנוצלות
          </p>
          <button onClick={handleScan} disabled={scanning}
            className="flex items-center gap-2 px-5 py-2.5 bg-foreground text-background rounded-lg text-[12px] font-semibold hover:opacity-90 transition-all mx-auto disabled:opacity-60">
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {scanning ? 'סורק...' : 'זהה פערי ביקוש'}
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold text-foreground">{gaps.length} הזדמנויות זוהו</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
              {gaps.filter(g => g.impact_level === 'high').length} בעדיפות גבוהה
            </span>
          </div>
          <div className="space-y-3">
            {gaps.map(gap => (
              <GapCard key={gap.id} signal={gap} />
            ))}
          </div>
        </>
      )}

      {/* Forecast section when no gaps yet */}
      {!forecast && (!gaps || gaps.length === 0) && (
        <div className="card-base p-4 flex items-center justify-between">
          <div>
            <p className="text-[12px] font-semibold text-foreground">תחזית הכנסות חודשית</p>
            <p className="text-[10px] text-foreground-muted">AI ינתח את הצינור ויחזה הכנסות</p>
          </div>
          <button onClick={handleForecast} disabled={scanning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[11px] font-medium text-foreground-muted hover:text-foreground transition-all disabled:opacity-60">
            {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />}
            הפק תחזית
          </button>
        </div>
      )}
    </div>
  );
}
