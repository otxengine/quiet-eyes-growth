import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Calendar, Loader2, Zap, Clock, TrendingUp } from 'lucide-react';
import ActionPopup from '@/components/ui/ActionPopup';
import { toast } from 'sonner';

const EVENT_TABS = [
  { key: 'all',        label: 'הכל' },
  { key: 'holiday',    label: 'חגים' },
  { key: 'sports',     label: 'ספורט' },
  { key: 'seasonal',   label: 'עונתי' },
  { key: 'commercial', label: 'מסחרי' },
];

const HOLIDAY_KEYWORDS  = ['פסח', 'ראש השנה', 'סוכות', 'חנוכה', 'פורים', 'שבועות', 'יום כיפור', 'עצמאות', 'holiday', 'jewish'];
const SPORTS_KEYWORDS   = ['ליגת האלופות', 'גמר', 'ספורט', 'כדורגל', 'כדורסל', 'champions', 'europa', 'world cup', 'מונדיאל', 'ליגה', 'אצטדיון'];
const SEASONAL_KEYWORDS = ['קיץ', 'חורף', 'אביב', 'סתיו', 'חזרה ללימודים', 'חתונה', 'עונה', 'summer', 'winter', 'spring', 'renovation'];
const COMMERCIAL_KEYWORDS = ['בלאק פריידי', 'ולנטיין', 'ינואר', 'כושר', 'דיאטה', 'החלטות', 'black friday', 'valentine', 'commercial'];

function classifyEvent(title = '', description = '', tags = []) {
  const text = `${title} ${description} ${tags.join(' ')}`.toLowerCase();
  if (SPORTS_KEYWORDS.some(k => text.includes(k.toLowerCase()))) return 'sports';
  if (HOLIDAY_KEYWORDS.some(k => text.includes(k.toLowerCase()))) return 'holiday';
  if (SEASONAL_KEYWORDS.some(k => text.includes(k.toLowerCase()))) return 'seasonal';
  if (COMMERCIAL_KEYWORDS.some(k => text.includes(k.toLowerCase()))) return 'commercial';
  return 'other';
}

function getCountdownText(urgencyHours) {
  if (!urgencyHours) return null;
  const hours = Number(urgencyHours);
  if (hours <= 24) return { text: `${hours} שעות`, urgent: true };
  const days = Math.ceil(hours / 24);
  if (days <= 3) return { text: `${days} ימים`, urgent: true };
  if (days <= 14) return { text: `${days} ימים`, urgent: false };
  return { text: `${Math.ceil(days / 7)} שבועות`, urgent: false };
}

function EventCard({ item, businessProfile, type }) {
  const [popup, setPopup] = useState(false);
  const title = type === 'alert' ? item.title : item.agent_name || item.summary?.slice(0, 60);
  const description = type === 'alert' ? item.description : item.summary;
  const tags = item.tags || [];

  let meta = {};
  try { meta = JSON.parse(type === 'alert' ? (item.source_agent || '{}') : (item.source_description || '{}')); } catch {}

  const countdown = getCountdownText(meta.urgency_hours);
  const category = classifyEvent(title, description, tags);

  const categoryIcons = {
    sports:     '⚽',
    holiday:    '🕍',
    seasonal:   '🌿',
    commercial: '🛍️',
    other:      '📅',
  };

  // Build a fake signal for ActionPopup compatibility
  const fakeSignal = {
    id: item.id,
    summary: description,
    agent_name: title,
    category: 'event',
    source_description: type === 'alert' ? item.source_agent : item.source_description,
    impact_level: meta.impact || 'medium',
  };

  return (
    <div className={`card-base p-4 fade-in-up border-r-4 ${countdown?.urgent ? 'border-r-red-400 bg-red-50/30' : 'border-r-blue-300'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-base">{categoryIcons[category]}</span>
            <span className="text-[13px] font-semibold text-foreground leading-snug">{title}</span>
            {countdown && (
              <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                countdown.urgent
                  ? 'bg-red-50 text-red-600 border-red-200'
                  : 'bg-blue-50 text-blue-600 border-blue-200'
              }`}>
                <Clock className="w-3 h-3" />
                בעוד {countdown.text}
              </span>
            )}
          </div>
          <p className="text-[12px] text-foreground-secondary leading-relaxed mb-2 line-clamp-3">{description}</p>
          {meta.action_label && (
            <div className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
              <TrendingUp className="w-3.5 h-3.5 text-primary opacity-60" />
              <span>{meta.action_label}</span>
              {meta.time_minutes && <span className="opacity-60">· {meta.time_minutes} דקות</span>}
            </div>
          )}
        </div>
        <button
          onClick={() => setPopup(true)}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium bg-foreground text-background hover:opacity-90 transition-all"
        >
          <Zap className="w-3.5 h-3.5" />
          פעל עכשיו
        </button>
      </div>

      {popup && (
        <ActionPopup
          signal={fakeSignal}
          businessProfile={businessProfile}
          onClose={() => setPopup(false)}
        />
      )}
    </div>
  );
}

