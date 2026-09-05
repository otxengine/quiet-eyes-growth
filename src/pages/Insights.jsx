import { useState, useMemo, useEffect } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { trackUxEvent } from '@/lib/trackUxEvent';
import {
  Loader2, Archive, Search, Zap, TrendingUp,
  ChevronLeft, Clock, Star, ArrowUpRight,
  Eye, AlertTriangle, Sparkles, MessageSquare, Users, Calendar, ChevronDown,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import StatCards from '@/components/shared/StatCards';
import DataTable from '@/components/shared/DataTable';
import SignalCard from '@/components/intelligence/SignalCard';
import AiInsightBox from '@/components/ai/AiInsightBox';
import WeeklyReportsTab from '@/components/intelligence/WeeklyReportsTab';
import ScanOverlay from '@/components/dashboard/ScanOverlay';
import PlanGate from '@/components/subscription/PlanGate';
import { usePlan } from '@/lib/usePlan';
import { getLimits } from '@/lib/planConfig';
import OffersPillarSection from '@/components/insights/OffersPillarSection';
import ReviewsPillarSection from '@/components/insights/ReviewsPillarSection';
import SocialPillarSection from '@/components/insights/SocialPillarSection';

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

function TopGapOpportunity({ signal, onOpen }) {
  const { timeKey } = parseGapTags(signal);
  const time = GAP_TIME_STYLES[timeKey] || GAP_TIME_STYLES.weeks;
  return (
    <button onClick={onOpen} className="card-base p-5 border-2 border-primary/30 bg-primary/3 text-right w-full hover:shadow-md transition-shadow">
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
    </button>
  );
}

function GapCard({ signal, onOpen }) {
  const { score, timeKey } = parseGapTags(signal);
  const impact = GAP_IMPACT_STYLES[signal.impact_level] || GAP_IMPACT_STYLES.medium;
  const time   = GAP_TIME_STYLES[timeKey] || GAP_TIME_STYLES.weeks;

  return (
    <button onClick={onOpen} className="card-base p-4 hover:shadow-md transition-shadow flex flex-col gap-3 text-right">
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
    </button>
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
  const navigate = useNavigate();
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

  const runScan = async (fn) => {
    if (!bpId) return;
    setScanning(true);
    try {
      await base44.functions.invoke(fn, { businessProfileId: bpId });
      await queryClient.invalidateQueries({ queryKey: ['demandGaps', bpId] });
      toast.success('ניתוח פערי ביקוש הושלם');
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

          {top && <TopGapOpportunity signal={top} onOpen={() => navigate(`/insights/signal-${top.id}`)} />}

          {rest.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {rest.map(gap => (
                <GapCard key={gap.id} signal={gap} onOpen={() => navigate(`/insights/signal-${gap.id}`)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Market Intelligence section (merged from the former /intelligence page) ──

const INTEL_TABS = [
  { key: 'all', label: 'הכל' },
  { key: 'threat', label: 'איומים' },
  { key: 'opportunity', label: 'הזדמנויות' },
  { key: 'trend', label: 'מגמות' },
  { key: 'mention', label: 'אזכורים' },
  { key: 'event', label: 'אירועים' },
  { key: 'competitor_intel', label: 'מודיעין תחרותי' },
  { key: 'reports', label: 'דוחות' },
];

const intelligenceScanSteps = [
  { key: 'collect',      label: 'אוסף אותות מהאינטרנט...',     fn: 'collectWebSignals',    resultKey: 'new_signals_saved' },
  { key: 'social',       label: 'סורק רשתות חברתיות...',        fn: 'collectSocialSignals', resultKey: 'signals_saved' },
  { key: 'analyze',      label: 'מנתח מודיעין שוק...',          fn: 'synthesizeMarketInsights', resultKey: 'insights_generated' },
  { key: 'trends',       label: 'מגלה מגמות עולות...',          fn: 'detectTrends',         resultKey: 'trends_detected' },
  { key: 'early_trends', label: 'מגלה טרנדים מוקדמים...',       fn: 'detectEarlyTrends',    resultKey: 'trends_created' },
  { key: 'viral',        label: 'סורק סיגנלים ויראלים...',      fn: 'detectViralSignals',   resultKey: 'signals_created' },
];

function getAspect(signal) {
  try {
    const m = JSON.parse(signal.source_description || '{}');
    const plat = m.platform || m.action_platform || '';
    if (plat === 'instagram') return 'instagram';
    if (plat === 'facebook')  return 'facebook';
    if (plat === 'google')    return 'google';
  } catch {}
  const agent = (signal.agent_name || '').toLowerCase();
  if (agent.includes('google') || agent.includes('trends') || agent.includes('search')) return 'google';
  if (agent.includes('instagram'))                                                       return 'instagram';
  if (agent.includes('facebook'))                                                        return 'facebook';
  if (agent.includes('social'))                                                          return 'social';
  if (agent.includes('competitor'))                                                      return 'competitor';
  return 'general';
}

const ASPECT_CONFIG = {
  google:     { label: '🔍 חיפוש ו-Google Trends', color: 'text-red-600' },
  instagram:  { label: '📸 אינסטגרם',              color: 'text-pink-600' },
  facebook:   { label: '👤 פייסבוק',               color: 'text-blue-600' },
  social:     { label: '📱 רשתות חברתיות',          color: 'text-purple-600' },
  competitor: { label: '🏆 פעילות מתחרים',           color: 'text-indigo-600' },
  general:    { label: '📊 מגמות כלליות',            color: 'text-foreground' },
};

function IntelligenceSection({ businessProfile }) {
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('all');
  const [showScan, setShowScan] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const { can, plan } = usePlan();
  const canGrowth = can('growth');
  const planLimits = getLimits(plan);
  const signalsMax = planLimits.signals_max;

  // AC5: strip trend/viral payload from client state for non-growth users
  const { data: allSignals = [] } = useQuery({
    queryKey: ['intelligenceSignals', bpId, canGrowth],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId, is_dismissed: false }, '-detected_at', 100),
    enabled: !!bpId,
    select: (data) => canGrowth ? data : data.filter(s => s.category !== 'trend' && s.category !== 'viral_signal'),
  });

  // AC3: count-only for trend teaser shown inside PlanGate (non-growth only)
  const { data: trendCountForTeaser = 0 } = useQuery({
    queryKey: ['trendCount', bpId],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId, category: 'trend', is_dismissed: false }, '-detected_at', 200),
    enabled: !!bpId && !canGrowth,
    select: (data) => data.length,
  });

  // Fetch raw signals for trend stats
  const { data: rawSignals = [] } = useQuery({
    queryKey: ['rawSignalStats', bpId],
    queryFn: () => base44.entities.RawSignal.filter({ linked_business: bpId }, '-detected_at', 50),
    enabled: !!bpId
  });

  const { data: dismissedSignals = [] } = useQuery({
    queryKey: ['dismissedSignals', bpId],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId, is_dismissed: true }, '-detected_at', 50),
    enabled: !!bpId && showDismissed,
  });

  const restoreMutation = useMutation({
    mutationFn: (id) => base44.entities.MarketSignal.update(id, { is_dismissed: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intelligenceSignals', bpId] });
      queryClient.invalidateQueries({ queryKey: ['dismissedSignals', bpId] });
    },
  });

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const weekSignals = allSignals.filter(s => (s.detected_at || s.created_date) >= weekAgo);
  const threats = weekSignals.filter(s => s.category === 'threat');
  const opportunities = weekSignals.filter(s => s.category === 'opportunity');
  const trends = weekSignals.filter(s => s.category === 'trend');
  const competitorMoves = weekSignals.filter(s => s.category === 'competitor_move' || s.category === 'competitor');
  const eventSignals = allSignals.filter(s => s.category === 'event' || s.category === 'local_event');

  // Raw signal stats
  const trendSignals = rawSignals.filter(s => s.signal_type === 'social_trend');
  const socialMentions = rawSignals.filter(s => s.signal_type === 'social_mention' || s.signal_type === 'social_review');
  const competitorSocial = rawSignals.filter(s => s.signal_type === 'competitor_social');

  const mentions = weekSignals.filter(s => s.category === 'mention');
  const filtered = activeTab === 'all' ? allSignals
    : activeTab === 'reports' ? []
    : activeTab === 'competitor_intel' ? allSignals.filter(s => s.category === 'competitor_move' || s.category === 'competitor')
    : activeTab === 'event' ? allSignals.filter(s => s.category === 'event' || s.category === 'local_event')
    : allSignals.filter(s => s.category === activeTab);

  useEffect(() => {
    window.__cortexi_scan = () => setShowScan(true);
    return () => { delete window.__cortexi_scan; };
  }, []);

  const statCards = [
    { label: 'תובנות השבוע', value: weekSignals.length, icon: Sparkles, color: 'text-primary' },
    { label: 'מגמות עולות', value: canGrowth ? trends.length : trendCountForTeaser, icon: TrendingUp, color: 'text-[#10b981]', sub: `${trendSignals.length} אותות` },
    { label: 'איומים', value: threats.length, icon: AlertTriangle, color: 'text-[#dc2626]' },
    { label: 'הזדמנויות', value: opportunities.length, icon: Sparkles, color: 'text-[#d97706]' },
    { label: 'אזכורים חברתיים', value: socialMentions.length, icon: MessageSquare, color: 'text-purple-500' },
    { label: 'מודיעין תחרותי', value: competitorMoves.length, icon: Users, color: 'text-[#6366f1]', sub: `${competitorSocial.length} אותות` },
    { label: 'אירועים', value: eventSignals.length, icon: Calendar, color: 'text-[#0ea5e9]' },
  ];

  return (
    <div className="space-y-5">
      {showScan && (
        <ScanOverlay
          businessProfile={businessProfile}
          steps={intelligenceScanSteps}
          title="סורק מודיעין שוק..."
          onComplete={() => {
            setShowScan(false);
            queryClient.invalidateQueries({ queryKey: ['intelligenceSignals', bpId] });
            queryClient.invalidateQueries({ queryKey: ['rawSignalStats', bpId] });
            queryClient.invalidateQueries({ queryKey: ['trendCount', bpId] });
          }}
          onClose={() => setShowScan(false)}
        />
      )}
      <div>
        <h2 className="text-[16px] font-bold text-foreground tracking-tight">מודיעין שוק</h2>
        <p className="text-[12px] text-foreground-muted mt-0.5">תובנות חכמות מחיפושים, רשתות חברתיות, קבוצות ומתחרים</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {statCards.map((card, i) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className={`card-base p-4 fade-in-up stagger-${Math.min(i + 1, 4)}`}>
              <div className="flex items-center gap-1.5 mb-2">
                <Icon className={`w-3.5 h-3.5 ${card.color}`} />
                <p className="text-[10px] font-medium text-foreground-muted">{card.label}</p>
              </div>
              <span className="text-[24px] font-bold text-foreground leading-none tracking-tight">{card.value}</span>
              {card.sub && <p className="text-[9px] text-foreground-muted mt-1">{card.sub}</p>}
            </div>
          );
        })}
      </div>

      <div className="flex gap-0.5 border-b border-border">
        {INTEL_TABS.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-[12px] font-medium transition-all duration-150 relative ${
              activeTab === tab.key ? 'text-foreground' : 'text-foreground-muted hover:text-foreground-secondary'
            }`}>
            {tab.label}
            {!['all', 'reports'].includes(tab.key) && (() => {
              const countMap = { threat: threats.length, opportunity: opportunities.length, trend: canGrowth ? trends.length : trendCountForTeaser, competitor_intel: competitorMoves.length, mention: mentions.length, event: eventSignals.length };
              const count = countMap[tab.key] || 0;
              return count > 0 ? <span className="mr-1 text-[9px] font-bold text-foreground-muted">({count})</span> : null;
            })()}
            {activeTab === tab.key && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-t" />}
          </button>
        ))}
      </div>

      <AiInsightBox
        title="זיהוי מגמות מתפתחות — ניתוח AI"
        prompt={`אתה אנליסט מודיעין עסקי מומחה בזיהוי מגמות. נתח ${allSignals.length} תובנות שוק עבור "${businessProfile?.name}" (${businessProfile?.category}, ${businessProfile?.city}).
שוק יעד: ${businessProfile?.target_market || 'לא מוגדר'}, שירותים: ${businessProfile?.relevant_services || 'לא מוגדר'}.
נתוני השבוע: ${threats.length} איומים, ${opportunities.length} הזדמנויות, ${trends.length} מגמות, ${competitorMoves.length} מהלכי מתחרים.
אותות גולמיים: ${trendSignals.length} מגמות עולות, ${socialMentions.length} אזכורים חברתיים, ${competitorSocial.length} מתחרים ברשתות.
תובנות אחרונות: ${allSignals.slice(0, 8).map(s => `[${s.category}] ${s.summary}`).join('; ')}.
זהה 3 מגמות עולות ספציפיות ל"${businessProfile?.name}", הסבר את קצב העלייה, ההשפעה הצפויה, ואיך לנצל/להתמודד. בעברית, Markdown.`}
      />

      {/* Trend / Viral tabs gated at Growth+ */}
      {(activeTab === 'trend' || activeTab === 'reports') && !canGrowth ? (
        <PlanGate requires="growth" featureName={activeTab === 'reports' ? 'דוחות שבועיים' : 'ניתוח מגמות'} count={activeTab === 'trend' ? trendCountForTeaser : null} />
      ) : activeTab === 'reports' ? (
        <WeeklyReportsTab bpId={bpId} />
      ) : activeTab === 'trend' ? (
        filtered.length === 0 ? (
          <div className="card-base fade-in-up">
            <div className="py-20 text-center">
              <Eye className="w-12 h-12 text-foreground-muted opacity-20 mx-auto mb-3" />
              <p className="text-[13px] text-foreground-muted mb-1">העיניים סורקות את השוק — תובנות חדשות יופיעו בקרוב</p>
              <p className="text-[11px] text-foreground-muted opacity-50">הסריקה הראשונה לוקחת עד שעה</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {(() => {
              const limited = signalsMax === Infinity ? filtered : filtered.slice(0, signalsMax);
              const groups = {};
              limited.forEach(s => {
                const aspect = getAspect(s);
                if (!groups[aspect]) groups[aspect] = [];
                groups[aspect].push(s);
              });
              return Object.entries(groups).map(([aspect, signals]) => {
                const cfg = ASPECT_CONFIG[aspect] || ASPECT_CONFIG.general;
                return (
                  <div key={aspect} className="card-base fade-in-up">
                    <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                      <h3 className={`font-semibold text-[13px] ${cfg.color}`}>{cfg.label}</h3>
                      <span className="text-[10px] text-foreground-muted">{signals.length} מגמות</span>
                    </div>
                    <div className="divide-y divide-border">
                      {signals.map(s => (
                        <SignalCard key={s.id} signal={s} businessProfile={businessProfile} />
                      ))}
                    </div>
                  </div>
                );
              });
            })()}
            {signalsMax !== Infinity && filtered.length > signalsMax && (
              <div className="px-5 py-4 text-center bg-amber-50 border border-amber-100 rounded-lg">
                <p className="text-[12px] text-amber-800 font-medium">
                  עוד {filtered.length - signalsMax} מגמות מוסתרות (מגבלת תוכנית: {signalsMax})
                </p>
                <a href="/subscription" className="mt-1 inline-block text-[11px] font-semibold text-amber-700 underline underline-offset-2">
                  שדרג לצפות בכולן →
                </a>
              </div>
            )}
          </div>
        )
      ) : (
        <div className="card-base fade-in-up">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-foreground text-[13px]">ציר זמן מודיעיני</h3>
            <span className="text-[10px] text-foreground-muted">{filtered.length} תובנות</span>
          </div>
          {filtered.length === 0 ? (
            <div className="py-20 text-center">
              <Eye className="w-12 h-12 text-foreground-muted opacity-20 mx-auto mb-3" />
              <p className="text-[13px] text-foreground-muted mb-1">העיניים סורקות את השוק — תובנות חדשות יופיעו בקרוב</p>
              <p className="text-[11px] text-foreground-muted opacity-50">הסריקה הראשונה לוקחת עד שעה</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {(signalsMax === Infinity ? filtered : filtered.slice(0, signalsMax)).map((signal) => (
                <SignalCard key={signal.id} signal={signal} businessProfile={businessProfile} />
              ))}
              {signalsMax !== Infinity && filtered.length > signalsMax && (
                <div className="px-5 py-4 text-center bg-amber-50 border-t border-amber-100">
                  <p className="text-[12px] text-amber-800 font-medium">
                    עוד {filtered.length - signalsMax} תובנות מוסתרות (מגבלת תוכנית: {signalsMax})
                  </p>
                  <a href="/subscription" className="mt-1 inline-block text-[11px] font-semibold text-amber-700 underline underline-offset-2">
                    שדרג לצפות בכולן →
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {/* Dismissed bin — restore flow (AC2b) */}
      {activeTab !== 'reports' && (
        <div className="card-base fade-in-up">
          <button
            onClick={() => setShowDismissed(v => !v)}
            className="px-5 py-3 flex items-center gap-2 text-[12px] text-foreground-muted hover:text-foreground w-full"
          >
            <Archive className="w-3.5 h-3.5" />
            פריטים שהוסרו
            {showDismissed && dismissedSignals.length > 0 && (
              <span className="text-[10px] font-semibold">({dismissedSignals.length})</span>
            )}
            <ChevronDown className={`w-3.5 h-3.5 mr-auto transition-transform ${showDismissed ? 'rotate-180' : ''}`} />
          </button>
          {showDismissed && (
            <div className="border-t border-border divide-y divide-border">
              {dismissedSignals.length === 0 ? (
                <p className="px-5 py-4 text-[12px] text-foreground-muted">אין פריטים שהוסרו</p>
              ) : dismissedSignals.map(s => (
                <div key={s.id} className="px-5 py-3 flex items-center gap-3">
                  <p className="text-[12px] text-foreground-muted flex-1 truncate">{s.summary}</p>
                  <button
                    onClick={() => {
                      if (s.category === 'trend' && s.impact_level === 'high') {
                        trackUxEvent('ux_early_trend_restore', bpId, { signalId: s.id });
                      }
                      restoreMutation.mutate(s.id);
                    }}
                    disabled={restoreMutation.isPending}
                    className="text-[11px] text-primary hover:underline flex-shrink-0 disabled:opacity-40"
                  >
                    שחזר
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
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

      <SocialPillarSection businessProfile={businessProfile} />

      <ReviewsPillarSection businessProfile={businessProfile} />

      <OffersPillarSection businessProfile={businessProfile} />

      <StatCards cards={statCards} />

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
                  onClick={() => navigate(`/insights/${row.kind}-${row.id}`)}
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

      {/* IntelligenceSection removed for now (2026-08-29) — a meaningful share of
          its data generators (detectTrends/detectEarlyTrends/synthesizeMarketInsights/
          detectViralSignals) turned out to be manual-scan-only, not on the daily
          scheduler, and had been silent for 10 days. Re-add once that's fixed. */}

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
