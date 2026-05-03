import React, { useState, useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Users, Loader2, MapPin, ExternalLink, Activity, MessageSquare, X, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { usePlan } from '@/lib/usePlan';
import { getLimits } from '@/lib/planConfig';
import AiInsightsBar from '@/components/ai/AiInsightsBar';
import CompetitorScoreRow from '@/components/competitors/CompetitorScoreRow';
import CompetitorDetailCard from '@/components/competitors/CompetitorDetailCard';
import ComposerDrawer from '@/components/modals/ComposerDrawer';
import ReplyDrawer from '@/components/modals/ReplyDrawer';
import StrategicAnalysisPanel from '@/components/competitors/StrategicAnalysisPanel';
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
  price:   'שינוי מחיר',
  website: 'שינוי אתר',
  social:  'פוסט חדש',
  reviews: 'שינוי ביקורות',
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

// Competitor changes are sourced from MarketSignal (category=competitor_move) via the fallback in mergedChanges below.
// The old OTX Supabase lookup has been removed — the 'businesses' table does not exist in this project.
async function fetchCompetitorChanges(_businessProfile) {
  return { changes: [], bizId: null };
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
  const [selectedComp,  setSelectedComp] = useState(null);
  const analysisPanelRef = useRef(null);
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

  useEffect(() => {
    if (selectedComp && analysisPanelRef.current) {
      setTimeout(() => analysisPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  }, [selectedComp]);

  const openCounterResponse = (change) => {
    const isSocial = change.change_type === 'social';
    if (isSocial) {
      // Open ComposerDrawer with a suggested counter-post
      const platform = change.social_platform ?? 'instagram';
      const suggestion = change.content_excerpt
        ? `בתגובה ל: "${change.content_excerpt.slice(0, 80)}..."\n\nהנה מה שאנחנו מציעים:`
        : `תגובה לפעילות של ${change.competitor_name} ב${PLATFORM_BADGES[platform]?.label ?? platform}:`;
      setActiveDrawer({ type: 'composer', props: { text: suggestion, platform, context: `פוסט תגובתי מול ${change.competitor_name}` } });
    } else {
      // Open ReplyDrawer for review/website changes
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

  const avgRating = reviews.length > 0 ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length : 4.4;

  const handleScan = async () => {
    setScanning(true);
    toast.info('מתחיל סריקת מתחרים...');
    try {
      // Step 1: gather web signals
      await base44.functions.invoke('collectWebSignals', { businessProfileId: bpId });
      toast.info('אותות נאספו — מנתח מתחרים...');

      // Step 2: identify competitors from gathered signals
      const res = await base44.functions.invoke('runCompetitorIdentification', { businessProfileId: bpId });
      const { new_competitors_created = 0, existing_competitors_updated = 0 } = res?.data || {};

      // Step 3: run market intelligence to populate competitor_move signals
      await base44.functions.invoke('runMarketIntelligence', { businessProfileId: bpId });

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
      {true && <>

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
              onClick={() => refetchChanges()}
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
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-primary/10 text-primary">
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
                      <button
                        onClick={() => dismissAlert(change.id)}
                        className="text-foreground-muted opacity-40 hover:opacity-80 hover:text-danger transition-all"
                        title="הסתר התראה"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <button
                      onClick={() => openCounterResponse(change)}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-primary/8 text-primary border border-primary/15 hover:bg-primary/15 transition-all"
                    >
                      <MessageSquare className="w-3 h-3" />
                      תגובה נגדית
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
              <span className="text-[24px] font-bold text-foreground tracking-tight">{avgRating.toFixed(1)}</span>
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

          {selectedComp && (
            <div ref={analysisPanelRef}>
              <StrategicAnalysisPanel
                competitor={selectedComp}
                businessProfile={businessProfile}
                competitors={competitors}
                signals={signals.filter(s => s.category === 'competitor_move')}
                onClose={() => setSelectedComp(null)}
              />
            </div>
          )}

          <div className="space-y-3">
            {filtered.length === 0 ? (
              <p className="text-[12px] text-[#999999] text-center py-8">אין מתחרים בפילטר הנוכחי</p>
            ) : (
              filtered.map((comp) => (
                <div
                  key={comp.id}
                  onClick={() => setSelectedComp(prev => prev?.id === comp.id ? null : comp)}
                  className={`rounded-xl overflow-hidden cursor-pointer transition-all ${selectedComp?.id === comp.id ? 'ring-2 ring-primary/40' : ''}`}
                >
                  <CompetitorDetailCard
                    competitor={comp}
                    businessName={businessProfile?.name}
                    signals={signals}
                    businessProfileId={bpId}
                    otxBizId={otxBizId}
                  />
                  <div className={`w-full flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium border border-t-0 border-border transition-colors ${selectedComp?.id === comp.id ? 'bg-primary/5 text-primary' : 'bg-secondary text-foreground-muted hover:bg-secondary/70'}`}>
                    <FileText className="w-3.5 h-3.5" />
                    {selectedComp?.id === comp.id ? 'הסתר ניתוח אסטרטגי' : 'SWOT · אסטרטגיה · קרב'}
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

      </> /* end main section */}

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