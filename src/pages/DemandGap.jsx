import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import {
  Search, Zap, TrendingUp, Loader2, RefreshCw,
  ChevronLeft, Clock, Star, ArrowUpRight,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const IMPACT_STYLES = {
  high:   { badge: 'bg-red-100 text-red-700',    bar: '#ef4444', label: 'השפעה גבוהה'   },
  medium: { badge: 'bg-amber-100 text-amber-700', bar: '#f59e0b', label: 'השפעה בינונית' },
  low:    { badge: 'bg-green-100 text-green-700', bar: '#10b981', label: 'השפעה נמוכה'   },
};
const TIME_STYLES = {
  immediate:        { badge: 'bg-red-100 text-red-700',   label: 'מיידי'    },
  immediate_action: { badge: 'bg-red-100 text-red-700',   label: 'מיידי'    },
  weeks:            { badge: 'bg-amber-100 text-amber-700', label: 'שבועות'   },
  months:           { badge: 'bg-blue-100 text-blue-700',  label: 'חודשים'   },
};

function parseGapTags(signal) {
  const parts = (signal.tags || '').split(',').map(t => t.trim());
  const kv = {};
  for (const t of parts) {
    const [k, v] = t.split(':');
    if (k) kv[k.trim()] = (v ?? k).trim();
  }
  const score = Math.min(100, Math.max(0, parseInt(kv.score || signal.confidence != null ? Math.round((signal.confidence || 0.5) * 100) : 50)));
  // time_to_capture is stored as the 2nd tag (e.g., "demand_gap,weeks,score:75")
  const timeRaw = parts[1] || 'weeks';
  const timeMap = { 'מיידי': 'immediate', 'שבועות': 'weeks', 'חודשים': 'months', 'immediate': 'immediate', 'weeks': 'weeks', 'months': 'months' };
  const timeKey = timeMap[timeRaw] || 'weeks';
  return { score, timeKey };
}

// ─── Revenue Forecast Banner ──────────────────────────────────────────────────

function ForecastBanner({ forecast, onRefresh, loading }) {
  if (!forecast) return null;
  return (
    <div className="card-base p-5 border-r-4 border-green-500">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-green-600" />
          <span className="text-[13px] font-semibold text-foreground">תחזית הכנסות חודשית</span>
        </div>
        <button onClick={onRefresh} disabled={loading}
          className="text-[10px] text-foreground-muted hover:text-foreground transition-colors flex items-center gap-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          עדכן
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        {[
          { label: 'שמרני',  val: forecast.conservative_forecast, color: 'text-foreground' },
          { label: 'ריאלי',  val: forecast.realistic_forecast,    color: 'text-green-600'  },
          { label: 'אופטימי', val: forecast.optimistic_forecast,   color: 'text-blue-600'  },
        ].map(({ label, val, color }) => (
          <div key={label} className="text-center p-2.5 rounded-xl bg-secondary/50">
            <p className="text-[9px] text-foreground-muted mb-0.5">{label}</p>
            <p className={`text-[18px] font-bold ${color}`}>
              {val > 0 ? `₪${(val / 1000).toFixed(0)}K` : '—'}
            </p>
          </div>
        ))}
      </div>

      {forecast.expected_deals > 0 && (
        <div className="flex items-center gap-3 text-[11px] text-foreground-muted">
          <span>{forecast.expected_deals} עסקאות צפויות</span>
          {forecast.recommended_actions?.[0] && (
            <span className="text-green-700 font-medium">· {forecast.recommended_actions[0]}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Top Opportunity highlight ────────────────────────────────────────────────

function TopOpportunity({ signal }) {
  const { score, timeKey } = parseGapTags(signal);
  const time = TIME_STYLES[timeKey] || TIME_STYLES.weeks;
  return (
    <div className="card-base p-5 border-2 border-primary/30 bg-primary/3">
      <div className="flex items-center gap-2 mb-3">
        <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
        <span className="text-[12px] font-bold text-foreground">הזדמנות מובילה</span>
        <span className={`mr-auto text-[9px] font-bold px-2 py-0.5 rounded-full ${time.badge}`}>
          <Clock className="w-2.5 h-2.5 inline ml-0.5" />{time.label}
        </span>
      </div>
      <p className="text-[14px] font-bold text-foreground mb-1.5">{signal.summary}</p>
      {signal.source_description && (
        <p className="text-[11px] text-foreground-muted mb-3">{signal.source_description}</p>
      )}
      {signal.recommended_action && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-primary/10 border border-primary/15">
          <ArrowUpRight className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <p className="text-[12px] text-primary font-semibold">{signal.recommended_action}</p>
        </div>
      )}
    </div>
  );
}

// ─── Gap Card ─────────────────────────────────────────────────────────────────

function GapCard({ signal }) {
  const { score, timeKey } = parseGapTags(signal);
  const impact = IMPACT_STYLES[signal.impact_level] || IMPACT_STYLES.medium;
  const time   = TIME_STYLES[timeKey] || TIME_STYLES.weeks;

  return (
    <div className="card-base p-4 hover:shadow-md transition-shadow flex flex-col gap-3">
      {/* Score bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${score}%`, background: impact.bar }} />
        </div>
        <span className="text-[10px] font-bold text-foreground-muted w-7 text-left">{score}</span>
      </div>

      {/* Badges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${impact.badge}`}>{impact.label}</span>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ${time.badge}`}>
          <Clock className="w-2.5 h-2.5" />{time.label}
        </span>
      </div>

      {/* Content */}
      <div>
        <p className="text-[12px] font-semibold text-foreground leading-snug mb-1">{signal.summary}</p>
        {signal.source_description && (
          <p className="text-[10px] text-foreground-muted line-clamp-2">{signal.source_description}</p>
        )}
      </div>

      {/* Action */}
      {signal.recommended_action && (
        <div className="flex items-start gap-1.5 p-2 rounded-lg bg-secondary/60 border border-border/50">
          <ChevronLeft className="w-3 h-3 text-foreground-muted flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-foreground-muted leading-snug">{signal.recommended_action}</p>
        </div>
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ scanning, onScan }) {
  return (
    <div className="card-base p-10 text-center">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
        <Search className="w-7 h-7 text-primary" />
      </div>
      <p className="text-[14px] font-bold text-foreground mb-2">טרם נמצאו פערי ביקוש</p>
      <p className="text-[11px] text-foreground-muted mb-6 max-w-xs mx-auto leading-relaxed">
        הסוכן יסרוק אותות שוק, מתחרים ומגמות כדי לזהות ביקושים באזורך שאין להם מענה מקומי
      </p>
      <button onClick={onScan} disabled={scanning}
        className="flex items-center gap-2 px-6 py-3 bg-foreground text-background rounded-xl text-[12px] font-semibold hover:opacity-90 transition-all mx-auto disabled:opacity-60">
        {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
        {scanning ? 'סורק...' : 'זהה פערי ביקוש'}
      </button>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function DemandGap() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [scanning, setScanning] = useState(false);

  const { data: gaps = [], isLoading } = useQuery({
    queryKey: ['demandGaps', bpId],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId, category: 'demand_gap' }),
    enabled: !!bpId,
    select: data => [...(data || [])].sort((a, b) => {
      const sA = parseInt((a.tags || '').match(/score:(\d+)/)?.[1] || '50');
      const sB = parseInt((b.tags || '').match(/score:(\d+)/)?.[1] || '50');
      return sB - sA;
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

  const runScan = async (fn) => {
    if (!bpId) return;
    setScanning(true);
    try {
      await base44.functions.invoke(fn, { businessProfileId: bpId });
      await queryClient.invalidateQueries({ queryKey: fn === 'demandGapEngine' ? ['demandGaps', bpId] : ['revenueForecast', bpId] });
      toast.success(fn === 'demandGapEngine' ? 'ניתוח פערי ביקוש הושלם' : 'תחזית הכנסות עודכנה');
    } catch (err) {
      console.error(`${fn} error:`, err);
      toast.error(`שגיאה: ${err?.message || 'נסה שוב'}`);
    }
    setScanning(false);
  };

  const highCount = gaps.filter(g => g.impact_level === 'high').length;
  const [top, ...rest] = gaps;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[16px] font-bold text-foreground flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" />
            פערי ביקוש
          </h1>
          <p className="text-[11px] text-foreground-muted mt-0.5">ביקושים באזורך שאין להם מענה מקומי מספיק</p>
        </div>
        <button
          onClick={() => runScan('demandGapEngine')}
          disabled={scanning}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-foreground text-background text-[11px] font-semibold hover:opacity-90 transition-all disabled:opacity-60"
        >
          {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          סרוק עכשיו
        </button>
      </div>

      {/* Forecast banner */}
      <ForecastBanner
        forecast={forecast}
        onRefresh={() => runScan('revenueForecaster')}
        loading={scanning}
      />

      {/* No forecast prompt */}
      {!forecast && (
        <div className="card-base p-4 flex items-center justify-between">
          <div>
            <p className="text-[12px] font-semibold text-foreground">תחזית הכנסות חודשית</p>
            <p className="text-[10px] text-foreground-muted">AI ינתח את הצינור ויחזה הכנסות</p>
          </div>
          <button onClick={() => runScan('revenueForecaster')} disabled={scanning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[11px] font-medium text-foreground-muted hover:text-foreground transition-all disabled:opacity-60">
            {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />}
            הפק תחזית
          </button>
        </div>
      )}

      {/* Gaps list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-foreground-muted" />
        </div>
      ) : gaps.length === 0 ? (
        <EmptyState scanning={scanning} onScan={() => runScan('demandGapEngine')} />
      ) : (
        <>
          {/* Summary stats */}
          <div className="flex items-center gap-3">
            <span className="text-[12px] font-semibold text-foreground">{gaps.length} הזדמנויות זוהו</span>
            {highCount > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">
                {highCount} דחופות
              </span>
            )}
          </div>

          {/* Top opportunity highlight */}
          {top && <TopOpportunity signal={top} />}

          {/* Rest in 2-col grid */}
          {rest.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {rest.map(gap => (
                <GapCard key={gap.id} signal={gap} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
