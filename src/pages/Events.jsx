import React, { useState, useMemo, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Calendar, Loader2, Zap, Clock, TrendingUp, X, Copy, CheckCheck, ListPlus, Megaphone, AlertCircle } from 'lucide-react';
import { createPortal } from 'react-dom';
import AiInsightsBar from '@/components/ai/AiInsightsBar';
import EventDetailModal from '@/components/events/EventDetailModal';
import DismissMenu from '@/components/ui/DismissMenu';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

const EVENT_TABS = [
  { key: 'all',          label: 'הכל' },
  { key: 'holiday',      label: 'חגים יהודיים' },
  { key: 'religion',     label: 'דתות אחרות' },
  { key: 'sports',       label: 'ספורט' },
  { key: 'tv_broadcast', label: 'טלוויזיה' },
  { key: 'seasonal',     label: 'עונתי' },
  { key: 'commercial',   label: 'מסחרי' },
  { key: 'local',        label: 'מקומי' },
  { key: 'weather',      label: 'מזג אוויר' },
];

function classifyEvent(title = '', description = '', tags = [], eventType = '') {
  if (eventType === 'tv_broadcast') return 'tv_broadcast';
  if (eventType === 'weather_event') return 'weather';
  const text = `${title} ${description} ${tags.join(' ')}`.toLowerCase();
  if (['גל חום', 'סערה', 'שיטפון', 'heatwave', 'extreme weather', 'weather_event'].some(k => text.includes(k))) return 'weather';
  if (['פינאלה', 'ריאליטי', 'x-factor', 'האח הגדול', 'מאסטרשף', 'ערוץ', 'שידור חי', 'tv_broadcast'].some(k => text.includes(k))) return 'tv_broadcast';
  if (['eid', 'עיד', 'רמדאן', 'ramadan', 'christmas', 'כריסמס', 'חג המולד', 'easter', 'פסחא', 'מולד'].some(k => text.includes(k))) return 'religion';
  if (['ליגת האלופות', 'גמר', 'כדורגל', 'כדורסל', 'champions', 'europa', 'world cup', 'מונדיאל', 'ספורט', 'יורו', 'נבחרת'].some(k => text.includes(k))) return 'sports';
  if (['פסח', 'ראש השנה', 'סוכות', 'חנוכה', 'פורים', 'שבועות', 'יום כיפור', 'יום עצמאות', 'לג בעומר', 'holiday', 'jewish', 'yom_kippur'].some(k => text.includes(k))) return 'holiday';
  if (['קיץ', 'חורף', 'אביב', 'חתונה', 'שיפוץ', 'summer', 'winter', 'spring', 'renovation', 'wedding', 'עונת'].some(k => text.includes(k))) return 'seasonal';
  if (['בלאק פריידי', 'ולנטיין', 'כושר', 'דיאטה', 'black friday', 'valentine', 'commercial', 'יום האם', 'יום האב', 'ינואר'].some(k => text.includes(k))) return 'commercial';
  return 'other';
}

function getCountdown(input, isDate = false) {
  if (!input) return null;
  const hours = isDate
    ? Math.ceil((new Date(input).getTime() - Date.now()) / 3600000)
    : Number(input);
  if (hours <= 0) return null;
  if (hours <= 24) return { text: `${hours} שעות`, urgent: true };
  const days = Math.ceil(hours / 24);
  if (days <= 3) return { text: `${days} ימים`, urgent: true };
  if (days <= 14) return { text: `${days} ימים`, urgent: false };
  return { text: `${Math.ceil(days / 7)} שבועות`, urgent: false };
}

function formatEventDate(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return null;
  }
}

function getEventMeta(item) {
  try {
    return JSON.parse(
      item._type === 'alert' ? (item.source_agent || '{}') : (item.source_description || '{}')
    );
  } catch {
    return {};
  }
}

