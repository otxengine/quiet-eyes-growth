import { useState, useMemo } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import {
  Loader2, Archive, Search, Zap, TrendingUp, RefreshCw,
  ChevronLeft, Clock, Star, ArrowUpRight,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import StatCards from '@/components/shared/StatCards';
import UrgentActionsSection from '@/components/shared/UrgentActionsSection';
import DataTable from '@/components/shared/DataTable';
import DailyBriefPanel from '@/components/dashboard/DailyBriefPanel';

const TYPE_META = {
  action_needed:       { label: 'פעולה נדרשת',    color: 'text-red-600',    bg: 'bg-red-50' },
  negative_review:     { label: 'ביקורת שלילית',  color: 'text-red-600',    bg: 'bg-red-50' },
  negative_comment:    { label: 'תגובה שלילית',   color: 'text-red-600',    bg: 'bg-red-50' },
  opportunity:         { label: 'הזדמנות',         color: 'text-green-600',  bg: 'bg-green-50' },
  market_opportunity:  { label: 'הזדמנות שוק',    color: 'text-green-600',  bg: 'bg-green-50' },
  risk:                { label: 'סיכון',           color: 'text-amber-600',  bg: 'bg-amber-50' },
  retention_risk:      { label: 'סיכון שימור',    color: 'text-amber-600',  bg: 'bg-amber-50' },
  competitor_move:     { label: 'מהלך מתחרה',     color: 'text-violet-600', bg: 'bg-violet-50' },
  trend_opportunity:   { label: 'טרנד עולה',       color: 'text-purple-600', bg: 'bg-purple-50' },
  hot_lead:            { label: 'ליד חם',          color: 'text-amber-600',  bg: 'bg-amber-50' },
  reputation_risk:     { label: 'סיכון מוניטין',   color: 'text-red-600',    bg: 'bg-red-50' },
  demand_gap:          { label: 'פער ביקוש',       color: 'text-cyan-600',   bg: 'bg-cyan-50' },
  content_opportunity: { label: 'תוכן לפרסום',    color: 'text-rose-600',   bg: 'bg-rose-50' },
  campaign_opportunity:{ label: 'הזדמנות קמפיין', color: 'text-purple-600', bg: 'bg-purple-50' },
};

const VALUE_MAP = {
  high:     { label: 'גבוה',   color: 'text-green-700',  bg: 'bg-green-50' },
  critical: { label: 'קריטי',  color: 'text-red-700',    bg: 'bg-red-50' },
  medium:   { label: 'בינוני', color: 'text-amber-700',  bg: 'bg-amber-50' },
  low:      { label: 'נמוך',   color: 'text-gray-500',   bg: 'bg-gray-50' },
};

const CATEGORY_MAP = {
  risk:        'סיכון',
  opportunity: 'הזדמנות',
  trend:       'טרנד',
  competitor:  'מתחרה',
  lead:        'ליד',
  content:     'תוכן',
};

const COLUMNS = [
  { key: 'title',    label: 'תובנה' },
  { key: 'value',    label: 'עדיפות' },
  { key: 'category', label: 'קטגוריה' },
  { key: 'action',   label: 'פעולה' },
];

const STALE_DAYS = 14;
const CAT_CAP = 3;
const RELEVANCE_THRESHOLD = 60;
const IMPACT_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };

// ── Phase 3: Relevance scoring ──────────────────────────────────────────────
// Returns 0-100. Signals below RELEVANCE_THRESHOLD are hidden from the feed.
// Factors: impact alignment (30) + specificity (25) + actionability (25) + freshness (20)
/** @param {Record<string, any>} row */
function computeRelevanceScore(row) {
  let score = 0;

  // 1. Impact alignment (0-30)
  const impactScores = { critical: 30, high: 25, medium: 18, low: 10 };
  score += impactScores[row.impact] ?? 18;

  // 2. Specificity (0-25): concrete data increases confidence
  const fullText = (row.summary || '') + ' ' + (row.raw?.recommended_action || '');
  if (row.raw?.recommended_action) score += 13;
  if (/\d/.test(fullText))         score += 8;
  if ((row.title || '').length > 20) score += 4;

  // 3. Actionability (0-25): signal type maps to known actionable categories
  const ACTIONABLE_TYPES = new Set([
    'negative_review', 'reputation_risk', 'hot_lead', 'action_needed',
    'campaign_opportunity', 'demand_gap', 'content_opportunity',
    'retention_risk', 'competitor_move',
  ]);
  score += ACTIONABLE_TYPES.has(row.type) ? 25 : 12;

  // 4. Freshness (0-20)
  const age = rowAgeInDays(row);
  if (age <= 1)       score += 20;
  else if (age <= 3)  score += 17;
  else if (age <= 7)  score += 13;
  else if (age <= 14) score += 7;
  // else 0

  return Math.min(100, score);
}

