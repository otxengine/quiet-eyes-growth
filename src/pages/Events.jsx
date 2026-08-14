import React, { useState, useMemo, useEffect } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, Zap, Sparkles, MoreVertical, Plus } from 'lucide-react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { Copy, CheckCheck, ListPlus, X, AlertCircle } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import StatCards from '@/components/shared/StatCards';
import AddEventPanel from '@/components/events/AddEventPanel';

// ── Sector Opportunity Banner ─────────────────────────────────────────────────
// Uses the AI deep_profile + agent_missions to surface a sector-specific
// opportunity note above the events list.

function SectorOpportunityBanner({ businessProfile }) {
  const dp = useMemo(() => {
    try { return JSON.parse(businessProfile?.business_deep_profile || '{}'); } catch { return {}; }
  }, [businessProfile?.business_deep_profile]);

  const missions = useMemo(() => {
    try { return JSON.parse(businessProfile?.agent_missions || '{}'); } catch { return {}; }
  }, [businessProfile?.agent_missions]);

  // Use sector-specific insights or seasonal focus from missions
  const insights = dp.sector_specific_insights || [];
  const seasonalFocus = missions.seasonal_focus_he || missions.weekly_focus_he;
  const services = dp.actual_services || [];

  if (!insights.length && !seasonalFocus && !services.length) return null;

  return (
    <div className="rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-100 p-4 flex items-start gap-3">
      <Sparkles className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-amber-700 mb-1">הזדמנות לפי הפרופיל שלך</p>
        {seasonalFocus && (
          <p className="text-[12px] text-amber-900 font-medium mb-1">{seasonalFocus}</p>
        )}
        {insights.length > 0 && (
          <p className="text-[11px] text-amber-800">{insights[0]}</p>
        )}
        {services.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {services.slice(0, 4).map((s, i) => (
              <span key={i} className="text-[9px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{s}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const EVENT_TABS = [
  { key: 'all',       label: 'כל האירועים' },
  { key: 'holiday',   label: 'חגים ומועדים' },
  { key: 'commercial',label: 'מסחרי' },
  { key: 'seasonal',  label: 'עונתי' },
  { key: 'sports',    label: 'ספורט' },
  { key: 'culture',   label: 'תרבות' },
  { key: 'local',     label: 'מקומי' },
];

function classifyEvent(title = '', description = '', tags = [], eventType = '') {
  if (eventType === 'tv_broadcast') return 'culture';
  if (eventType === 'weather_event') return 'seasonal';
  const text = `${title} ${description} ${tags.join(' ')}`.toLowerCase();
  if (['פסח', 'ראש השנה', 'סוכות', 'חנוכה', 'פורים', 'שבועות', 'יום כיפור', 'יום עצמאות', 'לג בעומר', 'holiday'].some(k => text.includes(k))) return 'holiday';
  if (['eid', 'עיד', 'רמדאן', 'christmas', 'כריסמס', 'חג המולד', 'easter', 'פסחא'].some(k => text.includes(k))) return 'holiday';
  if (['ליגת האלופות', 'גמר', 'כדורגל', 'כדורסל', 'champions', 'europa', 'world cup', 'מונדיאל', 'ספורט', 'יורו'].some(k => text.includes(k))) return 'sports';
  if (['בלאק פריידי', 'ולנטיין', 'כושר', 'דיאטה', 'black friday', 'valentine', 'יום האם', 'יום האב', 'ינואר'].some(k => text.includes(k))) return 'commercial';
  if (['קיץ', 'חורף', 'אביב', 'summer', 'winter', 'spring', 'עונת'].some(k => text.includes(k))) return 'seasonal';
  if (['מקומי', 'local', 'עיר', 'שכונה'].some(k => text.includes(k))) return 'local';
  if (['פינאלה', 'ריאליטי', 'ערוץ', 'פסטיבל', 'הופעה', 'מוזיקה', 'תרבות'].some(k => text.includes(k))) return 'culture';
  return 'other';
}

function getCountdown(input, isDate = false) {
  if (!input) return null;
  const hours = isDate
    ? Math.ceil((new Date(input).getTime() - Date.now()) / 3600000)
    : Number(input);
  if (isDate && hours > -24 && hours <= 24) return { text: 'היום!', urgent: true, weeks: null };
  if (hours <= 0) return null;
  const days = Math.ceil(hours / 24);
  if (days <= 3)  return { text: `${days} ימים`, urgent: true, weeks: null };
  if (days <= 14) return { text: `${days} ימים`, urgent: false, weeks: null };
  const weeks = Math.ceil(days / 7);
  return { text: `${weeks} שבועות`, urgent: false, weeks };
}

function formatEventDate(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });
  } catch { return null; }
}

function getEventMeta(item) {
  function safeParse(raw) {
    if (!raw) return {};
    try {
      let p = JSON.parse(raw);
      if (typeof p === 'string') p = JSON.parse(p);
      return (p && typeof p === 'object') ? p : {};
    } catch { return {}; }
  }
  const a = safeParse(item.source_agent);
  const b = safeParse(item.source_description);
  const meta = item._type === 'alert' ? { ...b, ...a } : { ...a, ...b };
  if (!meta.event_date && meta.days_away) {
    const base = new Date(item.created_date || item.detected_at || Date.now()).getTime();
    meta.event_date = new Date(base + Number(meta.days_away) * 86400000).toISOString().slice(0, 10);
  }
  if (!meta.event_date) {
    const text = item.description || item.summary || '';
    const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) meta.event_date = iso[0];
    else {
      const dmy = text.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
      if (dmy) meta.event_date = `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
    }
  }
  return meta;
}

// Action sheet modal
function EventActSheet({ item, businessProfile, onClose }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const meta = getEventMeta(item);
  const title = item._type === 'alert' ? item.title : (item.agent_name || item.summary);
  const description = item._type === 'alert' ? item.description : item.summary;
  const cleanTitle = (title || '').split(' — ')[0].replace(/^[^\u0590-\u05FFa-zA-Z0-9]*/, '').trim();

  // Enrich prefilled text with deep_profile brand keywords + USPs if available
  const deepProfile = useMemo(() => {
    try { return JSON.parse(businessProfile?.business_deep_profile || '{}'); } catch { return {}; }
  }, [businessProfile?.business_deep_profile]);
  const brandKeywords = deepProfile.brand_keywords?.slice(0, 2).join(', ') || '';
  const topUsp = deepProfile.unique_selling_points?.[0] || '';
  const businessSignature = [businessProfile?.name, brandKeywords].filter(Boolean).join(' | ');
  const prefilled = meta.prefilled_text || meta.prefilled ||
    `🎉 ${cleanTitle}\n\n${(description || '').slice(0, 120)}\n${topUsp ? `\n✨ ${topUsp}` : ''}\n\n${businessSignature}`;
  const eventDate = meta.event_date ? formatEventDate(meta.event_date) : null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-4" onClick={e => e.stopPropagation()} dir="rtl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-bold text-foreground">{cleanTitle}</h3>
            {eventDate && <p className="text-[11px] text-[#e8344d] font-medium mt-0.5">📅 {eventDate}</p>}
            <p className="text-[11px] text-foreground-muted mt-0.5 line-clamp-2">{description}</p>
          </div>
          <button onClick={onClose} className="text-foreground-muted hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 space-y-2">
          <p className="text-[10px] font-semibold text-foreground-muted">תוכן מותאם לאירוע</p>
          <p className="text-[12px] text-foreground leading-relaxed whitespace-pre-line line-clamp-4">{prefilled}</p>
          <button onClick={() => { navigator.clipboard.writeText(prefilled); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-[#e8344d]">
            {copied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'הועתק!' : 'העתק טקסט'}
          </button>
        </div>
        <div className="space-y-2">
          <button onClick={() => { navigate('/marketing/create'); onClose(); }}
            className="w-full py-2.5 rounded-xl bg-foreground text-background text-[12px] font-semibold hover:opacity-90">
            📢 צור קמפיין מראש
          </button>
          <button onClick={async () => {
            setCreatingTask(true);
            try {
              await base44.entities.Task.create({ title: `הכן תוכן לרגל: ${cleanTitle.slice(0, 60)}`, description: description || '', status: 'pending', priority: 'medium', source_type: 'alert', linked_business: businessProfile?.id || '' });
              toast.success('משימה נוצרה ✓');
              onClose();
            } catch { toast.error('שגיאה'); }
            setCreatingTask(false);
          }}
            disabled={creatingTask}
            className="w-full py-2 rounded-xl border border-gray-200 text-[11px] font-medium text-foreground hover:bg-gray-50 flex items-center justify-center gap-1.5 disabled:opacity-50">
            {creatingTask ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListPlus className="w-3.5 h-3.5" />}
            הוסף כמשימה
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Flat row event card matching the design
function EventCard({ item, businessProfile }) {
  const navigate = useNavigate();
  const [showSheet, setShowSheet] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const meta = getEventMeta(item);
  const title = item._type === 'alert' ? item.title : (item.agent_name || item.summary?.slice(0, 60) || '');
  const description = item._type === 'alert' ? item.description : item.summary;
  const cleanTitle = title.replace(/^[^\u0590-\u05FFa-zA-Z0-9]*/, '').split(' — ')[0].trim();
  const countdown = meta.event_date ? getCountdown(meta.event_date, true) : getCountdown(meta.urgency_hours);
  const eventDate = meta.event_date ? formatEventDate(meta.event_date) : null;

  // Split countdown text into value and unit for multi-line display
  const countdownParts = countdown?.text.split(' ') || [];
  const countdownNum  = countdownParts[0] || '';
  const countdownUnit = countdownParts[1] || '';

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3 hover:bg-gray-50/50 transition-colors" dir="rtl">

        {/* Countdown badge */}
        {countdown ? (
          <div className={`rounded-xl px-3 py-2 text-center flex-shrink-0 min-w-[68px] ${
            countdown.urgent ? 'bg-red-50 border border-red-200' : 'bg-blue-50 border border-blue-200'
          }`}>
            <div className={`text-[10px] font-medium ${countdown.urgent ? 'text-red-500' : 'text-blue-500'}`}>בעוד</div>
            <div className={`text-[16px] font-bold leading-none ${countdown.urgent ? 'text-red-600' : 'text-blue-700'}`}>{countdownNum}</div>
            {countdownUnit && <div className={`text-[10px] font-medium ${countdown.urgent ? 'text-red-500' : 'text-blue-500'}`}>{countdownUnit}</div>}
          </div>
        ) : (
          <div className="min-w-[68px] flex-shrink-0" />
        )}

        {/* Title + date */}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[13px] text-gray-900 truncate">{cleanTitle}</div>
          {eventDate && <div className="text-[11px] text-gray-500 mt-0.5">{eventDate}</div>}
          {description && !eventDate && (
            <div className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">{description}</div>
          )}
        </div>

        {/* CTA + menu */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowSheet(true)}
            className="text-[11px] font-semibold text-white bg-[#e8344d] px-3 py-1.5 rounded-full hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            פעל עכשיו
          </button>
          <div className="relative">
            <button onClick={() => setMenuOpen(v => !v)} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400">
              <MoreVertical className="w-4 h-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                <div className="absolute left-0 top-8 bg-white border border-gray-100 rounded-xl shadow-xl z-40 py-1 min-w-[140px]" dir="rtl">
                  <button onClick={() => { setShowSheet(true); setMenuOpen(false); }} className="flex items-center gap-2 w-full px-4 py-2 text-[12px] text-gray-700 hover:bg-gray-50">
                    <Zap className="w-3.5 h-3.5 text-gray-400" /> פעל עכשיו
                  </button>
                  <button onClick={() => { navigate('/marketing/create'); setMenuOpen(false); }} className="flex items-center gap-2 w-full px-4 py-2 text-[12px] text-gray-700 hover:bg-gray-50">
                    צור קמפיין
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {showSheet && (
        <EventActSheet item={item} businessProfile={businessProfile} onClose={() => setShowSheet(false)} />
      )}
    </>
  );
}


// ── Main page ──────────────────────────────────────────────────────────────────
export default function Events() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('all');
  const [scanning, setScanning]   = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [dismissedIds, setDismissedIds] = useState(new Set());
  const [autoScanned, setAutoScanned]   = useState(false);

  const POLL_INTERVAL = 20 * 60 * 1000;

  const { data: eventAlerts = [],       isLoading: la } = useQuery({ queryKey: ['eventAlerts',       bpId], queryFn: () => base44.entities.ProactiveAlert.filter({ linked_business: bpId, alert_type: 'market_opportunity', is_dismissed: false }, '-created_date', 50), enabled: !!bpId, refetchInterval: POLL_INTERVAL, staleTime: 10 * 60 * 1000 });
  const { data: eventSignals = [],      isLoading: ls } = useQuery({ queryKey: ['eventSignals',      bpId], queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId, category: 'event', is_dismissed: false }, '-detected_at', 50), enabled: !!bpId, refetchInterval: POLL_INTERVAL, staleTime: 10 * 60 * 1000 });
  const { data: localEventSignals = [], isLoading: ll } = useQuery({ queryKey: ['localEventSignals', bpId], queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId, category: 'local_event', is_dismissed: false }, '-detected_at', 30), enabled: !!bpId, refetchInterval: POLL_INTERVAL, staleTime: 10 * 60 * 1000 });
  const { data: weatherSignals = [],    isLoading: lw } = useQuery({ queryKey: ['weatherSignals',    bpId], queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId, category: 'weather_event', is_dismissed: false }, '-detected_at', 10), enabled: !!bpId, refetchInterval: POLL_INTERVAL, staleTime: 10 * 60 * 1000 });

  const isLoading = la || ls || ll || lw;
  const totalEvents = eventAlerts.length + eventSignals.length + localEventSignals.length;

  useEffect(() => {
    if (!bpId || isLoading || autoScanned || totalEvents > 0) return;
    setAutoScanned(true);
    Promise.allSettled([
      base44.functions.invoke('detectEvents',    { businessProfileId: bpId }),
      base44.functions.invoke('findLocalEvents', { businessProfileId: bpId }),
    ]).then(() => {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['eventAlerts',       bpId] });
        queryClient.invalidateQueries({ queryKey: ['eventSignals',      bpId] });
        queryClient.invalidateQueries({ queryKey: ['localEventSignals', bpId] });
        queryClient.invalidateQueries({ queryKey: ['weatherSignals',    bpId] });
      }, 3000);
    });
  }, [bpId, isLoading, autoScanned, totalEvents, queryClient]);

  function extractEventDate(item) {
    try {
      const meta = getEventMeta(item);
      if (meta.event_date) return new Date(meta.event_date).getTime();
      if (meta.urgency_hours) return Date.now() + Number(meta.urgency_hours) * 3600000;
    } catch {}
    return Date.now() + 365 * 86400000;
  }

  function normalizeTitle(item) {
    const raw = item._type === 'alert' ? (item.title || '') : (item.agent_name || item.summary || '');
    return raw.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}]\s*/u, '').split(' — ')[0].trim().toLowerCase();
  }

  const rawItems = [
    ...eventAlerts.map(a => ({ ...a, _type: 'alert' })),
    ...eventSignals.map(s => ({ ...s, _type: 'signal' })),
    ...localEventSignals.map(s => ({ ...s, _type: 'signal', _isLocal: true })),
    ...weatherSignals.map(s => ({ ...s, _type: 'signal', _isLocal: true })),
  ].filter(item => {
    if (item.is_dismissed || dismissedIds.has(item.id)) return false;
    const ts = extractEventDate(item);
    return ts > Date.now() - 86400000;
  });

  // Dedup by title
  const seen = new Map();
  rawItems.forEach(item => {
    const key = normalizeTitle(item);
    if (!key) return;
    const ts = new Date(item.created_date || item.detected_at || 0).getTime();
    const prev = seen.get(key);
    if (!prev || ts > prev.ts) seen.set(key, { item, ts });
  });

  const allItems = Array.from(seen.values()).map(v => v.item).sort((a, b) => extractEventDate(a) - extractEventDate(b));

  const categoryMap = useMemo(() => {
    const map = new Map();
    allItems.forEach(item => {
      const title = item._type === 'alert' ? item.title : (item.agent_name || '');
      const desc  = item._type === 'alert' ? item.description : item.summary;
      let evType  = '';
      try { evType = JSON.parse(item.source_description || '{}').event_type || ''; } catch {}
      map.set(item.id, classifyEvent(title, desc, item.tags || [], evType));
    });
    return map;
  }, [allItems]);

  const getCategory = (item) => categoryMap.get(item.id) || 'other';

  const filteredItems = activeTab === 'all' ? allItems : allItems.filter(item => getCategory(item) === activeTab);

  const thisWeek = Date.now() + 7 * 86400000;
  const weekItems = allItems.filter(item => extractEventDate(item) < thisWeek);
  const urgentItems = allItems.filter(item => {
    const meta = getEventMeta(item);
    const cd = meta.event_date ? getCountdown(meta.event_date, true) : null;
    return cd?.urgent;
  });

  const statCards = [
    { count: allItems.length,    label: 'אירועים קרובים',     borderColor: 'blue' },
    { count: weekItems.length,   label: 'השבוע הקרוב',        borderColor: 'red' },
    { count: urgentItems.length, label: 'דורשים פעולה',       borderColor: 'yellow' },
    { count: allItems.filter(i => getCategory(i) === 'commercial').length, label: 'הזדמניות קמפיין', borderColor: 'none' },
  ];

  const handleScan = async () => {
    setScanning(true);
    toast.info('סורק אירועים...');
    try {
      await Promise.allSettled([
        base44.functions.invoke('detectEvents',    { businessProfileId: bpId }),
        base44.functions.invoke('findLocalEvents', { businessProfileId: bpId }),
      ]);
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['eventAlerts',       bpId] });
        queryClient.invalidateQueries({ queryKey: ['eventSignals',      bpId] });
        queryClient.invalidateQueries({ queryKey: ['localEventSignals', bpId] });
        queryClient.invalidateQueries({ queryKey: ['weatherSignals',    bpId] });
      }, 2000);
      toast.success('סריקת אירועים הושלמה');
    } catch { toast.error('שגיאה בסריקת אירועים'); }
    setScanning(false);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        count={allItems.length}
        title="אירועים"
        actionLabel={scanning ? 'סורק...' : 'סרוק אירועים'}
        actionIcon={scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        onAction={handleScan}
        secondaryLabel="הוסף אירוע"
        secondaryIcon={<Plus className="w-4 h-4" />}
        onSecondaryAction={() => setShowAddPanel(v => !v)}
      />

      <StatCards cards={statCards} />

      <SectorOpportunityBanner businessProfile={businessProfile} />

      {showAddPanel && (
        <AddEventPanel
          bpId={bpId}
          onClose={() => setShowAddPanel(false)}
          onAdded={() => setShowAddPanel(false)}
        />
      )}

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl overflow-x-auto" dir="rtl">
        {EVENT_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
              activeTab === tab.key
                ? 'bg-[#e8344d] text-white shadow-sm'
                : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-foreground-muted">
          <div className="text-4xl mb-3">📅</div>
          <div className="text-sm font-medium">אין אירועים בקטגוריה זו</div>
          <div className="text-xs mt-1">לחץ "סרוק אירועים" לעדכון</div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => (
            <EventCard key={item.id} item={item} businessProfile={businessProfile} />
          ))}
        </div>
      )}
    </div>
  );
}
