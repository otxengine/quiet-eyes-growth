import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Users, Loader2, MapPin, ExternalLink, Activity, MessageSquare, X } from 'lucide-react';
import DismissMenu from '@/components/ui/DismissMenu';
import { toast } from 'sonner';
import { usePlan } from '@/lib/usePlan';
import { getLimits } from '@/lib/planConfig';
import AiInsightsBar from '@/components/ai/AiInsightsBar';
import CompetitorScoreRow from '@/components/competitors/CompetitorScoreRow';
import CompetitorDetailCard from '@/components/competitors/CompetitorDetailCard';
import ComposerDrawer from '@/components/modals/ComposerDrawer';
import ReplyDrawer from '@/components/modals/ReplyDrawer';
import CompetitorTimeline from '@/components/intelligence/CompetitorTimeline';

// Map base44 category names to OTX sector names
function categoryToSector(category) {
  if (!category) return null;
  const c = category.toLowerCase();
  if (c.includes('fitness') || c.includes('gym') || c.includes('כושר')) return 'fitness';
  if (c.includes('restaurant') || c.includes('מסעד') || c.includes('אוכל')) return 'restaurant';
  if (c.includes('beauty') || c.includes('salon') || c.includes('יופי')) return 'beauty';
  return null;
}

// Map base44 city names to OTX geo_city keys
function cityToGeo(city) {
  if (!city) return null;
  const c = city.toLowerCase().replace(/\s+/g, '_');
  if (c.includes('bnei_brak') || c.includes('בני_ברק') || city.includes('בני ברק')) return 'bnei_brak';
  if (c.includes('tel_aviv') || c.includes('תל_אביב') || city.includes('תל אביב')) return 'tel_aviv';
  if (c.includes('jerusalem') || c.includes('ירושלים')) return 'jerusalem';
  return city.toLowerCase().replace(/\s+/g, '_');
}

const CHANGE_TYPE_LABELS = {
  price:            'שינוי מחיר',
  price_change:     'שינוי מחיר',
  website:          'שינוי אתר',
  website_change:   'שינוי אתר',
  social:           'פוסט חדש',
  new_post:         'פוסט חדש',
  reviews:          'שינוי ביקורות',
  review_delta:     'שינוי ביקורות',
  intel:            'תובנה',
  move:             'עדכון',
  new_promo:        'מבצע חדש',
  new_offering:     'שירות חדש',
  competitor_attack: 'שינוי ישיר',
  competitor_mention: 'אזכור',
};

const PLATFORM_BADGES = {
  instagram: { label: 'Instagram', color: 'bg-pink-50 text-pink-600 border-pink-100',  icon: '📸' },
  facebook:  { label: 'Facebook',  color: 'bg-blue-50 text-blue-600 border-blue-100',   icon: '👤' },
  tiktok:    { label: 'TikTok',    color: 'bg-[#f0f0f0] text-[#333] border-[#e0e0e0]', icon: '🎵' },
  google:    { label: 'Google',    color: 'bg-red-50 text-red-600 border-red-100',       icon: '⭐' },
  website:   { label: 'אתר',       color: 'bg-[#f5f5f5] text-[#555] border-[#e8e8e8]', icon: '🌐' },
};

const SENTIMENT_COLORS = {
  positive: 'text-green-600',
  neutral:  'text-[#888888]',
  negative: 'text-red-500',
};