/** @param {Record<string, any>} item */
function classifyCategory(item) {
  const t = item.type || '';
  if (t.includes('risk') || t.includes('negative') || t.includes('reputation')) return 'risk';
  if (t.includes('opportunity') || t.includes('demand') || t.includes('campaign')) return 'opportunity';
  if (t.includes('trend') || t.includes('social') || t.includes('viral')) return 'trend';
  if (t.includes('competitor')) return 'competitor';
  if (t.includes('lead')) return 'lead';
  if (t.includes('content')) return 'content';
  return 'opportunity';
}

// Normalize title to a fingerprint for dedup comparison
/** @param {string} title */
function fingerprint(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[^\u0590-\u05ff\u200f\u200ea-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 45);
}

// Keep the highest-impact / most-recent row per unique topic
function deduplicateRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = fingerprint(row.title);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...row, dupeCount: 1 });
    } else {
      const thisScore  = IMPACT_ORDER[row.impact]      ?? 2;
      const existScore = IMPACT_ORDER[existing.impact] ?? 2;
      const thisDate   = new Date(row.raw?.detected_at || row.raw?.created_at || 0);
      const existDate  = new Date(existing.raw?.detected_at || existing.raw?.created_at || 0);
      const thisWins   = thisScore > existScore || (thisScore === existScore && thisDate > existDate);
      map.set(key, thisWins
        ? { ...row, dupeCount: (existing.dupeCount || 1) + 1 }
        : { ...existing, dupeCount: (existing.dupeCount || 1) + 1 }
      );
    }
  }
  return Array.from(map.values());
}

// After dedup, keep at most CAT_CAP rows per category (sorted high→low already)
function capPerCategory(rows) {
  const counts = {};
  return rows.filter(row => {
    const cat = classifyCategory(row);
    counts[cat] = (counts[cat] || 0) + 1;
    return counts[cat] <= CAT_CAP;
  });
}

