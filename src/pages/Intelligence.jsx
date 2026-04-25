import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Eye, TrendingUp, AlertTriangle, Sparkles, MessageSquare, Users, FileText, Calendar } from 'lucide-react';
import SignalCard from '@/components/intelligence/SignalCard';
import AiInsightBox from '@/components/ai/AiInsightBox';
import WeeklyReportsTab from '@/components/intelligence/WeeklyReportsTab';
import ScanOverlay from '@/components/dashboard/ScanOverlay';

const tabs = [
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
  { key: 'analyze',      label: 'מנתח מודיעין שוק...',          fn: 'runMarketIntelligence', resultKey: 'insights_generated' },
  { key: 'trends',       label: 'מגלה מגמות עולות...',          fn: 'detectTrends',         resultKey: 'trends_detected' },
  { key: 'early_trends', label: 'מגלה טרנדים מוקדמים...',       fn: 'detectEarlyTrends',    resultKey: 'trends_created' },
  { key: 'viral',        label: 'סורק סיגנלים ויראלים...',      fn: 'detectViralSignals',   resultKey: 'signals_created' },
];

export default function Intelligence() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('all');
  const [showScan, setShowScan] = useState(false);

  const { data: allSignals = [] } = useQuery({
    queryKey: ['intelligenceSignals', bpId],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId }, '-detected_at', 100),
    enabled: !!bpId
  });

  // Fetch raw signals for trend stats
  const { data: rawSignals = [] } = useQuery({
    queryKey: ['rawSignalStats', bpId],
    queryFn: () => base44.entities.RawSignal.filter({ linked_business: bpId }, '-detected_at', 50),
    enabled: !!bpId
  });

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const weekSignals = allSignals.filter(s => (s.detected_at || s.created_date) >= weekAgo);
  const threats = weekSignals.filter(s => s.category === 'threat');
  const opportunities = weekSignals.filter(s => s.category === 'opportunity');
  const trends = weekSignals.filter(s => s.category === 'trend');
  const competitorMoves = weekSignals.filter(s => s.category === 'competitor_move' || s.category === 'competitor');
  const eventSignals = allSignals.filter(s => s.category === 'event');

  // Raw signal stats
  const trendSignals = rawSignals.filter(s => s.signal_type === 'social_trend');
  const socialMentions = rawSignals.filter(s => s.signal_type === 'social_mention' || s.signal_type === 'social_review');
  const competitorSocial = rawSignals.filter(s => s.signal_type === 'competitor_social');

  const mentions = weekSignals.filter(s => s.category === 'mention');
  const filtered = activeTab === 'all' ? allSignals
    : activeTab === 'reports' ? []
    : activeTab === 'competitor_intel' ? allSignals.filter(s => s.category === 'competitor_move' || s.category === 'competitor')
    : allSignals.filter(s => s.category === activeTab);

  useEffect(() => {
    window.__quieteyes_scan = () => setShowScan(true);
    return () => { delete window.__quieteyes_scan; };
  }, []);

  const statCards = [
    { label: 'תובנות השבוע', value: weekSignals.length, icon: Sparkles, color: 'text-primary' },
    { label: 'מגמות עולות', value: trends.length, icon: TrendingUp, color: 'text-[#10b981]', sub: `${trendSignals.length} אותות` },
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
              const countMap = { threat: threats.length, opportunity: opportunities.length, trend: trends.length, competitor_intel: competitorMoves.length, mention: mentions.length, event: eventSignals.length };
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

      {activeTab === 'reports' ? (
        <WeeklyReportsTab bpId={bpId} />
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
              {filtered.map((signal) => (
                <SignalCard key={signal.id} signal={signal} businessProfile={businessProfile} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}