// ── Action sheet — פעל עכשיו ───────────────────────────────────────────────────
function EventActSheet({ item, type, businessProfile, onClose }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);

  const meta = getEventMeta(item);
  const actionType = meta.action_type || 'social_post';

  const title = type === 'alert' ? item.title : (item.agent_name || item.summary);
  const description = type === 'alert' ? item.description : item.summary;
  const cleanTitle = (title || '').split(' — ')[0].replace(/^[^\u0590-\u05FFa-zA-Z0-9]*/, '').trim();
  const prefilled = meta.prefilled_text || meta.prefilled || `🎉 ${cleanTitle}\n\n${(description || '').slice(0, 120)}\n\n${businessProfile?.name || ''}`;
  const eventDate = meta.event_date ? formatEventDate(meta.event_date) : null;

  const handleCopy = () => {
    navigator.clipboard.writeText(prefilled).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleCreateTask = async () => {
    setCreatingTask(true);
    try {
      await base44.entities.Task.create({
        title: `הכן תוכן לרגל: ${cleanTitle.slice(0, 60)}`,
        description: description || '',
        status: 'pending',
        priority: 'medium',
        source_type: 'alert',
        linked_business: businessProfile?.id || '',
      });
      toast.success('משימה נוצרה ✓');
      onClose();
    } catch {
      toast.error('שגיאה ביצירת המשימה');
    }
    setCreatingTask(false);
  };

  const handlePrimaryAction = () => {
    if (actionType === 'create_campaign') {
      const params = new URLSearchParams({ type: 'seasonal', event: cleanTitle, summary: (description || '').slice(0, 120) });
      navigate(`/marketing/create?${params.toString()}`);
    } else if (actionType === 'create_offer') {
      const params = new URLSearchParams({ type: 'offer', event: cleanTitle, summary: (description || '').slice(0, 120) });
      navigate(`/marketing/create?${params.toString()}`);
    } else {
      const params = new URLSearchParams({ create: 'organic', summary: prefilled });
      navigate(`/marketing?${params.toString()}`);
    }
    onClose();
  };

  const primaryLabel = {
    create_campaign: '📢 צור קמפיין מראש',
    create_offer:    '🎁 בנה מבצע מיוחד',
    social_post:     '📣 פרסם פוסט ממוקד',
  }[actionType] || '📣 פרסם פוסט ממוקד';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-4"
        onClick={e => e.stopPropagation()}
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-bold text-foreground leading-snug">{cleanTitle}</h3>
            {eventDate && <p className="text-[11px] text-primary font-medium mt-0.5">📅 {eventDate}</p>}
            <p className="text-[11px] text-foreground-muted mt-0.5 line-clamp-2">{description}</p>
          </div>
          <button onClick={onClose} className="text-foreground-muted hover:text-foreground p-1 -mt-1 -mr-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action window hint */}
        {meta.action_window_days && (
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
            <p className="text-[11px] text-amber-700">
              מומלץ להתחיל {meta.action_window_days} ימים לפני האירוע
            </p>
          </div>
        )}

        {/* Post preview */}
        <div className="bg-secondary rounded-xl p-3 space-y-2">
          <p className="text-[10px] font-semibold text-foreground-muted">תוכן מותאם לאירוע</p>
          <p className="text-[12px] text-foreground leading-relaxed whitespace-pre-line line-clamp-4">{prefilled}</p>
          <button onClick={handleCopy} className="flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:opacity-70 transition-all">
            {copied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'הועתק!' : 'העתק טקסט'}
          </button>
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <button
            onClick={handlePrimaryAction}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-foreground text-background text-[12px] font-semibold hover:opacity-90 transition-all"
          >
            {primaryLabel}
          </button>
          <button
            onClick={handleCreateTask}
            disabled={creatingTask}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-border text-[11px] font-medium text-foreground hover:bg-secondary transition-all disabled:opacity-50"
          >
            {creatingTask ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListPlus className="w-3.5 h-3.5" />}
            הוסף כמשימה
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Event card ─────────────────────────────────────────────────────────────────
function EventCard({ item, businessProfile, type, onCardClick, onDismissed }) {
  const [popup, setPopup] = useState(false);
  const meta = getEventMeta(item);

  const title       = type === 'alert' ? item.title : (item.agent_name || item.summary?.slice(0, 60));
  const description = type === 'alert' ? item.description : item.summary;

  let evType = '';
  try { evType = JSON.parse(item.source_description || '{}').event_type || ''; } catch {}
  const category = classifyEvent(title, description, item.tags || [], evType);

  const countdown = meta.event_date
    ? getCountdown(meta.event_date, true)
    : getCountdown(meta.urgency_hours);

  const eventDate = meta.event_date ? formatEventDate(meta.event_date) : null;

  const categoryIcons = {
    sports: '⚽', holiday: '✡️', religion: '🕌', seasonal: '🌿',
    commercial: '🛍️', tv_broadcast: '📺', weather: '🌡️', local: '📍', other: '📅',
  };

  const actionType  = meta.action_type || 'social_post';
  const actionBadge = { create_campaign: 'קמפיין', create_offer: 'מבצע', social_post: 'פוסט' }[actionType] || 'פוסט';

  return (
    <div
      className={`card-base p-4 fade-in-up border-r-4 cursor-pointer ${countdown?.urgent ? 'border-r-red-400 bg-red-50/30' : 'border-r-blue-300'}`}
      onClick={() => onCardClick && onCardClick(item, type)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">

          {/* Title */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-base">{categoryIcons[category] || '📅'}</span>
            <span className="text-[13px] font-semibold text-foreground leading-snug">{title}</span>
            {type !== 'static' && onDismissed && businessProfile?.id && (
              <div onClick={e => e.stopPropagation()}>
                <DismissMenu
                  entityType={type === 'alert' ? 'alert' : 'signal'}
                  entityId={item.id}
                  title={title}
                  businessProfileId={businessProfile.id}
                  onDismissed={() => onDismissed(item)}
                  buttonLabel="לא רלוונטי"
                />
              </div>
            )}
          </div>

          {/* Date + countdown row */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            {eventDate && (
              <span className="text-[11px] font-semibold text-foreground-secondary">
                📅 {eventDate}
              </span>
            )}
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
            <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-secondary text-foreground-muted border border-border">
              {actionBadge}
            </span>
          </div>

          <p className="text-[12px] text-foreground-secondary leading-relaxed mb-2 line-clamp-2">{description}</p>

          {(meta.artist_or_headliner || meta.venue) && (
            <div className="flex items-center gap-2 text-[11px] text-foreground-muted mb-1.5">
              {meta.artist_or_headliner && <span className="font-medium text-foreground-secondary">🎤 {meta.artist_or_headliner}</span>}
              {meta.venue && <span className="opacity-70">📍 {meta.venue}</span>}
            </div>
          )}

          {meta.action_label && (
            <div className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
              <TrendingUp className="w-3.5 h-3.5 text-primary opacity-60" />
              <span>{meta.action_label}</span>
            </div>
          )}
        </div>

        <button
          onClick={e => { e.stopPropagation(); setPopup(true); }}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium bg-foreground text-background hover:opacity-90 transition-all"
        >
          <Zap className="w-3.5 h-3.5" />
          פעל עכשיו
        </button>
      </div>

      {popup && (
        <EventActSheet
          item={item}
          type={type}
          businessProfile={businessProfile}
          onClose={() => setPopup(false)}
        />
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function Events() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab]         = useState('all');
  const [scanning, setScanning]           = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [dismissedIds, setDismissedIds]   = useState(new Set());
  const [autoScanned, setAutoScanned]     = useState(false);

  const POLL_INTERVAL = 20 * 60 * 1000;

  const { data: eventAlerts = [], isLoading: loadingAlerts } = useQuery({
    queryKey: ['eventAlerts', bpId],
    queryFn:  () => base44.entities.ProactiveAlert.filter({ linked_business: bpId, alert_type: 'market_opportunity' }, '-created_date', 50),
    enabled:  !!bpId,
    refetchInterval: POLL_INTERVAL,
    staleTime: 10 * 60 * 1000,
  });

  const { data: eventSignals = [], isLoading: loadingSignals } = useQuery({
    queryKey: ['eventSignals', bpId],
    queryFn:  () => base44.entities.MarketSignal.filter({ linked_business: bpId, category: 'event' }, '-detected_at', 50),
    enabled:  !!bpId,
    refetchInterval: POLL_INTERVAL,
    staleTime: 10 * 60 * 1000,
  });

  const { data: localEventSignals = [], isLoading: loadingLocal } = useQuery({
    queryKey: ['localEventSignals', bpId],
    queryFn:  () => base44.entities.MarketSignal.filter({ linked_business: bpId, category: 'local_event' }, '-detected_at', 30),
    enabled:  !!bpId,
    refetchInterval: POLL_INTERVAL,
    staleTime: 10 * 60 * 1000,
  });

  const { data: weatherSignals = [], isLoading: loadingWeather } = useQuery({
    queryKey: ['weatherSignals', bpId],
    queryFn:  () => base44.entities.MarketSignal.filter({ linked_business: bpId, category: 'weather_event' }, '-detected_at', 10),
    enabled:  !!bpId,
    refetchInterval: POLL_INTERVAL,
    staleTime: 10 * 60 * 1000,
  });

  const isLoading = loadingAlerts || loadingSignals || loadingLocal || loadingWeather;
  const totalEvents = eventAlerts.length + eventSignals.length + localEventSignals.length;

  // Auto-scan on first page load if no events exist
  useEffect(() => {
    if (!bpId || isLoading || autoScanned || totalEvents > 0) return;
    setAutoScanned(true);
    Promise.allSettled([
      base44.functions.invoke('detectEvents',    { businessProfileId: bpId }),
      base44.functions.invoke('findLocalEvents', { businessProfileId: bpId }),
    ]).then(() => {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['eventAlerts',      bpId] });
        queryClient.invalidateQueries({ queryKey: ['eventSignals',     bpId] });
        queryClient.invalidateQueries({ queryKey: ['localEventSignals', bpId] });
        queryClient.invalidateQueries({ queryKey: ['weatherSignals',   bpId] });
      }, 3000);
    });
  }, [bpId, isLoading, autoScanned, totalEvents, queryClient]);

  const handleEventDismissed = (item) => {
    setDismissedIds(prev => new Set([...prev, item.id]));
    queryClient.invalidateQueries({ queryKey: ['eventAlerts',      bpId] });
    queryClient.invalidateQueries({ queryKey: ['eventSignals',     bpId] });
    queryClient.invalidateQueries({ queryKey: ['localEventSignals', bpId] });
    queryClient.invalidateQueries({ queryKey: ['weatherSignals',   bpId] });
  };

  function extractEventDate(item) {
    try {
      const meta = getEventMeta(item);
      if (meta.event_date) return new Date(meta.event_date).getTime();
      if (meta.urgency_hours) return Date.now() + Number(meta.urgency_hours) * 3600000;
    } catch {}
    const text = item._type === 'alert' ? (item.description || '') : (item.summary || '');
    const m = text.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])).getTime();
    return Date.now() + 365 * 86400000;
  }

  function normalizeEventTitle(item) {
    const raw = item._type === 'alert'
      ? (item.title || '')
      : (item.agent_name || item.summary || '');
    return raw
      .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}⚽📅🛍🌿🎵🎯🏆🕌✡️🎤📍🎉🎊🎶📣💡]\s*/u, '')
      .split(' — ')[0]
      .trim()
      .toLowerCase();
  }

  // Merge all DB events, filter stale, dedup by name, sort by date
  const rawDbItems = [
    ...eventAlerts.map(a => ({ ...a, _type: 'alert' })),
    ...eventSignals.map(s => ({ ...s, _type: 'signal' })),
    ...localEventSignals.map(s => ({ ...s, _type: 'signal', _isLocal: true })),
    ...weatherSignals.map(s => ({ ...s, _type: 'signal', _isLocal: true })),
  ].filter(item => {
    if (item.is_dismissed) return false;
    // Filter out dismissed items from local state
    if (dismissedIds.has(item.id)) return false;
    // Filter stale DB items (created >7 days ago with no parseable future date)
    const created = new Date(item.created_date || item.detected_at || 0).getTime();
    if (created < Date.now() - 7 * 86400000) {
      const eventTs = extractEventDate(item);
      if (eventTs < Date.now()) return false;
    }
    return true;
  });

  const seenEventKeys = new Map();
  rawDbItems.forEach(item => {
    const key = normalizeEventTitle(item);
    if (!key) return;
    const ts = new Date(item.created_date || item.detected_at || 0).getTime();
    const prev = seenEventKeys.get(key);
    if (!prev || ts > prev.ts) seenEventKeys.set(key, { item, ts });
  });

  const allItems = Array.from(seenEventKeys.values())
    .map(v => v.item)
    .sort((a, b) => extractEventDate(a) - extractEventDate(b));

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

  const getCategory = (item) => {
    const mapped = categoryMap.get(item.id) || 'other';
    if (item._isLocal) return mapped === 'weather' ? 'weather' : 'local';
    return mapped;
  };

  const filtered = activeTab === 'all'
    ? allItems
    : allItems.filter(item => getCategory(item) === activeTab);

  const countByTab = {
    holiday:      allItems.filter(i => getCategory(i) === 'holiday').length,
    religion:     allItems.filter(i => getCategory(i) === 'religion').length,
    sports:       allItems.filter(i => getCategory(i) === 'sports').length,
    tv_broadcast: allItems.filter(i => getCategory(i) === 'tv_broadcast').length,
    seasonal:     allItems.filter(i => getCategory(i) === 'seasonal').length,
    commercial:   allItems.filter(i => getCategory(i) === 'commercial').length,
    local:        allItems.filter(i => getCategory(i) === 'local').length,
    weather:      allItems.filter(i => getCategory(i) === 'weather').length,
  };

  const handleScan = async () => {
    setScanning(true);
    toast.info('סורק אירועים קרובים...');
    try {
      const [evRes, localRes] = await Promise.allSettled([
        base44.functions.invoke('detectEvents',    { businessProfileId: bpId }),
        base44.functions.invoke('findLocalEvents', { businessProfileId: bpId, force: true }),
      ]);
      const evFound    = evRes.status    === 'fulfilled' ? (evRes.value?.data?.signals_created    ?? 0) : 0;
      const localFound = localRes.status === 'fulfilled' ? (localRes.value?.data?.signals_created ?? 0) : 0;
      queryClient.invalidateQueries({ queryKey: ['eventAlerts',       bpId] });
      queryClient.invalidateQueries({ queryKey: ['eventSignals',      bpId] });
      queryClient.invalidateQueries({ queryKey: ['localEventSignals', bpId] });
      queryClient.invalidateQueries({ queryKey: ['weatherSignals',    bpId] });
      const total = evFound + localFound;
      toast.success(total > 0 ? `נמצאו ${total} אירועים רלוונטיים ✓` : 'הסריקה הושלמה — בדוק שוב בעוד מספר שניות');
    } catch {
      toast.error('שגיאה בסריקת אירועים');
    }
    setScanning(false);
  };

  return (
    <div className="space-y-5">
      <AiInsightsBar
        title="תובנות AI — הזדמנויות עסקיות"
        prompt="נתח את לוח האירועים הקרובים לעסק: אלו חגים, עונות או אירועים מציגים את ההזדמנות הגדולה ביותר לגידול במכירות, ואיזה פעולה לבצע לפני כל אחד."
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[16px] font-bold text-foreground tracking-tight">אירועים והזדמנויות</h1>
          <p className="text-[12px] text-foreground-muted mt-0.5">
            חגים, ספורט, עונות מסחריות — אירועים רלוונטיים לעסק שלך עם תאריכים ופעולות מותאמות
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
          { label: 'סה"כ אירועים',   value: allItems.length,                                        color: 'text-primary' },
          { label: 'חגים יהודיים',   value: countByTab.holiday,                                     color: 'text-purple-500' },
          { label: 'ספורט/טלוויזיה', value: countByTab.sports + countByTab.tv_broadcast,            color: 'text-green-600' },
          { label: 'מסחרי/עונתי',    value: countByTab.commercial + countByTab.seasonal,             color: 'text-amber-500' },
        ].map(card => (
          <div key={card.label} className="card-base p-4 fade-in-up">
            <p className="text-[10px] font-medium text-foreground-muted mb-1">{card.label}</p>
            <span className={`text-[24px] font-bold tracking-tight ${card.color}`}>{card.value}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-border overflow-x-auto">
        {EVENT_TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-[12px] font-medium transition-all duration-150 relative whitespace-nowrap ${
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
            {activeTab === 'all'
              ? 'טרם זוהו אירועים רלוונטיים לעסק שלך'
              : `אין אירועים בקטגוריית "${EVENT_TABS.find(t => t.key === activeTab)?.label}"`}
          </p>
          {activeTab === 'all' && (
            <button
              onClick={handleScan}
              disabled={scanning}
              className="mt-3 px-4 py-2 rounded-lg text-[12px] font-medium bg-foreground text-background hover:opacity-90 disabled:opacity-50"
            >
              {scanning ? 'סורק...' : 'סרוק אירועים עכשיו ←'}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(item => (
            <EventCard
              key={`${item._type}-${item.id}`}
              item={item}
              type={item._type}
              businessProfile={businessProfile}
              onCardClick={(ev, t) => setSelectedEvent({ item: ev, type: t })}
              onDismissed={handleEventDismissed}
            />
          ))}
        </div>
      )}

      {selectedEvent && (
        <EventDetailModal
          item={selectedEvent.item}
          type={selectedEvent.type}
          businessProfile={businessProfile}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}
