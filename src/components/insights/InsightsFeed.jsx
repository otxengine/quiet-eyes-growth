import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, Archive, ChevronDown } from 'lucide-react';
import StatCards from '@/components/shared/StatCards';
import DataTable from '@/components/shared/DataTable';
import DismissMenu from '@/components/ui/DismissMenu';

/**
 * InsightsFeed — the deduped/relevance-scored ProactiveAlert + MarketSignal
 * table, with stat cards and category filter tabs. Shared between the
 * Insights page and the Home dashboard (replacing the old LLM-generated
 * Daily Brief), so both surfaces read from the same real, DB-backed data.
 */

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

// ── Relevance scoring ────────────────────────────────────────────────────────
// Returns 0-100. Signals below RELEVANCE_THRESHOLD are hidden from the feed.
// Factors: impact alignment (30) + specificity (25) + actionability (25) + freshness (20)
/** @param {Record<string, any>} row */
function computeRelevanceScore(row) {
  let score = 0;

  const impactScores = { critical: 30, high: 25, medium: 18, low: 10 };
  score += impactScores[row.impact] ?? 18;

  const fullText = (row.summary || '') + ' ' + (row.raw?.recommended_action || '');
  if (row.raw?.recommended_action) score += 13;
  if (/\d/.test(fullText))         score += 8;
  if ((row.title || '').length > 20) score += 4;

  const ACTIONABLE_TYPES = new Set([
    'negative_review', 'reputation_risk', 'hot_lead', 'action_needed',
    'campaign_opportunity', 'demand_gap', 'content_opportunity',
    'retention_risk', 'competitor_move',
  ]);
  score += ACTIONABLE_TYPES.has(row.type) ? 25 : 12;

  const age = rowAgeInDays(row);
  if (age <= 1)       score += 20;
  else if (age <= 3)  score += 17;
  else if (age <= 7)  score += 13;
  else if (age <= 14) score += 7;

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
    .replace(/[^֐-׿‏‎a-z0-9\s]/g, '')
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

const DAY_MS = 24 * 60 * 60 * 1000;
function isWithinLast24h(dateStr) {
  if (!dateStr) return false;
  const t = new Date(dateStr).getTime();
  return !Number.isNaN(t) && Date.now() - t < DAY_MS;
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

export default function InsightsFeed({ businessProfile, show24hActivity = false }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const bpId = businessProfile?.id;
  const [showArchived,   setShowArchived]   = useState(false);
  const [activeCategory, setActiveCategory] = useState('all');

  // ── 24h activity stats — Home only, replaces the risk/opportunity stat row ──
  const { data: recentReviews = [] } = useQuery({
    queryKey: ['recentActivityReviews', bpId],
    queryFn: () => base44.entities.Review.filter({ linked_business: bpId }, '-created_date', 100),
    enabled: !!bpId && show24hActivity,
  });

  const { data: recentCompetitorPosts = [] } = useQuery({
    queryKey: ['recentActivityCompetitorPosts', bpId],
    queryFn: () => base44.entities.CompetitorPost.filter({ linked_business: bpId }, '-first_seen_at', 100),
    enabled: !!bpId && show24hActivity,
  });

  const { data: recentCompetitorAds = [] } = useQuery({
    queryKey: ['recentActivityCompetitorAds', bpId],
    queryFn: () => base44.entities.CompetitorAdHistory.filter({ linked_business: bpId }, '-first_seen_at', 100),
    enabled: !!bpId && show24hActivity,
  });

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

  // ── Dismissed items — lazy-loaded restore list ────────────────────────────
  const [showDismissed, setShowDismissed] = useState(false);

  const { data: dismissedAlerts = [], isLoading: loadingDismissedAlerts } = useQuery({
    queryKey: ['dismissedAlerts', bpId],
    queryFn: () => base44.entities.ProactiveAlert.filter({ linked_business: bpId, is_dismissed: true }, '-created_at', 50),
    enabled: !!bpId && showDismissed,
  });

  const { data: dismissedSignals = [], isLoading: loadingDismissedSignals } = useQuery({
    queryKey: ['dismissedSignals', bpId],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId, is_dismissed: true }, '-detected_at', 50),
    enabled: !!bpId && showDismissed,
  });

  const loadingDismissed = loadingDismissedAlerts || loadingDismissedSignals;

  const dismissedItems = useMemo(() => [
    ...dismissedAlerts.map(a => ({ id: a.id, kind: 'alert', title: a.title || a.message || '' })),
    ...dismissedSignals.map(s => ({ id: s.id, kind: 'signal', title: s.title || s.summary || '' })),
  ], [dismissedAlerts, dismissedSignals]);

  // ponytail: restore only flips is_dismissed back — it doesn't retract the
  // keyword updateInsightMemory already added to BusinessMemory.rejected_patterns,
  // since that keyword may be shared with other dismissals. Acceptable because
  // it's a soft prompt-avoidance signal, not a hard per-item block.
  const restoreMutation = useMutation({
    mutationFn: ({ kind, id }) => kind === 'alert'
      ? base44.entities.ProactiveAlert.update(id, { is_dismissed: false })
      : base44.entities.MarketSignal.update(id, { is_dismissed: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proactiveAlerts', bpId] });
      queryClient.invalidateQueries({ queryKey: ['allSignals', bpId] });
      queryClient.invalidateQueries({ queryKey: ['dismissedAlerts', bpId] });
      queryClient.invalidateQueries({ queryKey: ['dismissedSignals', bpId] });
    },
  });

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
  const scored   = useMemo(() => deduped.map(r => ({ ...r, relevance_score: computeRelevanceScore(r) })), [deduped]);
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

  // ── 24h activity counts (Home only) — reuses alerts/signals already fetched above ──
  const newReviewsCount = recentReviews.filter(r => isWithinLast24h(r.created_date)).length;
  const newPostsCount   = recentCompetitorPosts.filter(p => isWithinLast24h(p.first_seen_at)).length;
  const newAdsCount     = recentCompetitorAds.filter(a => isWithinLast24h(a.first_seen_at)).length;
  const newInsightsCount = alerts.filter(a => isWithinLast24h(a.created_at)).length
    + signals.filter(s => isWithinLast24h(s.detected_at)).length;

  const activityStatCards = [
    { count: newReviewsCount, label: 'ביקורות חדשות',        borderColor: 'blue' },
    { count: newPostsCount,   label: 'פוסטים חדשים ממתחרים', borderColor: 'yellow' },
    { count: newAdsCount,     label: 'מודעות חדשות ממתחרים', borderColor: 'none' },
    { count: newInsightsCount,label: 'תובנות חדשות',         borderColor: 'green' },
  ];

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

  const getTypeMeta  = (/** @type {string} */ type)   => TYPE_META[type]  || { label: type, color: 'text-foreground-secondary', bg: 'bg-gray-50' };
  const getValueMeta = (/** @type {string} */ impact) => VALUE_MAP[impact] || VALUE_MAP.medium;

  const removedByDedup = allRows.length - deduped.length;

  return (
    <div className="space-y-4">
      <StatCards cards={show24hActivity ? activityStatCards : statCards} />

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
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => navigate(`/insights/${row.kind}-${row.id}`)}
                    className="text-xs font-semibold text-[#e8344d] hover:underline whitespace-nowrap"
                  >
                    {getActionLabel(row)} &rarr;
                  </button>
                  <DismissMenu
                    entityType={row.kind}
                    entityId={row.id}
                    title={row.title}
                    businessProfileId={bpId}
                    buttonLabel=""
                    buttonClassName="text-foreground-muted hover:text-red-500 opacity-60 hover:opacity-100 transition-all flex items-center"
                    onDismissed={() => {
                      queryClient.invalidateQueries({ queryKey: ['proactiveAlerts', bpId] });
                      queryClient.invalidateQueries({ queryKey: ['allSignals', bpId] });
                    }}
                  />
                </div>
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

          {/* Dismissed items — restore flow */}
          <div dir="rtl" className="bg-white rounded-xl border border-gray-100">
            <button
              onClick={() => setShowDismissed(v => !v)}
              className="w-full px-4 py-3 flex items-center gap-2 text-[11px] text-foreground-muted hover:text-foreground transition-colors"
            >
              <Archive className="w-3.5 h-3.5" />
              פריטים שהוסרו
              {showDismissed && dismissedItems.length > 0 && (
                <span className="text-[10px] font-semibold">({dismissedItems.length})</span>
              )}
              <ChevronDown className={`w-3.5 h-3.5 mr-auto transition-transform ${showDismissed ? 'rotate-180' : ''}`} />
            </button>
            {showDismissed && (
              <div className="border-t border-gray-100 divide-y divide-gray-50 max-h-72 overflow-y-auto">
                {loadingDismissed ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-4 h-4 animate-spin text-foreground-muted" />
                  </div>
                ) : dismissedItems.length === 0 ? (
                  <p className="px-4 py-3 text-[12px] text-foreground-muted">אין פריטים שהוסרו</p>
                ) : dismissedItems.map(item => (
                  <div key={`${item.kind}-${item.id}`} className="px-4 py-2.5 flex items-center gap-3">
                    <p className="text-[12px] text-foreground-muted flex-1 truncate">{item.title}</p>
                    <button
                      onClick={() => restoreMutation.mutate({ kind: item.kind, id: item.id })}
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
        </>
      )}
    </div>
  );
}
