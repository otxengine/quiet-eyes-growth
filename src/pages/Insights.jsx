import React, { useState, useMemo } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Lightbulb, Zap, Target, TrendingUp, AlertTriangle, Trophy,
  ChevronLeft, ChevronDown, ChevronUp,
} from 'lucide-react';
import DismissMenu from '@/components/ui/DismissMenu';

// ── Type meta ─────────────────────────────────────────────────────────────────

const ALERT_TYPE_META = {
  action_needed:        { label: 'פעולה נדרשת',    color: 'text-red-600',    bg: 'bg-red-50',     border: 'border-red-100',    icon: Zap },
  negative_review:      { label: 'ביקורת שלילית',  color: 'text-red-600',    bg: 'bg-red-50',     border: 'border-red-100',    icon: AlertTriangle },
  opportunity:          { label: 'הזדמנות',         color: 'text-green-600',  bg: 'bg-green-50',   border: 'border-green-100',  icon: Target },
  market_opportunity:   { label: 'הזדמנות שוק',    color: 'text-green-600',  bg: 'bg-green-50',   border: 'border-green-100',  icon: TrendingUp },
  risk:                 { label: 'סיכון',           color: 'text-amber-600',  bg: 'bg-amber-50',   border: 'border-amber-100',  icon: AlertTriangle },
  retention_risk:       { label: 'סיכון שימור',    color: 'text-amber-600',  bg: 'bg-amber-50',   border: 'border-amber-100',  icon: AlertTriangle },
  competitor_move:      { label: 'מהלך מתחרה',     color: 'text-indigo-600', bg: 'bg-indigo-50',  border: 'border-indigo-100', icon: Trophy },
  competitor_intel:     { label: 'מודיעין מתחרים', color: 'text-indigo-600', bg: 'bg-indigo-50',  border: 'border-indigo-100', icon: Trophy },
  competitor_mention:   { label: 'אזכור מתחרה',    color: 'text-indigo-500', bg: 'bg-indigo-50',  border: 'border-indigo-100', icon: Trophy },
  competitor_attack:    { label: 'מתקפת מתחרה',    color: 'text-red-700',    bg: 'bg-red-50',     border: 'border-red-200',    icon: AlertTriangle },
  milestone:            { label: 'אבן דרך',         color: 'text-purple-600', bg: 'bg-purple-50',  border: 'border-purple-100', icon: Trophy },
  hot_lead:             { label: 'ליד חם',          color: 'text-amber-600',  bg: 'bg-amber-50',   border: 'border-amber-100',  icon: Zap },
  trend_opportunity:    { label: 'טרנד עולה',       color: 'text-purple-600', bg: 'bg-purple-50',  border: 'border-purple-100', icon: TrendingUp },
  new_service:          { label: 'שירות חדש',       color: 'text-blue-600',   bg: 'bg-blue-50',    border: 'border-blue-100',   icon: Target },
  promotion_strategy:   { label: 'אסטרטגיית מבצע', color: 'text-orange-600', bg: 'bg-orange-50',  border: 'border-orange-100', icon: Zap },
  sector_shift:         { label: 'שינוי בתחום',     color: 'text-purple-600', bg: 'bg-purple-50',  border: 'border-purple-100', icon: AlertTriangle },
  event_opportunity:    { label: 'הזדמנות אירוע',   color: 'text-green-600',  bg: 'bg-green-50',   border: 'border-green-100',  icon: Target },
  competitive_gap:      { label: 'פער מתחרים',      color: 'text-indigo-600', bg: 'bg-indigo-50',  border: 'border-indigo-100', icon: Trophy },
  social_viral:         { label: 'ויראלי חברתי',    color: 'text-pink-600',   bg: 'bg-pink-50',    border: 'border-pink-100',   icon: TrendingUp },
  future_prediction:    { label: 'תחזית עתידית',    color: 'text-violet-600', bg: 'bg-violet-50',  border: 'border-violet-100', icon: TrendingUp },
  demand_gap:           { label: 'פער ביקוש',       color: 'text-cyan-600',   bg: 'bg-cyan-50',    border: 'border-cyan-100',   icon: Target },
  content_opportunity:  { label: 'תוכן לפרסום',    color: 'text-rose-600',   bg: 'bg-rose-50',    border: 'border-rose-100',   icon: Zap },
  reputation_risk:      { label: 'סיכון מוניטין',   color: 'text-red-600',    bg: 'bg-red-50',     border: 'border-red-100',    icon: AlertTriangle },
  content_performance:  { label: 'ביצועי תוכן',    color: 'text-violet-600', bg: 'bg-violet-50',  border: 'border-violet-100', icon: TrendingUp },
  review_timing:        { label: 'תזמון ביקורות',   color: 'text-teal-600',   bg: 'bg-teal-50',    border: 'border-teal-100',   icon: Target },
  micro_moment:         { label: 'רגע מכירה',       color: 'text-amber-600',  bg: 'bg-amber-50',   border: 'border-amber-100',  icon: Zap },
  sentiment_drop:       { label: 'ירידת סנטימנט',   color: 'text-red-600',    bg: 'bg-red-50',     border: 'border-red-100',    icon: AlertTriangle },
  campaign_opportunity: { label: 'הזדמנות קמפיין',  color: 'text-purple-600', bg: 'bg-purple-50',  border: 'border-purple-100', icon: Zap },
};

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_BADGE = {
  critical: { label: 'קריטי', color: 'text-red-700',    bg: 'bg-red-100' },
  high:     { label: 'גבוה',  color: 'text-orange-700', bg: 'bg-orange-100' },
  medium:   { label: 'בינוני',color: 'text-yellow-700', bg: 'bg-yellow-100' },
  low:      { label: 'נמוך',  color: 'text-gray-600',   bg: 'bg-gray-100' },
};