/** @param {Record<string, any>} row */
function rowAgeInDays(row) {
  const d = row.raw?.detected_at || row.raw?.created_at;
  if (!d) return 0;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

// Context-aware CTA label instead of generic "פעולה"
/** @param {Record<string, any>} row */
function getActionLabel(row) {
  const t = row.type || '';
  if (t === 'negative_review' || t === 'reputation_risk') return 'הגב לביקורת';
  if (t === 'hot_lead')                                   return 'פנה ללקוח';
  const cat = classifyCategory(row);
  if (cat === 'risk')        return 'טפל עכשיו';
  if (cat === 'competitor')  return 'נתח מתחרה';
  if (cat === 'content')     return 'פרסם תוכן';
  if (cat === 'trend')       return 'נצל טרנד';
  if (cat === 'lead')        return 'פנה ללקוח';
  return 'נצל הזדמנות';
}

// ─── Demand Gap section (merged from the former /demand-gap page) ─────────────

const GAP_IMPACT_STYLES = {
  high:   { badge: 'bg-red-100 text-red-700',    bar: '#ef4444', label: 'השפעה גבוהה'   },
  medium: { badge: 'bg-amber-100 text-amber-700', bar: '#f59e0b', label: 'השפעה בינונית' },
  low:    { badge: 'bg-green-100 text-green-700', bar: '#10b981', label: 'השפעה נמוכה'   },
};
const GAP_TIME_STYLES = {
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
  const timeRaw = parts[1] || 'weeks';
  const timeMap = { 'מיידי': 'immediate', 'שבועות': 'weeks', 'חודשים': 'months', 'immediate': 'immediate', 'weeks': 'weeks', 'months': 'months' };
  const timeKey = timeMap[timeRaw] || 'weeks';
  return { score, timeKey };
}

function GapForecastBanner({ forecast, onRefresh, loading }) {
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

function TopGapOpportunity({ signal }) {
  const { timeKey } = parseGapTags(signal);
  const time = GAP_TIME_STYLES[timeKey] || GAP_TIME_STYLES.weeks;
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

function GapCard({ signal }) {
  const { score, timeKey } = parseGapTags(signal);
  const impact = GAP_IMPACT_STYLES[signal.impact_level] || GAP_IMPACT_STYLES.medium;
  const time   = GAP_TIME_STYLES[timeKey] || GAP_TIME_STYLES.weeks;

  return (
    <div className="card-base p-4 hover:shadow-md transition-shadow flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${score}%`, background: impact.bar }} />
        </div>
        <span className="text-[10px] font-bold text-foreground-muted w-7 text-left">{score}</span>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${impact.badge}`}>{impact.label}</span>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ${time.badge}`}>
          <Clock className="w-2.5 h-2.5" />{time.label}
        </span>
      </div>

      <div>
        <p className="text-[12px] font-semibold text-foreground leading-snug mb-1">{signal.summary}</p>
        {signal.source_description && (
          <p className="text-[10px] text-foreground-muted line-clamp-2">{signal.source_description}</p>
        )}
      </div>

      {signal.recommended_action && (
        <div className="flex items-start gap-1.5 p-2 rounded-lg bg-secondary/60 border border-border/50">
          <ChevronLeft className="w-3 h-3 text-foreground-muted flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-foreground-muted leading-snug">{signal.recommended_action}</p>
        </div>
      )}
    </div>
  );
}

function GapEmptyState({ scanning, onScan }) {
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

function DemandGapSection({ bpId }) {
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
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[16px] font-bold text-foreground flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" />
            פערי ביקוש
          </h2>
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

      <GapForecastBanner
        forecast={forecast}
        onRefresh={() => runScan('revenueForecaster')}
        loading={scanning}
      />

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

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-foreground-muted" />
        </div>
      ) : gaps.length === 0 ? (
        <GapEmptyState scanning={scanning} onScan={() => runScan('demandGapEngine')} />
      ) : (
        <>
          <div className="flex items-center gap-3">
            <span className="text-[12px] font-semibold text-foreground">{gaps.length} הזדמנויות זוהו</span>
            {highCount > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">
                {highCount} דחופות
              </span>
            )}
          </div>

          {top && <TopGapOpportunity signal={top} />}

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

export default function Insights() {
  // @ts-ignore -- outlet context shape not inferred in JSX
  const { businessProfile } = useOutletContext();
  const navigate = useNavigate();
  const bpId = businessProfile?.id;
  const [showArchived,    setShowArchived]    = useState(false);
  const [activeCategory,  setActiveCategory]  = useState('all');

  const { data: alerts = [], isLoading: loadingAlerts } = useQuery({
    queryKey: ['proactiveAlerts', bpId],
    queryFn: () => base44.entities.ProactiveAlert.filter({ linked_business: bpId }, '-created_at', 100),
    enabled: !!bpId,
  });

  const { data: signals = [], isLoading: loadingSignals } = useQuery({
    queryKey: ['allSignals', bpId],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId }, '-detected_at', 50),
    enabled: !!bpId,
  });

  const isLoading = loadingAlerts || loadingSignals;

  // ── Step 1: merge + sort ──────────────────────────────────────────────────
  const allRows = useMemo(() => {
    const alertRows = alerts.filter(a => !a.is_dismissed).map(a => ({
      id:      a.id,
      kind:    'alert',
      type:    a.alert_type || 'action_needed',
      title:   a.title || a.message || '',
      summary: a.message || '',
      impact:  a.priority || 'medium',
      raw:     a,
    }));
    const signalRows = signals.filter(s => !s.is_dismissed).map(s => ({
      id:      s.id,
      kind:    'signal',
      type:    s.signal_type || 'opportunity',
      title:   s.title || s.summary || '',
      summary: s.summary || '',
      impact:  s.impact_level || 'medium',
      raw:     s,
    }));
    const all = [...alertRows, ...signalRows];
    return all.sort((a, b) => (IMPACT_ORDER[b.impact] ?? 2) - (IMPACT_ORDER[a.impact] ?? 2));
  }, [alerts, signals]);

  // ── Step 2: deduplicate + cap per category ────────────────────────────────
  const deduped = useMemo(() => capPerCategory(deduplicateRows(allRows)), [allRows]);

  // ── Step 2.5: relevance scoring — filter out low-signal noise ─────────────
  const scored  = useMemo(() => deduped.map(r => ({ ...r, relevance_score: computeRelevanceScore(r) })), [deduped]);
  const relevant = useMemo(() => scored.filter(r => r.relevance_score >= RELEVANCE_THRESHOLD), [scored]);
  const removedByRelevance = deduped.length - relevant.length;

  // ── Step 3: split fresh / stale ───────────────────────────────────────────
  const freshRows = useMemo(() => relevant.filter(r => rowAgeInDays(r) < STALE_DAYS),  [relevant]);
  const staleRows = useMemo(() => relevant.filter(r => rowAgeInDays(r) >= STALE_DAYS), [relevant]);

  // ── Step 4: category filter ───────────────────────────────────────────────
  const baseRows = showArchived ? deduped : freshRows;
  const visibleRows = useMemo(() =>
    activeCategory === 'all' ? baseRows : baseRows.filter(r => classifyCategory(r) === activeCategory),
    [baseRows, activeCategory]
  );

  // Stats use fresh deduped only (no stale noise)
  const risks      = freshRows.filter(r => classifyCategory(r) === 'risk');
  const opps       = freshRows.filter(r => classifyCategory(r) === 'opportunity');
  const urgentRows = freshRows.filter(r => r.impact === 'critical' || r.impact === 'high');
  const trendRows  = freshRows.filter(r => classifyCategory(r) === 'trend');
  const compRows   = freshRows.filter(r => classifyCategory(r) === 'competitor');

  const statCards = [
    { count: risks.length,      label: 'סיכונים',           borderColor: 'red' },
    { count: urgentRows.length, label: 'דורש פעולה מיידית', borderColor: 'yellow' },
    { count: opps.length,       label: 'הזדמנויות',          borderColor: 'blue' },
    { count: trendRows.length,  label: 'מגמות וטרנדים',      borderColor: 'none' },
  ];

  const urgentActions = urgentRows.slice(0, 3).map(r => ({
    title:       r.title.slice(0, 60),
    description: r.summary?.slice(0, 80),
    ctaLabel:    getActionLabel(r),
    onCta:       () => navigate(`/insights/${r.id}?kind=${r.kind}`),
  }));

  const FILTER_TABS = [
    { key: 'all',        label: 'הכל',       count: freshRows.length },
    { key: 'risk',       label: 'סיכונים',   count: risks.length },
    { key: 'opportunity',label: 'הזדמנויות', count: opps.length },
    { key: 'trend',      label: 'מגמות',     count: trendRows.length },
    { key: 'competitor', label: 'מתחרים',    count: compRows.length },
  ].filter(t => t.key === 'all' || t.count > 0);

  const getTypeMeta  = (/** @type {string} */ type)   => TYPE_META[type]   || { label: type, color: 'text-foreground-secondary', bg: 'bg-gray-50' };
  const getValueMeta = (/** @type {string} */ impact) => VALUE_MAP[impact]  || VALUE_MAP.medium;

  const removedByDedup = allRows.length - deduped.length;

  return (
    <div className="space-y-5">
      <PageHeader count={freshRows.length} title="תובנות" />

      <DailyBriefPanel businessProfile={businessProfile} />

      <StatCards cards={statCards} />

      {urgentActions.length > 0 && (
        <UrgentActionsSection actions={urgentActions} />
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
        </div>
      ) : (
        <>
          {/* Dedup + relevance notice */}
          {(removedByDedup > 0 || removedByRelevance > 0) && (
            <div dir="rtl" className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-[11px] text-blue-700">
              <span>✨</span>
              <span>
                מציגים <strong>{freshRows.length}</strong> תובנות רלוונטיות מתוך {allRows.length}
                {removedByDedup > 0 && <span className="opacity-70"> · סוננו {removedByDedup} כפילויות</span>}
                {removedByRelevance > 0 && <span className="opacity-70"> · סוננו {removedByRelevance} תובנות נמוכות-ערך</span>}
              </span>
            </div>
          )}

          {/* Filter tabs + archived toggle */}
          <div dir="rtl" className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
              {FILTER_TABS.map(tab => (
                <button key={tab.key} onClick={() => setActiveCategory(tab.key)}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                    activeCategory === tab.key
                      ? 'bg-white shadow-sm text-foreground'
                      : 'text-foreground-muted hover:text-foreground'
                  }`}>
                  {tab.label}
                  {tab.count > 0 && <span className="mr-1 opacity-50">{tab.count}</span>}
                </button>
              ))}
            </div>
            {staleRows.length > 0 && (
              <button
                onClick={() => setShowArchived(s => !s)}
                className="flex items-center gap-1.5 text-[11px] text-foreground-muted hover:text-foreground transition-colors"
              >
                <Archive className="w-3.5 h-3.5" />
                {showArchived ? 'הסתר תובנות ישנות' : `${staleRows.length} תובנות ישנות (מעל ${STALE_DAYS} ימים)`}
              </button>
            )}
          </div>

          <DataTable
            columns={COLUMNS}
            rows={visibleRows}
            emptyText={
              activeCategory !== 'all'
                ? `אין תובנות בקטגוריה זו`
                : 'אין תובנות עדיין — הסוכן יזהה הזדמנויות וסיכונים אוטומטית'
            }
            renderCell={(row, col) => {
              if (col.key === 'title') {
                const score = row.relevance_score ?? 0;
                const scoreColor = score >= 80 ? 'text-green-600 bg-green-50'
                  : score >= 60 ? 'text-blue-600 bg-blue-50'
                  : 'text-gray-400 bg-gray-50';
                return (
                  <div dir="rtl">
                    <div className="font-medium text-foreground text-sm leading-snug flex items-center gap-1.5 flex-wrap">
                      {row.title}
                      {row.dupeCount > 1 && (
                        <span className="text-[10px] font-normal text-foreground-muted bg-gray-100 px-1.5 py-0.5 rounded-full">
                          ×{row.dupeCount}
                        </span>
                      )}
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${scoreColor}`}>
                        {score}%
                      </span>
                    </div>
                    {row.summary && row.summary !== row.title && (
                      <div className="text-xs text-foreground-muted mt-0.5 line-clamp-1">{row.summary}</div>
                    )}
                    {rowAgeInDays(row) >= STALE_DAYS && (
                      <span className="text-[10px] text-amber-600 mt-0.5 block">
                        {rowAgeInDays(row)} ימים — ישן
                      </span>
                    )}
                  </div>
                );
              }

              if (col.key === 'value') {
                const vm = getValueMeta(row.impact);
                return (
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${vm.bg} ${vm.color}`}>
                    {vm.label}
                  </span>
                );
              }

              if (col.key === 'category') {
                const cat = classifyCategory(row);
                const tm  = getTypeMeta(row.type);
                return (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${tm.bg} ${tm.color}`}>
                    {CATEGORY_MAP[cat] || tm.label}
                  </span>
                );
              }

              if (col.key === 'action') return (
                <button
                  onClick={() => navigate(`/insights/${row.id}?kind=${row.kind}`)}
                  className="text-xs font-semibold text-[#e8344d] hover:underline whitespace-nowrap"
                >
                  {getActionLabel(row)} &rarr;
                </button>
              );

              return null;
            }}
          />

          {/* Archived footer message */}
          {!showArchived && staleRows.length > 0 && (
            <div dir="rtl" className="text-center">
              <button
                onClick={() => setShowArchived(true)}
                className="text-[11px] text-foreground-muted hover:text-foreground transition-colors flex items-center gap-1 mx-auto"
              >
                <Archive className="w-3.5 h-3.5" />
                הצג {staleRows.length} תובנות ישנות (ארכיון)
              </button>
            </div>
          )}
        </>
      )}

      <DemandGapSection bpId={bpId} />

      {/* Upgrade Banner */}
      <div
        className="rounded-2xl p-5 flex items-center justify-between gap-4"
        style={{ background: 'linear-gradient(135deg, #fce4ec 0%, #e1bee7 100%)' }}
      >
        <div>
          <div className="font-semibold text-sm text-foreground">המערכת יכולה לזהות יותר עבורך</div>
          <div className="text-xs text-foreground-secondary mt-0.5">שדרג לפתיחת ניתוח מתקדם של תובנות</div>
        </div>
        <button
          onClick={() => navigate('/subscription')}
          className="flex-shrink-0 bg-[#e8344d] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#c92b40] transition-colors shadow-sm"
        >
          גלה הזדמנויות
        </button>
      </div>
    </div>
  );
}
