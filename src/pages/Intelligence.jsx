import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { trackUxEvent } from '@/lib/trackUxEvent';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Eye, TrendingUp, AlertTriangle, Sparkles, MessageSquare, Users, FileText, Calendar, Archive, ChevronDown } from 'lucide-react';
import SignalCard from '@/components/intelligence/SignalCard';
import AiInsightBox from '@/components/ai/AiInsightBox';
import WeeklyReportsTab from '@/components/intelligence/WeeklyReportsTab';
import ScanOverlay from '@/components/dashboard/ScanOverlay';
import PlanGate from '@/components/subscription/PlanGate';
import { usePlan } from '@/lib/usePlan';
import { getLimits } from '@/lib/planConfig';

const tabs = [
  { key: 'all', label: 'הכל' },
  { key: 'threat', label: 'איומים' },
  { key: 'opportunity', label: 'הזדמנויות' },
  { key: 'trend', label: 'מגמות' },
  { key: 'mention', label: 'אזכורים' },
  { key: 'event', label: 'אירועים' },
  { key: 'competitor_intel', label: 'מודיעין תחרותי' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'reports', label: 'דוחות' },
];

const intelligenceScanSteps = [
  { key: 'collect',      label: 'אוסף אותות מהאינטרנט...',     fn: 'collectWebSignals',    resultKey: 'new_signals_saved' },
  { key: 'social',       label: 'סורק רשתות חברתיות...',        fn: 'collectSocialSignals', resultKey: 'signals_saved' },
  { key: 'analyze',      label: 'מנתח מודיעין שוק...',          fn: 'synthesizeMarketInsights', resultKey: 'insights_generated' },
  { key: 'trends',       label: 'מגלה מגמות עולות...',          fn: 'detectTrends',         resultKey: 'trends_detected' },
  { key: 'early_trends', label: 'מגלה טרנדים מוקדמים...',       fn: 'detectEarlyTrends',    resultKey: 'trends_created' },
  { key: 'viral',        label: 'סורק סיגנלים ויראלים...',      fn: 'detectViralSignals',   resultKey: 'signals_created' },
  { key: 'tiktok_trends', label: 'מנתח טרנדים TikTok...',         fn: 'tiktokSectorTrendAgent', resultKey: 'trends_created', force: true },
  { key: 'tiktok_audience', label: 'ממפה קהל יעד TikTok...',      fn: 'tiktokAudienceAgent',  resultKey: 'signals_created', force: true },
  { key: 'tiktok_performance', label: 'מנתח ביצועי פוסטים TikTok...', fn: 'tiktokPostTracker', resultKey: 'tracked', force: true },
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

export default function Intelligence() {
  const { businessProfile } = useOutletContext();
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
  const tiktokSignals = allSignals.filter(s => s.category === 'tiktok_sector_trend' || s.category === 'tiktok_audience' || s.category === 'tiktok_post_performance');
  const tiktokPerfSignals = tiktokSignals.filter(s => s.category === 'tiktok_post_performance');
  const tiktokTrendSignals = tiktokSignals.filter(s => s.category !== 'tiktok_post_performance');
  const filtered = activeTab === 'all' ? allSignals
    : activeTab === 'reports' ? []
    : activeTab === 'tiktok' ? tiktokSignals
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
    { label: 'TikTok', value: tiktokSignals.length, icon: TrendingUp, color: 'text-[#ff0050]' },
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
        <h1 className="text-[16px] font-bold text-foreground tracking-tight">מודיעין שוק</h1>
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
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-[12px] font-medium transition-all duration-150 relative ${
              activeTab === tab.key ? 'text-foreground' : 'text-foreground-muted hover:text-foreground-secondary'
            }`}>
            {tab.label}
            {!['all', 'reports'].includes(tab.key) && (() => {
              const countMap = { threat: threats.length, opportunity: opportunities.length, trend: canGrowth ? trends.length : trendCountForTeaser, competitor_intel: competitorMoves.length, mention: mentions.length, event: eventSignals.length, tiktok: tiktokSignals.length };
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
      ) : activeTab === 'tiktok' ? (
        <div className="space-y-4">
          {/* ── Post performance — own posts vs competitor benchmark ── */}
          <div className="card-base fade-in-up">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold text-foreground text-[13px]">ביצועי הפוסטים שלי</h3>
              <span className="text-[10px] text-foreground-muted">{tiktokPerfSignals.length} תובנות</span>
            </div>
            {tiktokPerfSignals.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-[12px] text-foreground-muted">אין נתוני ביצועים עדיין — הסוכן פועל לאחר פרסום פוסטים</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {tiktokPerfSignals.map((signal) => (
                  <SignalCard key={signal.id} signal={signal} businessProfile={businessProfile} />
                ))}
              </div>
            )}
          </div>
          {/* ── Sector trends + audience mapping ── */}
          <div className="card-base fade-in-up">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold text-foreground text-[13px]">טרנדים בסקטור וקהל יעד</h3>
              <span className="text-[10px] text-foreground-muted">{tiktokTrendSignals.length} תובנות</span>
            </div>
            {tiktokTrendSignals.length === 0 ? (
              <div className="py-10 text-center">
                <Eye className="w-12 h-12 text-foreground-muted opacity-20 mx-auto mb-3" />
                <p className="text-[13px] text-foreground-muted mb-1">העיניים סורקות את השוק — תובנות חדשות יופיעו בקרוב</p>
                <p className="text-[11px] text-foreground-muted opacity-50">הסריקה הראשונה לוקחת עד שעה</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {tiktokTrendSignals.map((signal) => (
                  <SignalCard key={signal.id} signal={signal} businessProfile={businessProfile} />
                ))}
              </div>
            )}
          </div>
        </div>
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