// ── Section bucket assignments ─────────────────────────────────────────────────

const URGENT_TYPES     = new Set(['negative_review','hot_lead','competitor_attack','reputation_risk','action_needed','retention_risk','sentiment_drop','micro_moment']);
const OPP_ALERT_TYPES  = new Set(['opportunity','market_opportunity','demand_gap','competitive_gap','new_service','campaign_opportunity','promotion_strategy','future_prediction','event_opportunity','milestone','content_opportunity','review_timing','content_performance']);
const TREND_ALERT_TYPES  = new Set(['trend_opportunity','social_viral','sector_shift','tiktok_opportunity']);
const TREND_SIGNAL_CATS  = new Set([
  'tiktok_sector_trend', 'viral_signal', 'early_trend', 'social', 'trend',
  'instagram_trend', 'facebook_trend', 'google_trend', 'visual_trend',
]);
const COMP_ALERT_TYPES   = new Set(['competitor_move','competitor_intel','competitor_mention']);
const COMP_SIGNAL_CATS   = new Set(['competitor_move','competitor_mention']);
const OPP_SIGNAL_CATS    = new Set(['demand_gap','opportunity','expansion','threat']);

// ── Trend source detection ────────────────────────────────────────────────────

function getTrendSource(item) {
  const cat  = item._sigCat || '';
  const text = ((item.title || '') + ' ' + (item.description || '')).toLowerCase();

  // 1. Category-based detection (most reliable)
  if (cat === 'tiktok_sector_trend' || cat === 'trend') return 'tiktok';
  if (cat === 'instagram_trend')  return 'instagram';
  if (cat === 'facebook_trend')   return 'facebook';
  if (cat === 'google_trend')     return 'google';
  if (cat === 'visual_trend')     return 'general'; // could be any platform

  // 2. source_description JSON platform field (set by instagramTrendAgent, facebookGroupTrendAgent, etc.)
  if (item._sigMeta) {
    try {
      const meta = typeof item._sigMeta === 'string' ? JSON.parse(item._sigMeta) : item._sigMeta;
      const platform = (meta.platform || '').toLowerCase();
      if (platform === 'instagram') return 'instagram';
      if (platform === 'facebook')  return 'facebook';
      if (platform === 'tiktok')    return 'tiktok';
      if (platform === 'google')    return 'google';
    } catch {}
  }

  // 3. Text-based detection
  if (text.includes('tiktok') || text.includes('טיקטוק')) return 'tiktok';
  if (text.includes('instagram') || text.includes('אינסטגרם') || text.includes('reels') || text.includes('ריל')) return 'instagram';
  if (text.includes('facebook') || text.includes('פייסבוק')) return 'facebook';
  if (text.includes('google trends') || text.includes('גוגל טרנדס') || text.includes('גוגל')) return 'google';

  return 'general';
}