function PlatformBadge({ platform }) {
  const meta = PLATFORM_BADGES[platform];
  if (!meta) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium border ${meta.color}`}>
      <span>{meta.icon}</span>{meta.label}
    </span>
  );
}

function formatHebrewDate(isoStr) {
  if (!isoStr) return '';
  return new Intl.DateTimeFormat('he-IL', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Jerusalem',
  }).format(new Date(isoStr));
}

// Competitor changes — merges MarketSignals (competitor_move) + ProactiveAlerts (competitor_intel/competitor_move)
async function fetchCompetitorChanges(businessProfile) {
  if (!businessProfile?.id) return { changes: [], bizId: null };
  try {
    const { base44 } = await import('@/api/base44Client');

    // Load both signal types in parallel
    const [signals, alerts] = await Promise.all([
      base44.entities.MarketSignal.filter(
        { linked_business: businessProfile.id, category: 'competitor_move' },
        '-detected_at', 40
      ).catch(() => []),
      base44.entities.ProactiveAlert.filter(
        { linked_business: businessProfile.id,
          alert_type: { in: ['competitor_move', 'competitor_intel', 'competitor_attack', 'competitor_mention'] },
          is_dismissed: false },
        '-created_at', 20
      ).catch(() => []),
    ]);

    const fromSignals = signals.map(s => {
      let parsed = {};
      try { parsed = JSON.parse(s.source_description || '{}'); } catch {}
      return {
        id: s.id,
        _kind: 'signal',
        competitor_name: parsed.competitor_name || s.agent_name || 'מתחרה',
        change_type: parsed.change_type || 'website',
        change_summary: s.summary,
        detected_at_utc: s.detected_at || s.created_date,
        source_url: s.source_urls || parsed.source_url || null,
        confidence_score: (s.confidence || 70) / 100,
        social_platform: parsed.social_platform || null,
        post_url: parsed.post_url || null,
        sentiment: parsed.sentiment || null,
        engagement_count: parsed.engagement_count || null,
        content_excerpt: parsed.content_excerpt || null,
        action_label: parsed.action_label || null,
        action_type: parsed.action_type || 'task',
        prefilled_text: parsed.prefilled_text || null,
        _fromBase44: true,
      };
    });

    const fromAlerts = alerts.map(a => {
      let parsed = {};
      try { parsed = JSON.parse(a.source_agent || '{}'); } catch {}
      // Extract competitor name from title (format: "🔍 CompName: ...")
      const nameMatch = a.title?.match(/^[🔍⚔️📊🔴]\s*([^:]+):/);
      const compName = nameMatch ? nameMatch[1].trim() : 'מתחרה';
      return {
        id: a.id,
        _kind: 'alert',
        competitor_name: compName,
        change_type: a.alert_type === 'competitor_intel' ? 'intel' : 'move',
        change_summary: a.description || a.title,
        detected_at_utc: a.created_at || a.created_date,
        source_url: null,
        confidence_score: a.priority === 'high' ? 0.85 : 0.65,
        social_platform: null,
        post_url: null,
        sentiment: null,
        engagement_count: null,
        content_excerpt: null,
        action_label: parsed.action_label || a.suggested_action || null,
        action_type: parsed.action_type || 'social_post',
        prefilled_text: parsed.prefilled_text || null,
        priority: a.priority,
        _fromBase44: true,
      };
    });

    // Merge + sort by date
    const changes = [...fromSignals, ...fromAlerts]
      .sort((a, b) => new Date(b.detected_at_utc || 0) - new Date(a.detected_at_utc || 0))
      .slice(0, 50);

    return { changes, bizId: null };
  } catch {
    return { changes: [], bizId: null };
  }
}

const filterTabs = [
  { key: 'all', label: 'הכל' },
  { key: 'rising', label: 'במגמת עלייה' },
  { key: 'declining', label: 'במגמת ירידה' },
  { key: 'tagged', label: 'מתויגים' },
];

export default function Competitors() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [scanning,      setScanning]     = useState(false);
  const [autoScanning,  setAutoScanning] = useState(false);
  const [activeFilter,  setActiveFilter] = useState('all');
  const [activeDrawer,  setActiveDrawer] = useState(null); // { type, props }
  const [dismissedAlerts, setDismissedAlerts] = useState(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem('dismissed_competitor_alerts') || '[]')); }
    catch { return new Set(); }
  });

  const dismissAlert = (id) => {
    setDismissedAlerts(prev => {
      const next = new Set([...prev, id]);
      try { sessionStorage.setItem('dismissed_competitor_alerts', JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const openCounterResponse = (change) => {
    const isSocial = ['social', 'new_post', 'intel', 'move'].includes(change.change_type) || change.action_type === 'social_post';
    if (isSocial) {
      const platform = change.social_platform ?? 'instagram';
      // Prefer prefilled_text from agent, then content_excerpt, then generic
      const text = change.prefilled_text
        || (change.content_excerpt ? `בתגובה ל: "${change.content_excerpt.slice(0, 80)}..."\n\n` : '')
        || `תגובה לפעילות של ${change.competitor_name}:`;
      setActiveDrawer({ type: 'composer', props: { text, platform, context: `פוסט תגובתי מול ${change.competitor_name}` } });
    } else {
      const reviewUrl = change.source_url?.includes('google') ? change.source_url : undefined;
      setActiveDrawer({ type: 'reply', props: { reviewUrl, reviewText: change.change_summary, context: `תגובה לשינוי של ${change.competitor_name}` } });
    }
  };

  const { data: _changesResult = { changes: [], bizId: null }, isLoading: loadingChanges, dataUpdatedAt: changesUpdatedAt, refetch: refetchChanges } = useQuery({
    queryKey: ['competitorChanges', bpId],
    queryFn: () => fetchCompetitorChanges(businessProfile),
    enabled: !!bpId,
    staleTime: 5 * 60 * 1000,
  });
  const competitorChanges = _changesResult.changes;
  const otxBizId = _changesResult.bizId;

  const { plan } = usePlan();
  const planLimits = getLimits(plan);

  const { data: competitors = [] } = useQuery({
    queryKey: ['competitorsPage', bpId],
    queryFn: () => base44.entities.Competitor.filter({ linked_business: bpId }),
    enabled: !!bpId
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['competitorsReviews', bpId],
    queryFn: () => base44.entities.Review.filter({ linked_business: bpId }),
    enabled: !!bpId
  });

  const { data: signals = [] } = useQuery({
    queryKey: ['competitorSignals', bpId],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId }, '-detected_at', 100),
    enabled: !!bpId
  });

  const avgRating = reviews.length > 0 ? reviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / reviews.length : 4.4;

  const handleScan = async () => {
    setScanning(true);
    toast.info('מתחיל סריקת מתחרים...');
    try {
      // Step 1: gather web signals
      await base44.functions.invoke('collectWebSignals', { businessProfileId: bpId });
      toast.info('אותות נאספו — מזהה מתחרים...');

      // Step 2: identify competitors from gathered signals
      const res = await base44.functions.invoke('runCompetitorIdentification', { businessProfileId: bpId });
      const { new_competitors_created = 0, existing_competitors_updated = 0 } = res?.data || {};

      // Step 3: competitor intelligence pipeline
      toast.info('סורק שינויים, מחירים, מבצעים ורשתות חברתיות...');
      await Promise.allSettled([
        base44.functions.invoke('batchSnapshotCompetitors',   { businessProfileId: bpId }),
        base44.functions.invoke('detectCompetitorChanges',    { businessProfileId: bpId }),
        base44.functions.invoke('analyzeCompetitorSocial',    { businessProfileId: bpId }),
        base44.functions.invoke('competitorSocialTracker',    { businessProfileId: bpId }),
      ]);

      // Step 4: intel + advisory insights
      await Promise.allSettled([
        base44.functions.invoke('competitorIntelAgent',      { businessProfileId: bpId }),
        base44.functions.invoke('competitorMoveTracker',     { businessProfileId: bpId }),
        base44.functions.invoke('runMarketIntelligence',     { businessProfileId: bpId }),
      ]);

      queryClient.invalidateQueries({ queryKey: ['competitorsPage'] });
      queryClient.invalidateQueries({ queryKey: ['competitorSignals'] });
      queryClient.invalidateQueries({ queryKey: ['competitorChanges', bpId] });

      if (new_competitors_created > 0) {
        toast.success(`נמצאו ${new_competitors_created} מתחרים חדשים ✓`);
      } else if (existing_competitors_updated > 0) {
        toast.success(`${existing_competitors_updated} מתחרים עודכנו ✓`);
      } else {
        toast.info('הסריקה הושלמה — אין שינויים חדשים');
      }
    } catch (err) {
      toast.error('שגיאה בסריקת מתחרים — בדוק את לוג השרת');
      console.error('Scan failed:', err);
    }
    setScanning(false);
  };

  useEffect(() => {
    window.__quieteyes_scan = handleScan;
    return () => { delete window.__quieteyes_scan; };
  }, [bpId]);

  // Competitor move signals from base44 — used as fallback when OTX has no data
  const competitorSignals = signals.filter(s => s.category === 'competitor_move');

  // Merge: prefer OTX competitor_changes, fall back to base44 signals shaped as changes
  const mergedChanges = competitorChanges.length > 0
    ? competitorChanges
    : competitorSignals.map(s => ({
        id: s.id,
        competitor_name: s.agent_name || 'מתחרה',
        change_type: 'website',
        change_summary: s.summary,
        detected_at_utc: s.detected_at || s.created_date,
        source_url: null,
        confidence_score: (s.confidence || 70) / 100,
        social_platform: null,
        post_url: null,
        sentiment: null,
        engagement_count: null,
        content_excerpt: null,
        _fromBase44: true,
      }));

  const visibleCompetitors = planLimits.competitors_max === Infinity
    ? competitors
    : competitors.slice(0, planLimits.competitors_max);
  const hiddenCount = competitors.length - visibleCompetitors.length;

  const filtered = visibleCompetitors.filter(comp => {
    if (activeFilter === 'rising') return comp.trend_direction === 'up';
    if (activeFilter === 'declining') return comp.trend_direction === 'down';
    if (activeFilter === 'tagged') return comp.tags && comp.tags.trim().length > 0;
    return true;
  });

  const risingCount = competitors.filter(c => c.trend_direction === 'up').length;
  const decliningCount = competitors.filter(c => c.trend_direction === 'down').length;
  const address = businessProfile?.full_address || businessProfile?.city || '';

  const silentScanChanges = async () => {
    if (!bpId || autoScanning) return;
    setAutoScanning(true);
    try {
      await base44.functions.invoke('collectWebSignals', { businessProfileId: bpId });
      await base44.functions.invoke('runCompetitorIdentification', { businessProfileId: bpId });
      await base44.functions.invoke('runMarketIntelligence', { businessProfileId: bpId });
      localStorage.setItem(`lastChangeScan_${bpId}`, String(Date.now()));
      queryClient.invalidateQueries({ queryKey: ['competitorsPage'] });
      queryClient.invalidateQueries({ queryKey: ['competitorSignals'] });
      queryClient.invalidateQueries({ queryKey: ['competitorChanges', bpId] });
    } catch {}
    setAutoScanning(false);
  };

  useEffect(() => {
    if (loadingChanges || mergedChanges.length > 0 || competitors.length === 0 || autoScanning) return;
    const lastScan = localStorage.getItem(`lastChangeScan_${bpId}`);
    const hoursAgo = lastScan ? (Date.now() - Number(lastScan)) / 3600000 : 999;
    if (hoursAgo > 3) silentScanChanges();
  }, [mergedChanges.length, competitors.length, loadingChanges, bpId]);

  // Handle ?newCompetitor= URL param — show toast + highlight matching competitor
  useEffect(() => {
    const newCompName = searchParams.get('newCompetitor');
    if (!newCompName) return;
    toast.info(`מתחרה חדש זוהה: ${newCompName}`, { duration: 6000 });
    if (competitors.length > 0) {
      const match = competitors.find(c =>
        (c.name || '').toLowerCase().includes(newCompName.toLowerCase())
      );
      if (match) setSelectedComp(match);
    }
  }, [searchParams, competitors.length]); // eslint-disable-line

  return (
    <>
    <div className="space-y-5">
      <AiInsightsBar
        title="תובנות AI — ניתוח תחרותי"
        prompt={`נתח את הנוף התחרותי של העסק: אלו מתחרים מהווים את האיום הגדול ביותר, מה ההזדמנות הכי ברורה להבדלה, ומה הפעולה הדחופה ביותר לחיזוק המיצוב.`}
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[16px] font-bold text-foreground tracking-tight">מתחרים</h1>
          {address && (
            <div className="flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3 text-[#cccccc]" />
              <span className="text-[10px] text-[#bbbbbb]">אזור: {address}</span>
            </div>
          )}
        </div>
        <button onClick={handleScan} disabled={scanning}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium bg-foreground text-background hover:opacity-90 transition-all disabled:opacity-50">
          {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
          {scanning ? 'סורק...' : 'סרוק מתחרים ←'}
        </button>
      </div>

      {/* ── Main content ── */}
      <>

      {/* OTX Competitor Changes section — data from agent */}
      <div className="card-base fade-in-up">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold text-foreground text-[13px] flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary opacity-60" />
            שינויים שזוהו אצל המתחרים
          </h3>
          <div className="flex items-center gap-2">
            {changesUpdatedAt > 0 && (
              <span className="text-[10px] text-foreground-muted">
                עודכן לאחרונה: {Math.round((Date.now() - changesUpdatedAt) / 60000)} דקות
              </span>
            )}
            <span className="text-[10px] text-foreground-muted">{mergedChanges.length} רשומות</span>
            <button
              onClick={async () => {
                try {
                  await base44.functions.invoke('competitorMoveTracker', { businessProfileId: bpId });
                  refetchChanges();
                } catch {}
              }}
              disabled={loadingChanges}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium border border-border hover:border-foreground-muted text-foreground-muted hover:text-foreground transition-colors disabled:opacity-40"
            >
              {loadingChanges ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
              סרוק שינויים
            </button>
          </div>
        </div>
        {loadingChanges ? (
          <div className="flex items-center justify-center py-10 gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-foreground-muted" />
            <span className="text-[12px] text-foreground-muted">טוען נתוני מתחרים...</span>
          </div>
        ) : mergedChanges.length === 0 ? (
          <div className="py-12 text-center">
            <Activity className="w-10 h-10 text-foreground-muted opacity-20 mx-auto mb-3" />
            <p className="text-[13px] text-foreground-muted">טרם זוהו שינויים — לחץ "סרוק מתחרים" להתחיל</p>
            <p className="text-[11px] text-foreground-muted opacity-50 mt-1">הסריקה מחפשת שינויים בפרסומות, ביקורות ואתרים</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {mergedChanges.filter(c => !dismissedAlerts.has(c.id)).map((change) => (
              <div key={change.id} className="px-5 py-3.5 hover:bg-secondary/30 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Name + type badge + platform badge */}
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-[12px] font-semibold text-foreground">{change.competitor_name}</span>
                      <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-medium ${
                        change._kind === 'alert' && change.priority === 'high'
                          ? 'bg-red-50 text-red-600'
                          : 'bg-primary/10 text-primary'
                      }`}>
                        {CHANGE_TYPE_LABELS[change.change_type] ?? change.change_type}
                      </span>
                      {change.social_platform && (
                        <PlatformBadge platform={change.social_platform} />
                      )}
                      {change.sentiment && (
                        <span className={`text-[9px] font-medium ${SENTIMENT_COLORS[change.sentiment] ?? ''}`}>
                          {change.sentiment === 'positive' ? '↑ חיובי' : change.sentiment === 'negative' ? '↓ שלילי' : '→ ניטרלי'}
                        </span>
                      )}
                    </div>

                    {/* Content excerpt (social posts) */}
                    {change.content_excerpt && (
                      <p className="text-[11px] text-foreground-muted mb-1 leading-snug italic line-clamp-2">
                        "{change.content_excerpt}"
                      </p>
                    )}

                    {/* Summary (non-social) */}
                    {!change.content_excerpt && change.change_summary && (
                      <p className="text-[11px] text-foreground-muted mb-1 leading-snug">{change.change_summary}</p>
                    )}

                    {/* Engagement */}
                    {change.engagement_count != null && (
                      <p className="text-[10px] text-foreground-muted mb-1">
                        ❤️ {change.engagement_count.toLocaleString()} אינטרקציות
                      </p>
                    )}

                    {/* Bottom row: date + source link */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-[10px] text-foreground-muted opacity-60">
                        {formatHebrewDate(change.detected_at_utc)}
                      </span>
                      {(change.post_url || change.source_url) && (
                        <a
                          href={change.post_url ?? change.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-[10px] text-primary hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          מקור
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Right column: confidence + counter-response button + dismiss */}
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-foreground-muted opacity-50">
                        {Math.round((change.confidence_score ?? 0) * 100)}%
                      </span>
                      <DismissMenu
                        entityType="signal"
                        entityId={change._fromBase44 ? change.id : undefined}
                        title={change.change_summary || change.competitor_name}
                        businessProfileId={bpId}
                        onDismissed={() => dismissAlert(change.id)}
                        buttonLabel=""
                        buttonClassName="text-foreground-muted opacity-40 hover:opacity-80 hover:text-danger transition-all flex items-center gap-0.5"
                      />
                    </div>
                    <button
                      onClick={() => openCounterResponse(change)}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-primary/8 text-primary border border-primary/15 hover:bg-primary/15 transition-all"
                    >
                      <MessageSquare className="w-3 h-3" />
                      פעולה מוצעת
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {competitors.length === 0 ? (
        <div className="bg-white rounded-[10px] border border-[#f0f0f0] py-16 text-center">
          <Users className="w-12 h-12 text-[#cccccc] mx-auto mb-3" />
          <p className="text-[13px] text-[#999999] mb-3">טרם זוהו מתחרים — לחץ "סרוק מתחרים" לזהות מתחרים באזור שלך</p>
          {!businessProfile?.full_address && (
            <p className="text-[11px] text-[#d97706] mb-3">💡 טיפ: הוסף כתובת מלאה בהגדרות לקבלת תוצאות מדויקות יותר</p>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card-base p-4 fade-in-up stagger-1">
              <p className="text-[11px] font-medium text-foreground-muted mb-1">סה"כ מתחרים</p>
              <span className="text-[24px] font-bold text-foreground tracking-tight">{competitors.length}</span>
            </div>
            <div className="card-base p-4 fade-in-up stagger-2">
              <p className="text-[11px] font-medium text-foreground-muted mb-1">במגמת עלייה</p>
              <span className="text-[24px] font-bold text-success tracking-tight">{risingCount}</span>
            </div>
            <div className="card-base p-4 fade-in-up stagger-3">
              <p className="text-[11px] font-medium text-foreground-muted mb-1">במגמת ירידה</p>
              <span className="text-[24px] font-bold text-danger tracking-tight">{decliningCount}</span>
            </div>
            <div className="card-base p-4 fade-in-up stagger-4">
              <p className="text-[11px] font-medium text-foreground-muted mb-1">הדירוג שלך</p>
              <span className="text-[24px] font-bold text-foreground tracking-tight">{Number(avgRating).toFixed(1)}</span>
            </div>
          </div>

          <CompetitorScoreRow business={businessProfile} avgRating={avgRating} reviewCount={reviews.length} competitors={competitors} />

          <div className="flex gap-0.5 border-b border-border">
            {filterTabs.map((tab) => (
              <button key={tab.key} onClick={() => setActiveFilter(tab.key)}
                className={`px-4 py-2.5 text-[12px] font-medium transition-all duration-150 relative ${activeFilter === tab.key ? 'text-foreground' : 'text-foreground-muted hover:text-foreground-secondary'}`}>
                {tab.label}
                {activeFilter === tab.key && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-t" />}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {filtered.length === 0 ? (
              <p className="text-[12px] text-[#999999] text-center py-8">אין מתחרים בפילטר הנוכחי</p>
            ) : (
              filtered.map((comp) => (
                <div key={comp.id} className="rounded-xl overflow-hidden">
                  <CompetitorDetailCard
                    competitor={comp}
                    businessName={businessProfile?.name}
                    signals={signals}
                    businessProfileId={bpId}
                    otxBizId={otxBizId}
                    intelChanges={mergedChanges}
                  />
                  <div className="w-full flex items-center justify-end gap-1.5 px-4 py-2 text-[11px] font-medium border border-t-0 border-border bg-secondary">
                    <DismissMenu
                      entityType="competitor"
                      entityId={comp.id}
                      title={comp.name}
                      businessProfileId={bpId}
                      onDismissed={() => queryClient.invalidateQueries({ queryKey: ['competitorsPage'] })}
                      buttonLabel="לא רלוונטי"
                      buttonClassName="flex items-center gap-1 text-[10px] text-foreground-muted hover:text-red-500 transition-colors"
                    />
                  </div>
                </div>
              ))
            )}
            {hiddenCount > 0 && (
              <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50 px-5 py-4 text-center">
                <p className="text-[12px] text-amber-800 font-medium">
                  {hiddenCount} מתחרים נוספים מוסתרים בתוכנית הנוכחית ({planLimits.competitors_max} מתחרים מקסימום)
                </p>
                <a href="/subscription" className="mt-2 inline-block text-[11px] font-semibold text-amber-700 underline underline-offset-2">
                  שדרג תוכנית לצפות בכולם →
                </a>
              </div>
            )}
          </div>
        </>
      )}

      </>

      <CompetitorTimeline bpId={businessProfile?.id} />

    </div>

    {/* Global drawers for counter-response actions */}
    {activeDrawer?.type === 'composer' && (
      <ComposerDrawer {...activeDrawer.props} onClose={() => setActiveDrawer(null)} />
    )}
    {activeDrawer?.type === 'reply' && (
      <ReplyDrawer {...activeDrawer.props} onClose={() => setActiveDrawer(null)} />
    )}
    </>
  );
}