export default function Events() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('all');
  const [scanning, setScanning] = useState(false);

  const { data: eventAlerts = [], isLoading: loadingAlerts } = useQuery({
    queryKey: ['eventAlerts', bpId],
    queryFn: () => base44.entities.ProactiveAlert.filter({ linked_business: bpId, alert_type: 'market_opportunity' }, '-created_date', 50),
    enabled: !!bpId,
  });

  const { data: eventSignals = [], isLoading: loadingSignals } = useQuery({
    queryKey: ['eventSignals', bpId],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId, category: 'event' }, '-detected_at', 50),
    enabled: !!bpId,
  });

  const isLoading = loadingAlerts || loadingSignals;

  // Extract event date for chronological sorting
  function extractEventDate(item) {
    const text = item._type === 'alert' ? (item.description || '') : (item.summary || '');
    const m = text.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])).getTime();
    try {
      const meta = JSON.parse(item._type === 'alert' ? (item.source_agent || '{}') : (item.source_description || '{}'));
      if (meta.urgency_hours) return Date.now() + Number(meta.urgency_hours) * 3600000;
    } catch {}
    return new Date(item.created_date || item.detected_at || 0).getTime();
  }

  // Merge alerts + signals, sort chronologically (closest event first)
  const allItems = [
    ...eventAlerts.map(a => ({ ...a, _type: 'alert' })),
    ...eventSignals.map(s => ({ ...s, _type: 'signal' })),
  ].sort((a, b) => extractEventDate(a) - extractEventDate(b));

  const filtered = activeTab === 'all'
    ? allItems
    : allItems.filter(item => {
        const title = item._type === 'alert' ? item.title : (item.agent_name || '');
        const desc = item._type === 'alert' ? item.description : item.summary;
        return classifyEvent(title, desc, item.tags || []) === activeTab;
      });

  const countByTab = {
    holiday:    allItems.filter(i => classifyEvent(i._type === 'alert' ? i.title : i.agent_name, i._type === 'alert' ? i.description : i.summary, i.tags || []) === 'holiday').length,
    sports:     allItems.filter(i => classifyEvent(i._type === 'alert' ? i.title : i.agent_name, i._type === 'alert' ? i.description : i.summary, i.tags || []) === 'sports').length,
    seasonal:   allItems.filter(i => classifyEvent(i._type === 'alert' ? i.title : i.agent_name, i._type === 'alert' ? i.description : i.summary, i.tags || []) === 'seasonal').length,
    commercial: allItems.filter(i => classifyEvent(i._type === 'alert' ? i.title : i.agent_name, i._type === 'alert' ? i.description : i.summary, i.tags || []) === 'commercial').length,
  };

  const handleScan = async () => {
    setScanning(true);
    toast.info('סורק אירועים קרובים...');
    try {
      const res = await base44.functions.invoke('detectEvents', { businessProfileId: bpId });
      const found = res?.data?.signals_created ?? 0;
      queryClient.invalidateQueries({ queryKey: ['eventAlerts', bpId] });
      queryClient.invalidateQueries({ queryKey: ['eventSignals', bpId] });
      toast.success(found > 0 ? `נמצאו ${found} אירועים רלוונטיים ✓` : 'הסריקה הושלמה — בדוק שוב בעוד מספר שניות');
    } catch {
      toast.error('שגיאה בסריקת אירועים');
    }
    setScanning(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[16px] font-bold text-foreground tracking-tight">אירועים והזדמנויות</h1>
          <p className="text-[12px] text-foreground-muted mt-0.5">
            חגים, אירועי ספורט, עונות מסחריות — הזדמנויות צמיחה לעסק שלך
          </p>
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium bg-foreground text-background hover:opacity-90 transition-all disabled:opacity-50"
        >
          {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
          {scanning ? 'סורק...' : 'סרוק אירועים ←'}
        </button>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'סה"כ אירועים', value: allItems.length, color: 'text-primary' },
          { label: 'חגים',         value: countByTab.holiday,    color: 'text-purple-500' },
          { label: 'ספורט',        value: countByTab.sports,     color: 'text-green-600' },
          { label: 'מסחרי/עונתי', value: countByTab.commercial + countByTab.seasonal, color: 'text-amber-500' },
        ].map(card => (
          <div key={card.label} className="card-base p-4 fade-in-up">
            <p className="text-[10px] font-medium text-foreground-muted mb-1">{card.label}</p>
            <span className={`text-[24px] font-bold tracking-tight ${card.color}`}>{card.value}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-border">
        {EVENT_TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-[12px] font-medium transition-all duration-150 relative ${
              activeTab === tab.key ? 'text-foreground' : 'text-foreground-muted hover:text-foreground-secondary'
            }`}>
            {tab.label}
            {tab.key !== 'all' && countByTab[tab.key] > 0 && (
              <span className="mr-1 text-[9px] font-bold text-foreground-muted">({countByTab[tab.key]})</span>
            )}
            {activeTab === tab.key && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-t" />}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-foreground-muted" />
          <span className="text-[13px] text-foreground-muted">טוען אירועים...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-base py-20 text-center fade-in-up">
          <Calendar className="w-12 h-12 text-foreground-muted opacity-20 mx-auto mb-3" />
          <p className="text-[13px] text-foreground-muted mb-1">
            {activeTab === 'all' ? 'טרם זוהו אירועים רלוונטיים לעסק שלך' : `אין אירועים בקטגוריית "${EVENT_TABS.find(t=>t.key===activeTab)?.label}"`}
          </p>
          <p className="text-[11px] text-foreground-muted opacity-50">לחץ "סרוק אירועים" לזהות הזדמנויות קרובות</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(item => (
            <EventCard
              key={`${item._type}-${item.id}`}
              item={item}
              type={item._type}
              businessProfile={businessProfile}
            />
          ))}
        </div>
      )}
    </div>
  );
}