const SOURCE_META = {
  tiktok:    { label: 'TikTok',        color: 'text-slate-800',  bg: 'bg-slate-100',  border: 'border-slate-200' },
  instagram: { label: 'Instagram',     color: 'text-pink-600',   bg: 'bg-pink-50',    border: 'border-pink-100' },
  facebook:  { label: 'Facebook',      color: 'text-blue-700',   bg: 'bg-blue-50',    border: 'border-blue-100' },
  google:    { label: 'Google Trends', color: 'text-green-700',  bg: 'bg-green-50',   border: 'border-green-100' },
  general:   { label: 'ויזואלי',       color: 'text-purple-600', bg: 'bg-purple-50',  border: 'border-purple-100' },
};

function getUsLeadingBadge(item) {
  if (!item._sigMeta) return null;
  try {
    const meta = typeof item._sigMeta === 'string' ? JSON.parse(item._sigMeta) : item._sigMeta;
    if (!meta.is_us_leading_indicator) return null;
    const days = meta.days_until_israel || meta.days_until_peak;
    return days ? `מגמה מארה"ב — צפוי להגיע בעוד ~${days} ימים` : 'מגמה מארה"ב';
  } catch { return null; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeTitle(t) {
  if (!t) return '';
  return t.replace(/[^\u05D0-\u05EAa-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function signalPriority(s) {
  if (s.impact_level === 'high' || s.impact_level === 'critical') return 'high';
  if (s.impact_level === 'low') return 'low';
  return 'medium';
}

function sortByPriority(arr) {
  return [...arr].sort((a, b) => {
    const po = (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3);
    if (po !== 0) return po;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
}

// ── InsightCard ───────────────────────────────────────────────────────────────

function InsightCard({ item, onOpen, onDismiss, businessProfileId }) {
  const typeMeta     = ALERT_TYPE_META[item.type] || ALERT_TYPE_META.action_needed;
  const Icon         = typeMeta.icon;
  const priorityMeta = PRIORITY_BADGE[item.priority] || PRIORITY_BADGE.medium;
  const srcMeta      = item.trendSource ? SOURCE_META[item.trendSource] : null;

  return (
    <div className={`rounded-xl border ${typeMeta.border} ${typeMeta.bg} p-4 hover:shadow-sm transition-all duration-150`}>
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-white border ${typeMeta.border}`}>
          <Icon className={`w-4 h-4 ${typeMeta.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${typeMeta.bg} ${typeMeta.color} border ${typeMeta.border}`}>
              {typeMeta.label}
            </span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${priorityMeta.bg} ${priorityMeta.color}`}>
              {priorityMeta.label}
            </span>
            {srcMeta && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${srcMeta.bg} ${srcMeta.color} ${srcMeta.border}`}>
                {srcMeta.label}
              </span>
            )}
            {item.trendSource && (() => {
              const usBadge = getUsLeadingBadge(item);
              return usBadge ? (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                  {usBadge}
                </span>
              ) : null;
            })()}
          </div>
          <p className="text-[13px] font-semibold text-foreground leading-snug mb-1">{item.title}</p>
          {item.description && (
            <p className="text-[11px] text-foreground-secondary leading-relaxed line-clamp-2">{item.description}</p>
          )}
          <div className="flex items-center justify-between mt-3">
            <span className="text-[10px] text-foreground-muted">
              {item.createdAt ? new Date(item.createdAt).toLocaleDateString('he-IL') : ''}
            </span>
            <div className="flex items-center gap-3">
              {item.rawStatus !== 'completed' && (
                <DismissMenu
                  entityType={item.dismissType || 'alert'}
                  entityId={item.id}
                  title={item.title}
                  businessProfileId={businessProfileId}
                  onDismissed={() => onDismiss(item)}
                />
              )}
              <button
                onClick={() => onOpen(item.navId)}
                className={`flex items-center gap-1 text-[11px] font-semibold ${typeMeta.color} hover:opacity-70 transition-all`}
              >
                פתח תובנה מלאה
                <ChevronLeft className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SectionBlock ──────────────────────────────────────────────────────────────

function SectionBlock({
  sectionId, title, icon: Icon, iconColor, badgeColor,
  items, filters, activeFilter, onFilterChange,
  shownCount, onLoadMore, businessProfileId, onOpen, onDismiss, emptyMsg,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const visible = items.slice(0, shownCount);
  const hasMore = items.length > shownCount;

  return (
    <div className="space-y-3">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between group"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${iconColor}`} />
          <h2 className="text-[15px] font-bold text-foreground">{title}</h2>
          {items.length > 0 && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColor}`}>
              {items.length}
            </span>
          )}
        </div>
        {collapsed
          ? <ChevronDown className="w-4 h-4 text-foreground-muted" />
          : <ChevronUp className="w-4 h-4 text-foreground-muted opacity-0 group-hover:opacity-60 transition-opacity" />
        }
      </button>

      {collapsed && items.length > 0 && (
        <p className="text-[11px] text-foreground-muted">{items.length} פריטים — לחץ להרחבה</p>
      )}

      {!collapsed && (
        <>
          {/* Filter chips */}
          {filters && filters.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {filters.map(f => (
                <button
                  key={f.value}
                  onClick={() => onFilterChange(f.value)}
                  className={`text-[10px] px-2.5 py-1 rounded-full border transition-all ${
                    activeFilter === f.value
                      ? 'bg-foreground text-background border-foreground'
                      : 'border-border text-foreground-muted hover:border-foreground-muted bg-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {/* Items */}
          {visible.length === 0 ? (
            <p className="text-[12px] text-foreground-muted text-center py-5">{emptyMsg || 'אין פריטים'}</p>
          ) : (
            <div className="space-y-3">
              {visible.map(item => (
                <InsightCard
                  key={item.navId}
                  item={item}
                  onOpen={onOpen}
                  onDismiss={onDismiss}
                  businessProfileId={businessProfileId}
                />
              ))}
            </div>
          )}

          {/* Load more */}
          {hasMore && (
            <button
              onClick={() => onLoadMore(sectionId)}
              className="w-full text-[11px] text-foreground-muted border border-border rounded-lg py-2 hover:bg-secondary/30 transition-all"
            >
              טען עוד ({items.length - shownCount} נוספים)
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Insights() {
  const { businessProfile } = useOutletContext();
  const navigate     = useNavigate();
  const queryClient  = useQueryClient();
  const bpId         = businessProfile?.id;

  const [dismissedIds, setDismissedIds] = useState(new Set());
  const [trendSource, setTrendSource]   = useState('all');
  const [compFilter, setCompFilter]     = useState('all');
  const [pages, setPages] = useState({ urgent: 8, opportunities: 8, trends: 8, competitors: 8, actions: 8 });

  // ── Queries — only last 90 days to avoid stale records ──────────────────
  const cutoff90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data: alerts = [], isLoading: loadingAlerts } = useQuery({
    queryKey: ['proactiveAlerts', bpId, 'insights-v2'],
    queryFn: () => base44.entities.ProactiveAlert.filter(
      { linked_business: bpId, is_dismissed: false, created_date: { gte: cutoff90 } }, '-created_at', 60
    ),
    enabled: !!bpId,
  });

  const { data: actions = [], isLoading: loadingActions } = useQuery({
    queryKey: ['actions', bpId, 'insights-v2'],
    queryFn: () => base44.entities.Action.filter(
      { linked_business: bpId, is_dismissed: false, created_date: { gte: cutoff90 } }, '-created_date', 30
    ),
    enabled: !!bpId,
  });

  const { data: signals = [], isLoading: loadingSignals } = useQuery({
    queryKey: ['marketSignals', bpId, 'insights-v2'],
    queryFn: () => base44.entities.MarketSignal.filter(
      { linked_business: bpId, is_dismissed: false, created_date: { gte: cutoff90 } }, '-detected_at', 80
    ),
    enabled: !!bpId,
  });

  const loading = loadingAlerts || loadingActions || loadingSignals;

  // ── Build 5 section buckets ───────────────────────────────────────────────
  const { urgentItems, oppItems, trendItems, compItems, actionItems } = useMemo(() => {
    const seen = new Set();
    const dedup = (item) => {
      const key = normalizeTitle(item.title);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    };

    const activeAlerts  = alerts.filter(a => !dismissedIds.has(a.id) && !a.is_acted_on);
    const activeSignals = signals.filter(s => !dismissedIds.has(s.id));
    const activeActions = actions.filter(a => !dismissedIds.has(a.id) && a.status !== 'completed' && !a.is_dismissed);

    // 1 — Urgent
    const urgentItems = sortByPriority(
      activeAlerts
        .filter(a => URGENT_TYPES.has(a.alert_type))
        .map(a => ({
          id: a.id, navId: `alert-${a.id}`, kind: 'alert', dismissType: 'alert',
          title: a.title, description: a.description,
          type: a.alert_type || 'action_needed',
          priority: a.priority || 'medium', rawStatus: 'proposed',
          createdAt: a.created_date || a.created_at,
        }))
        .filter(dedup)
    );

    // 2 — Opportunities
    const oppFromAlerts = activeAlerts
      .filter(a => OPP_ALERT_TYPES.has(a.alert_type))
      .map(a => ({
        id: a.id, navId: `alert-${a.id}`, kind: 'alert', dismissType: 'alert',
        title: a.title, description: a.description,
        type: a.alert_type || 'opportunity',
        priority: a.priority || 'medium', rawStatus: 'proposed',
        createdAt: a.created_date || a.created_at,
      }))
      .filter(dedup);

    const oppFromSignals = activeSignals
      .filter(s => OPP_SIGNAL_CATS.has(s.category))
      .map(s => ({
        id: s.id, navId: `signal-${s.id}`, kind: 'signal', dismissType: 'signal',
        title: s.summary, description: s.recommended_action,
        type: s.category === 'demand_gap' ? 'demand_gap' : s.category === 'threat' ? 'risk' : 'market_opportunity',
        priority: signalPriority(s), rawStatus: 'proposed',
        createdAt: s.detected_at,
      }))
      .filter(dedup);

    const oppItems = sortByPriority([...oppFromAlerts, ...oppFromSignals]);

    // 3 — Trends (uses its own dedup Set — not shared with other sections)
    const trendSeen = new Set();
    const trendDedup = (item) => {
      const key = normalizeTitle(item.title);
      if (!key || trendSeen.has(key)) return false;
      trendSeen.add(key);
      return true;
    };
    const buildTrendItem = (item) => ({ ...item, trendSource: getTrendSource(item) });

    const trendFromAlerts = activeAlerts
      .filter(a => TREND_ALERT_TYPES.has(a.alert_type))
      .map(a => buildTrendItem({
        id: a.id, navId: `alert-${a.id}`, kind: 'alert', dismissType: 'trend',
        title: a.title, description: a.description,
        type: a.alert_type,
        priority: a.priority || 'medium', rawStatus: 'proposed',
        createdAt: a.created_date || a.created_at,
      }))
      .filter(trendDedup);

    const trendFromSignals = activeSignals
      .filter(s => TREND_SIGNAL_CATS.has(s.category))
      .map(s => buildTrendItem({
        id: s.id, navId: `signal-${s.id}`, kind: 'signal', dismissType: 'trend',
        _sigCat: s.category,
        _sigMeta: s.source_description,
        title: s.summary, description: s.recommended_action,
        type: s.category === 'viral_signal' || s.category === 'social' ? 'social_viral'
            : s.category === 'google_trend' ? 'trend_opportunity'
            : s.category === 'instagram_trend' || s.category === 'facebook_trend' ? 'social_viral'
            : 'trend_opportunity',
        priority: signalPriority(s), rawStatus: 'proposed',
        createdAt: s.detected_at,
      }))
      .filter(trendDedup);

    const trendItems = sortByPriority([...trendFromAlerts, ...trendFromSignals]);

    // 4 — Competitors
    const compFromAlerts = activeAlerts
      .filter(a => COMP_ALERT_TYPES.has(a.alert_type))
      .map(a => ({
        id: a.id, navId: `alert-${a.id}`, kind: 'alert', dismissType: 'competitor',
        title: a.title, description: a.description,
        type: a.alert_type,
        priority: a.priority || 'medium', rawStatus: 'proposed',
        createdAt: a.created_date || a.created_at,
      }))
      .filter(dedup);

    const compFromSignals = activeSignals
      .filter(s => COMP_SIGNAL_CATS.has(s.category))
      .map(s => ({
        id: s.id, navId: `signal-${s.id}`, kind: 'signal', dismissType: 'competitor',
        title: s.summary, description: s.recommended_action,
        type: 'competitor_move',
        priority: signalPriority(s), rawStatus: 'proposed',
        createdAt: s.detected_at,
      }))
      .filter(dedup);

    const compItems = sortByPriority([...compFromAlerts, ...compFromSignals]);

    // 5 — Pending Actions
    const actionItems = sortByPriority(
      activeActions
        .map(a => ({
          id: a.id, navId: `action-${a.id}`, kind: 'action', dismissType: 'alert',
          title: a.title, description: a.description,
          type: a.category || 'opportunity',
          priority: a.priority || 'medium',
          rawStatus: a.status || 'proposed',
          createdAt: a.created_date || a.created_at,
        }))
        .filter(dedup)
    );

    return { urgentItems, oppItems, trendItems, compItems, actionItems };
  }, [alerts, signals, actions, dismissedIds]);

  // ── Per-section filters ───────────────────────────────────────────────────
  const filteredTrends = trendSource === 'all'
    ? trendItems
    : trendItems.filter(i => i.trendSource === trendSource);

  const filteredComp = compFilter === 'all'
    ? compItems
    : compItems.filter(i => i.type === compFilter);

  const trendSourceFilters = useMemo(() => {
    const present = new Set(trendItems.map(i => i.trendSource));
    const opts = [{ value: 'all', label: 'כל המקורות' }];
    if (present.has('tiktok'))    opts.push({ value: 'tiktok',    label: 'TikTok' });
    if (present.has('instagram')) opts.push({ value: 'instagram', label: 'Instagram' });
    if (present.has('facebook'))  opts.push({ value: 'facebook',  label: 'Facebook' });
    if (present.has('google'))    opts.push({ value: 'google',    label: 'Google Trends' });
    if (present.has('general'))   opts.push({ value: 'general',   label: 'כללי' });
    return opts;
  }, [trendItems]);

  const compFilters = [
    { value: 'all',               label: 'הכל' },
    { value: 'competitor_move',   label: 'מהלכים' },
    { value: 'competitor_intel',  label: 'מודיעין' },
    { value: 'competitor_mention',label: 'אזכורים' },
  ];

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleDismiss = (item) => {
    setDismissedIds(prev => new Set([...prev, item.id]));
    const key = item.kind === 'signal' ? 'marketSignals' : item.kind === 'action' ? 'actions' : 'proactiveAlerts';
    queryClient.invalidateQueries({ queryKey: [key] });
    queryClient.invalidateQueries({ queryKey: ['activeInsights'] });
  };

  const handleLoadMore = (sectionId) => {
    setPages(prev => ({ ...prev, [sectionId]: prev[sectionId] + 8 }));
  };

  const totalActive = urgentItems.length + oppItems.length + trendItems.length + compItems.length + actionItems.length;

  const sectionProps = (sectionId, items, onOpen = navId => navigate(`/insights/${navId}`)) => ({
    sectionId, items, shownCount: pages[sectionId],
    onLoadMore: handleLoadMore,
    businessProfileId: bpId,
    onOpen,
    onDismiss: handleDismiss,
  });

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-12" dir="rtl">

      {/* Header */}
      <div className="flex items-center gap-2">
        <Lightbulb className="w-5 h-5 text-primary opacity-70" />
        <h1 className="text-[18px] font-bold text-foreground">תובנות</h1>
        {totalActive > 0 && (
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-foreground text-background">
            {totalActive} פעילות
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0,1,2,3].map(i => <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* ── 1. Urgent ── */}
          <SectionBlock
            {...sectionProps('urgent', urgentItems)}
            title="התראות דחופות"
            icon={AlertTriangle}
            iconColor="text-red-500"
            badgeColor="bg-red-100 text-red-700"
            filters={null}
            activeFilter="all"
            onFilterChange={() => {}}
            emptyMsg="אין התראות דחופות כרגע"
          />

          <div className="border-t border-border/60" />

          {/* ── 2. Opportunities ── */}
          <SectionBlock
            {...sectionProps('opportunities', oppItems)}
            title="הזדמנויות עסקיות"
            icon={Target}
            iconColor="text-green-500"
            badgeColor="bg-green-100 text-green-700"
            filters={null}
            activeFilter="all"
            onFilterChange={() => {}}
            emptyMsg="אין הזדמנויות עסקיות כרגע"
          />

          <div className="border-t border-border/60" />

          {/* ── 3. Trends ── */}
          <SectionBlock
            {...sectionProps('trends', filteredTrends)}
            title="מגמות וטרנדים"
            icon={TrendingUp}
            iconColor="text-purple-500"
            badgeColor="bg-purple-100 text-purple-700"
            filters={trendSourceFilters}
            activeFilter={trendSource}
            onFilterChange={setTrendSource}
            emptyMsg="אין טרנדים מזוהים כרגע"
          />

          <div className="border-t border-border/60" />

          {/* ── 4. Competitors ── */}
          <SectionBlock
            {...sectionProps('competitors', filteredComp)}
            title="מהלכי מתחרים"
            icon={Trophy}
            iconColor="text-indigo-500"
            badgeColor="bg-indigo-100 text-indigo-700"
            filters={compFilters}
            activeFilter={compFilter}
            onFilterChange={setCompFilter}
            emptyMsg="אין מהלכי מתחרים מזוהים כרגע"
          />

          <div className="border-t border-border/60" />

          {/* ── 5. Pending Actions ── */}
          <SectionBlock
            {...sectionProps('actions', actionItems)}
            title="פעולות ממתינות"
            icon={Zap}
            iconColor="text-amber-500"
            badgeColor="bg-amber-100 text-amber-700"
            filters={null}
            activeFilter="all"
            onFilterChange={() => {}}
            emptyMsg="אין פעולות ממתינות"
          />
        </>
      )}
    </div>
  );
}
