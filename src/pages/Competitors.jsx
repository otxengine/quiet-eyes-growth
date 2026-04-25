import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { otxSupabase } from '@/lib/otx-supabase';
import { Users, Loader2, MapPin, ExternalLink, Activity, MessageSquare, X, Search, Zap, LayoutGrid, Globe, ShieldCheck, FileText } from 'lucide-react';
import { toast } from 'sonner';
import CompetitorScoreRow from '@/components/competitors/CompetitorScoreRow';
import CompetitorDetailCard from '@/components/competitors/CompetitorDetailCard';
import AiInsightBox from '@/components/ai/AiInsightBox';
import StrategicRecommendations from '@/components/intelligence/StrategicRecommendations';
import ComposerDrawer from '@/components/modals/ComposerDrawer';
import ReplyDrawer from '@/components/modals/ReplyDrawer';
import BattlecardPanel from '@/components/competitors/BattlecardPanel';

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

async function fetchCompetitorChanges(businessProfile) {
  const sector = categoryToSector(businessProfile?.category);
  const geo    = cityToGeo(businessProfile?.city);

  // Step 1: find existing OTX business
  let bizId = null;
  try {
    let q = otxSupabase.from('businesses').select('id');
    if (sector) q = q.eq('sector', sector);
    if (geo)    q = q.eq('geo_city', geo);
    const { data: existing } = await q.limit(1).maybeSingle();
    bizId = existing?.id ?? null;

    // Step 2: if not found, create one so agents can populate it later
    if (!bizId && businessProfile?.name) {
      const { data: created } = await otxSupabase
        .from('businesses')
        .insert({
          name:     businessProfile.name,
          sector:   sector || 'local',
          geo_city: geo    || (businessProfile.city || 'unknown'),
        })
        .select('id')
        .single();
      bizId = created?.id ?? null;
    }
  } catch (e) {
    console.warn('[fetchCompetitorChanges] businesses lookup failed:', e.message);
  }

  if (!bizId) return { changes: [], bizId: null };

  try {
    const { data: changes } = await otxSupabase
      .from('competitor_changes')
      .select('id, business_id, competitor_name, change_type, change_summary, detected_at_utc, source_url, confidence_score, social_platform, post_url, sentiment, engagement_count, content_excerpt')
      .eq('business_id', bizId)
      .order('detected_at_utc', { ascending: false })
      .limit(50);
    return { changes: changes ?? [], bizId };
  } catch (e) {
    console.warn('[fetchCompetitorChanges] changes query failed:', e.message);
    return { changes: [], bizId };
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
  const [scanning,          setScanning]          = useState(false);
  const [checkingPrices,    setCheckingPrices]    = useState(false);
  const [detectingChanges,  setDetectingChanges]  = useState(false);
  const [scanningOsint,     setScanningOsint]     = useState(false);
  const [checkingPlatforms, setCheckingPlatforms] = useState(false);
  const [activeSection,  setActiveSection]  = useState('analysis');
  const [activeFilter,   setActiveFilter]   = useState('all');
  const [activeDrawer,   setActiveDrawer]   = useState(null); // { type, props }
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

  const { data: _changesResult = { changes: [], bizId: null }, isLoading: loadingChanges } = useQuery({
    queryKey: ['competitorChanges', bpId],
    queryFn: () => fetchCompetitorChanges(businessProfile),
    enabled: !!bpId,
  });
  const competitorChanges = _changesResult.changes;
  const otxBizId = _changesResult.bizId;

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

  const { data: osintAlerts = [] } = useQuery({
    queryKey: ['competitorOsintAlerts', bpId],
    queryFn: () => base44.entities.ProactiveAlert.filter({ linked_business: bpId, alert_type: 'competitor_intel' }, '-created_date', 30),
    enabled: !!bpId && activeSection === 'osint',
  });

  const { data: platformSignals = [] } = useQuery({
    queryKey: ['platformIntelSignals', bpId],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId, category: 'competitor' }, '-detected_at', 30),
    enabled: !!bpId && activeSection === 'platforms',
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

  const filtered = competitors.filter(comp => {
    if (activeFilter === 'rising') return comp.trend_direction === 'up';
    if (activeFilter === 'declining') return comp.trend_direction === 'down';
    if (activeFilter === 'tagged') return comp.tags && comp.tags.trim().length > 0;
    return true;
  });

  const risingCount = competitors.filter(c => c.trend_direction === 'up').length;
  const decliningCount = competitors.filter(c => c.trend_direction === 'down').length;
  const address = businessProfile?.full_address || businessProfile?.city || '';

  return (
    <>
    <div className="space-y-5">
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
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={async () => {
              if (!bpId) return;
              setScanningOsint(true);
              toast.info('סורק מודיעין OSINT על מתחרים...');
              try {
                const res = await base44.functions.invoke('competitorIntelAgent', { businessProfileId: bpId });
                const found = res?.data?.alerts_created ?? 0;
                queryClient.invalidateQueries({ queryKey: ['competitorOsintAlerts', bpId] });
                queryClient.invalidateQueries({ queryKey: ['competitorsPage'] });
                toast.success(found > 0 ? `נוצרו ${found} תובנות OSINT ✓` : 'הסריקה הושלמה — אין תובנות חדשות');
              } catch { toast.error('שגיאה בסריקת OSINT'); }
              setScanningOsint(false);
            }}
            disabled={scanningOsint}
            className="btn-subtle flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-[12px] font-medium text-foreground-secondary bg-secondary border border-border hover:bg-secondary/80 transition-all disabled:opacity-50"
          >
            {scanningOsint ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {scanningOsint ? 'סורק...' : 'סרוק OSINT'}
          </button>
          <button
            onClick={async () => {
              if (!bpId) return;
              setCheckingPlatforms(true);
              toast.info('בודק פלטפורמות ומשלוחים...');
              try {
                const res = await base44.functions.invoke('detectDeliveryChanges', { businessProfileId: bpId });
                const found = res?.data?.alerts_created ?? 0;
                queryClient.invalidateQueries({ queryKey: ['platformIntelSignals', bpId] });
                toast.success(found > 0 ? `נמצאו ${found} תובנות פלטפורמה ✓` : 'לא נמצאו שינויים בפלטפורמות');
              } catch { toast.error('שגיאה בבדיקת פלטפורמות'); }
              setCheckingPlatforms(false);
            }}
            disabled={checkingPlatforms}
            className="btn-subtle flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-[12px] font-medium text-foreground-secondary bg-secondary border border-border hover:bg-secondary/80 transition-all disabled:opacity-50"
          >
            {checkingPlatforms ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
            {checkingPlatforms ? 'בודק...' : 'בדוק פלטפורמות'}
          </button>
          <button
            onClick={async () => {
              if (!bpId) return;
              setCheckingPrices(true);
              toast.info('בודק מחירי מתחרים...');
              try {
                const res = await base44.functions.invoke('detectCompetitorPricing', { businessProfileId: bpId });
                const found = res?.data?.prices_found ?? 0;
                queryClient.invalidateQueries({ queryKey: ['competitorsPage'] });
                toast.success(found > 0 ? `נמצאו מחירים ל-${found} מתחרים ✓` : 'לא נמצאו מחירים חדשים');
              } catch { toast.error('שגיאה בבדיקת מחירים'); }
              setCheckingPrices(false);
            }}
            disabled={checkingPrices}
            className="btn-subtle flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-[12px] font-medium text-foreground-secondary bg-secondary border border-border hover:bg-secondary/80 transition-all disabled:opacity-50"
          >
            {checkingPrices ? <Loader2 className="w-4 h-4 animate-spin" /> : '₪'}
            {checkingPrices ? 'בודק...' : 'מחירי מתחרים'}
          </button>
          {/* ITEM 3: Detect real competitor changes */}
          <button
            onClick={async () => {
              if (!bpId) return;
              setDetectingChanges(true);
              toast.info('סורק שינויים אצל מתחרים...');
              try {
                const res = await base44.functions.invoke('detectCompetitorChanges', { businessProfileId: bpId });
                const found = res?.data?.changes_detected ?? 0;
                queryClient.invalidateQueries({ queryKey: ['competitorsPage'] });
                queryClient.invalidateQueries({ queryKey: ['competitorSignals'] });
                toast.success(found > 0 ? `זוהו ${found} שינויים ✓` : 'לא זוהו שינויים חדשים');
              } catch { toast.error('שגיאה בזיהוי שינויים'); }
              setDetectingChanges(false);
            }}
            disabled={detectingChanges}
            className="btn-subtle flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-[12px] font-medium text-foreground-secondary bg-secondary border border-border hover:bg-secondary/80 transition-all disabled:opacity-50"
          >
            {detectingChanges ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
            {detectingChanges ? 'סורק...' : 'זהה שינויים'}
          </button>
          <button
            onClick={async () => {
              if (!bpId) return;
              toast.info('בודק דירוג גוגל...');
              try {
                const res = await base44.functions.invoke('googleRankMonitor', { businessProfileId: bpId });
                const { rank = null, reviews_needed = 0 } = res?.data || {};
                queryClient.invalidateQueries({ queryKey: ['competitorsPage'] });
                toast.success(rank ? `דירוג גוגל משוער: #${rank} · ${reviews_needed} ביקורות לטופ 3` : 'בדיקת דירוג הושלמה');
              } catch { toast.error('שגיאה בבדיקת דירוג'); }
            }}
            className="btn-subtle flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-[12px] font-medium text-foreground-secondary bg-secondary border border-border hover:bg-secondary/80 transition-all"
          >
            📍 דירוג גוגל
          </button>
          <button onClick={handleScan} disabled={scanning}
            className="btn-subtle flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium bg-foreground text-background hover:opacity-90 transition-all disabled:opacity-50">
            {scanning && <Loader2 className="w-4 h-4 animate-spin" />} {scanning ? 'סורק...' : 'סרוק מתחרים ←'}
          </button>
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex gap-0.5 border-b border-border">
        {[
          { key: 'analysis',    label: 'ניתוח',          icon: LayoutGrid },
          { key: 'platforms',   label: 'פלטפורמות',       icon: Globe },
          { key: 'osint',       label: 'תובנות OSINT',    icon: ShieldCheck },
          { key: 'battlecards', label: 'Battlecards',     icon: FileText },
        ].map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setActiveSection(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium transition-all duration-150 relative ${
              activeSection === key ? 'text-foreground' : 'text-foreground-muted hover:text-foreground-secondary'
            }`}>
            <Icon className="w-3.5 h-3.5" />
            {label}
            {activeSection === key && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-t" />}
          </button>
        ))}
      </div>

      {/* ── ANALYSIS section ── */}
      {activeSection === 'analysis' && <>

      {/* OTX Competitor Changes section — data from agent */}
      <div className="card-base fade-in-up">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-foreground text-[13px] flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary opacity-60" />
            שינויים שזוהו אצל המתחרים
          </h3>
          <span className="text-[10px] text-foreground-muted">{mergedChanges.length} רשומות</span>
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

          <StrategicRecommendations
            businessProfile={businessProfile}
            competitors={competitors}
            signals={signals.filter(s => s.category === 'competitor_move')}
            title="המלצות אסטרטגיות מול מתחרים"
          />

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
                <CompetitorDetailCard
                  key={comp.id}
                  competitor={comp}
                  businessName={businessProfile?.name}
                  signals={signals}
                  businessProfileId={bpId}
                  otxBizId={otxBizId}
                />
              ))
            )}
          </div>
        </>
      )}

      </> /* end analysis section */}

      {/* ── PLATFORMS section ── */}
      {activeSection === 'platforms' && (
        <div className="space-y-4">
          <div className="card-base fade-in-up">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold text-foreground text-[13px] flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary opacity-60" />
                מודיעין פלטפורמות ומשלוחים
              </h3>
              <span className="text-[10px] text-foreground-muted">{platformSignals.length} תובנות</span>
            </div>
            {platformSignals.length === 0 ? (
              <div className="py-14 text-center">
                <Globe className="w-10 h-10 text-foreground-muted opacity-20 mx-auto mb-3" />
                <p className="text-[13px] text-foreground-muted mb-1">טרם נסרקו פלטפורמות</p>
                <p className="text-[11px] text-foreground-muted opacity-50">לחץ "בדוק פלטפורמות" לסרוק וולט, טריפ-אדוויזור, בוקינג ועוד</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {platformSignals.map(sig => {
                  let meta = {};
                  try { meta = JSON.parse(sig.source_description || '{}'); } catch {}
                  return (
                    <div key={sig.id} className="px-5 py-4 hover:bg-secondary/30 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-[12px] font-semibold text-foreground">{sig.agent_name || 'תובנת פלטפורמה'}</span>
                            {meta.action_label && (
                              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-blue-50 text-blue-600 border border-blue-100">
                                {meta.action_label}
                              </span>
                            )}
                          </div>
                          <p className="text-[12px] text-foreground-secondary leading-relaxed">{sig.summary}</p>
                          {meta.prefilled_text && (
                            <div className="mt-2 bg-secondary rounded-lg px-3 py-2 border border-border">
                              <p className="text-[11px] text-foreground-muted mb-0.5">הצעת תגובה:</p>
                              <p className="text-[11px] text-foreground leading-relaxed">{meta.prefilled_text.slice(0, 200)}{meta.prefilled_text.length > 200 ? '...' : ''}</p>
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                            sig.impact_level === 'high' ? 'bg-red-50 text-red-600' :
                            sig.impact_level === 'medium' ? 'bg-amber-50 text-amber-600' :
                            'bg-green-50 text-green-600'
                          }`}>{sig.impact_level === 'high' ? 'השפעה גבוהה' : sig.impact_level === 'medium' ? 'השפעה בינונית' : 'השפעה נמוכה'}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── OSINT section ── */}
      {activeSection === 'osint' && (
        <div className="space-y-4">
          <div className="card-base fade-in-up">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold text-foreground text-[13px] flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary opacity-60" />
                תובנות OSINT מעמיקות
              </h3>
              <span className="text-[10px] text-foreground-muted">{osintAlerts.length} תובנות</span>
            </div>
            {osintAlerts.length === 0 ? (
              <div className="py-14 text-center">
                <ShieldCheck className="w-10 h-10 text-foreground-muted opacity-20 mx-auto mb-3" />
                <p className="text-[13px] text-foreground-muted mb-1">טרם נוצרו תובנות OSINT</p>
                <p className="text-[11px] text-foreground-muted opacity-50">לחץ "סרוק OSINT" לזהות חולשות מתחרים וצירוף לאירועים</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {osintAlerts.map(alert => {
                  let meta = {};
                  try { meta = JSON.parse(alert.source_agent || '{}'); } catch {}
                  return (
                    <div key={alert.id} className="px-5 py-4 hover:bg-secondary/30 transition-colors">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-[12px] font-semibold text-foreground">{alert.title}</span>
                            {meta.impact && (
                              <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-medium border ${
                                meta.impact === 'high' ? 'bg-red-50 text-red-600 border-red-100' :
                                meta.impact === 'medium' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                                'bg-green-50 text-green-600 border-green-100'
                              }`}>{meta.impact === 'high' ? 'גבוה' : meta.impact === 'medium' ? 'בינוני' : 'נמוך'}</span>
                            )}
                            {meta.relevant_event && (
                              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-blue-50 text-blue-600 border border-blue-100">
                                {meta.relevant_event}
                              </span>
                            )}
                          </div>
                          <p className="text-[12px] text-foreground-secondary leading-relaxed mb-2">{alert.description}</p>
                          {meta.action && (
                            <div className="flex items-start gap-2">
                              <Zap className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                              <p className="text-[11px] text-foreground font-medium">{meta.action}</p>
                            </div>
                          )}
                          {meta.prefilled_text && (
                            <div className="mt-2 bg-secondary rounded-lg px-3 py-2 border border-border">
                              <p className="text-[11px] text-foreground-muted leading-relaxed">{meta.prefilled_text.slice(0, 200)}{meta.prefilled_text.length > 200 ? '...' : ''}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── BATTLECARDS section ── */}
      {activeSection === 'battlecards' && (
        <div className="space-y-4">
          {competitors.length === 0 ? (
            <div className="card-base py-16 text-center">
              <FileText className="w-10 h-10 text-foreground-muted opacity-20 mx-auto mb-3" />
              <p className="text-[13px] text-foreground-muted">זהה מתחרים תחילה כדי ליצור Battlecards</p>
            </div>
          ) : (
            competitors.map(comp => (
              <div key={comp.id} className="card-base fade-in-up">
                <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary opacity-60" />
                    <h3 className="font-semibold text-foreground text-[13px]">{comp.name}</h3>
                    {comp.category && (
                      <span className="text-[10px] text-foreground-muted px-1.5 py-0.5 bg-secondary rounded-full border border-border">{comp.category}</span>
                    )}
                  </div>
                  {comp.rating && (
                    <span className="text-[11px] text-foreground-muted">⭐ {comp.rating}</span>
                  )}
                </div>
                <div className="p-5">
                  <BattlecardPanel competitor={comp} businessProfile={businessProfile} />
                </div>
              </div>
            ))
          )}
        </div>
      )}

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