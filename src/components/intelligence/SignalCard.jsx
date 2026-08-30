import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { trackUxEvent } from '@/lib/trackUxEvent';
import { ArrowLeft, Loader2, CheckCheck, ExternalLink, ListPlus, Sparkles, RefreshCw, Megaphone } from 'lucide-react';
import DismissMenu from '@/components/ui/DismissMenu';
import { useNavigate } from 'react-router-dom';
import { classifyInsight, isOrganicContent, isPaidCampaign, isNavigateAway } from '@/lib/popup_classifier';
import { toast } from 'sonner';
import { SourceTypeBadge, PlatformBadge, SentimentBadge } from './SignalSourceBadge';
import AiConfidenceBadge from '@/components/ai/AiConfidenceBadge';
import DataFreshnessBadge from '@/components/ai/DataFreshnessBadge';
import FeedbackBar from '@/components/ui/FeedbackBar';
import ActionPopup from '@/components/ui/ActionPopup';

const PLATFORM_BADGE = {
  instagram: { icon: '📸', label: 'Instagram', cls: 'bg-pink-50 text-pink-600 border-pink-100' },
  facebook:  { icon: '👤', label: 'Facebook',  cls: 'bg-blue-50 text-blue-600 border-blue-100' },
  google:    { icon: '⭐', label: 'Google',    cls: 'bg-red-50 text-red-600 border-red-100' },
  whatsapp:  { icon: '💬', label: 'WhatsApp',  cls: 'bg-green-50 text-green-600 border-green-100' },
  wolt:      { icon: '🛵', label: 'Wolt',      cls: 'bg-sky-50 text-sky-600 border-sky-100' },
  ten_bis:   { icon: '🍽️', label: 'תן ביס',   cls: 'bg-orange-50 text-orange-600 border-orange-100' },
  website:   { icon: '🌐', label: 'אתר',       cls: 'bg-secondary/50 text-foreground-secondary border-border' },
};

const categoryConfig = {
  threat:          { borderClass: 'signal-border-threat',         label: 'איום' },
  opportunity:     { borderClass: 'signal-border-opportunity',    label: 'הזדמנות' },
  trend:           { borderClass: 'signal-border-trend',          label: 'מגמה' },
  mention:         { borderClass: 'signal-border-mention',        label: 'אזכור' },
  competitor_move:        { borderClass: 'signal-border-competitor_move', label: 'מתחרים' },
  event:                 { borderClass: 'signal-border-trend',          label: 'אירוע' },
  early_trend:           { borderClass: 'signal-border-early_trend',    label: '🔥 טרנד מוקדם' },
  viral_signal:          { borderClass: 'signal-border-opportunity',    label: '🔥 ויראלי' },
  visual_trend:          { borderClass: 'signal-border-trend',          label: '🎨 טרנד ויזואלי' },
};

const impactLabels = {
  high:   { text: 'השפעה גבוהה',   cls: 'text-[#dc2626]' },
  medium: { text: 'השפעה בינונית', cls: 'text-[#d97706]' },
  low:    { text: 'השפעה נמוכה',   cls: 'text-[#10b981]' },
};

const urgencyStyle = {
  'דחוף':  { border: 'border-r-4 border-red-500 bg-red-50',    badge: 'bg-red-100 text-red-700'     },
  'בינוני': { border: 'border-r-4 border-amber-500 bg-amber-50', badge: 'bg-amber-100 text-amber-700'  },
  'נמוך':  { border: 'border-r-4 border-gray-400 bg-secondary/50',  badge: 'bg-secondary text-foreground-secondary'   },
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'לפני פחות משעה';
  if (hours < 24) return `לפני ${hours} שעות`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('he-IL', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function parseInsight(text) {
  const lines = (text || '').split('\n').filter(Boolean);
  const get = (key) => {
    const line = lines.find(l => l.startsWith(key + ':'));
    return line ? line.slice(key.length + 1).trim() : '';
  };
  return {
    urgency:      get('URGENCY'),
    oneSentence:  get('ONE_SENTENCE'),
    impactNumber: get('IMPACT_NUMBER'),
    actionLabel:  get('ACTION_LABEL'),
    actionTime:   get('ACTION_TIME'),
  };
}

export default function SignalCard({ signal, businessProfile }) {
  const [expanded,       setExpanded]       = useState(false);
  const [parsedInsight,  setParsedInsight]  = useState(null);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [analysisError,  setAnalysisError]  = useState('');
  const [creatingTask,   setCreatingTask]   = useState(false);
  const [showActionPopup, setShowActionPopup] = useState(false);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const config = categoryConfig[signal.category] || { borderClass: 'signal-border-default', label: 'כללי' };
  const impact = impactLabels[signal.impact_level] || impactLabels.medium;

  // Parse source_signals — URLs (pipe-separated) or IDs (comma-separated)
  const sourceSignalsStr = signal.source_signals || '';
  const isUrlBased  = sourceSignalsStr.includes('http');
  const directUrls  = isUrlBased ? sourceSignalsStr.split(' | ').filter(u => u.startsWith('http')) : [];
  const sourceIds   = !isUrlBased ? sourceSignalsStr.split(',').filter(Boolean) : [];

  const { data: rawSources = [] } = useQuery({
    queryKey: ['signalSources', signal.id],
    queryFn: async () => {
      if (sourceIds.length === 0) return [];
      const allRaw = await base44.entities.RawSignal.filter(
        { linked_business: signal.linked_business }, '-detected_at', 30,
      );
      return allRaw.filter(r => sourceIds.includes(r.id));
    },
    enabled: expanded && sourceIds.length > 0,
  });

  const dismissMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.MarketSignal.update(signal.id, { is_dismissed: true });
      try {
        await base44.feedback.submit({
          businessProfileId: businessProfile?.id,
          agentName: signal.agent_name || 'MarketIntelligence',
          outputType: 'market_signal',
          score: -1,
          tags: 'dismissed,not_relevant',
          aiOutputId: signal.id,
        });
      } catch (_) {}
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intelligenceSignals'] });
      toast.success('קיבלנו 🧠 נלמד מזה ונשתפר');
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.MarketSignal.update(signal.id, { is_read: true });
      try {
        await base44.functions.invoke('logOutcome', {
          action_type: 'insight_read', was_accepted: true,
          outcome_description: signal.summary,
          linked_business: businessProfile?.id || '',
        });
      } catch (_) {}
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intelligenceSignals'] });
      // FIX 4: update the TopBar badge count when a signal is marked read
      queryClient.invalidateQueries({ queryKey: ['unreadSignals'] });
    },
  });

  const handleExpand = async () => {
    if (!signal.is_read) markReadMutation.mutate();
    const wasExpanded = expanded;
    setExpanded(!expanded);
    if (!wasExpanded && !parsedInsight && !generatingPlan) generateAnalysis();
  };

  const handleCreateTask = async (customTitle) => {
    setCreatingTask(true);
    try {
      await base44.entities.Task.create({
        title: customTitle || signal.summary,
        description: `${signal.recommended_action || ''}\n\nמקור: תובנת שוק (${config.label})\nביטחון: ${signal.confidence}%`,
        status: 'pending',
        priority: signal.impact_level === 'high' ? 'high' : signal.impact_level === 'medium' ? 'medium' : 'low',
        source_type: 'alert',
        linked_business: businessProfile?.id || '',
      });
      toast.success('המשימה נוצרה בהצלחה');
    } catch (_) {
      toast.error('שגיאה ביצירת המשימה');
    }
    setCreatingTask(false);
  };

  const handleCreateCampaignIdea = () => {
    const params = new URLSearchParams({
      signalId: signal.id,
      summary:  signal.summary || '',
      action:   signal.recommended_action || '',
      category: signal.category || '',
      impact:   signal.impact_level || '',
    });
    navigate(`/marketing/create?${params.toString()}`);
  };

  const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  const generateAnalysis = async () => {
    // Check sessionStorage cache first
    const cacheKey = `signal_analysis_${signal.id}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_TTL) {
          setParsedInsight(data);
          return;
        }
      }
    } catch (_) {}

    setGeneratingPlan(true);
    setAnalysisError('');
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        model: 'sonnet',
        maxTokens: 250,
        prompt: `אתה יועץ עסקי AI לעסקים ישראלים. נתח את האות ותן תגובה חדה ומעשית.

עסק: ${businessProfile?.name || ''} | תחום: ${businessProfile?.category || ''} | עיר: ${businessProfile?.city || ''}
אות: "${signal.summary}"
פעולה מומלצת: ${signal.recommended_action || 'לא צוינה'}
השפעה: ${signal.impact_level} | קטגוריה: ${signal.category || ''}

ענה בדיוק בפורמט הזה, 5 שורות בלבד:
URGENCY: [דחוף/בינוני/נמוך]
ONE_SENTENCE: [מה קרה ולמה זה חשוב — ספציפי עם מספר/שם, עד 12 מילים]
IMPACT_NUMBER: [מספר קונקרטי עם הקשר — "30% יותר חיפושים" / "3 לקוחות דיווחו"]
ACTION_LABEL: [פועל ציווי + ערוץ ספציפי — עד 5 מילים]
ACTION_TIME: [זמן ביצוע ריאלי]

אסור: פסקאות, הסברים, כותרות.`,
      });
      const parsed = parseInsight(result);
      setParsedInsight(parsed);
      // Save to cache
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ data: parsed, timestamp: Date.now() }));
      } catch (_) {}
    } catch (err) {
      console.error('[SignalCard] generateAnalysis failed:', err);
      setAnalysisError('לא ניתן לטעון תובנות AI כרגע — נסה שוב מאוחר יותר');
    } finally {
      setGeneratingPlan(false);
    }
  };

  const uStyle = urgencyStyle[parsedInsight?.urgency] || urgencyStyle['נמוך'];

  return (
    <div className="hover:bg-secondary/40 transition-all duration-150">
      {/* ── Card header row ── */}
      <div className={`px-5 py-4 cursor-pointer ${config.borderClass}`} onClick={handleExpand}>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p
              className={`text-[13px] text-foreground leading-snug mb-1.5 ${!signal.is_read ? 'font-semibold' : 'font-medium'} hover:underline cursor-pointer`}
              onClick={(e) => { e.stopPropagation(); navigate(`/signals/${signal.id}`); }}
              title="פתח פרטי תובנה"
            >
              {signal.summary}
            </p>
            {signal.recommended_action && (
              <p className="text-[11px] text-foreground-muted mb-2">{signal.recommended_action}</p>
            )}
            {(() => {
              try {
                const m = JSON.parse(signal.source_description || '{}');
                const thumbs = Array.isArray(m.images) ? m.images : Array.isArray(m.media_urls) ? m.media_urls : m.thumbnail_url ? [m.thumbnail_url] : [];
                if (!thumbs.length) return null;
                return (
                  <div className="flex gap-1.5 mb-2 overflow-x-auto">
                    {thumbs.slice(0, 4).map((url, i) => (
                      <img key={i} src={url} alt="" className="flex-shrink-0 w-14 h-10 rounded-md object-cover border border-border" onError={e => { e.currentTarget.style.display = 'none'; }} />
                    ))}
                  </div>
                );
              } catch { return null; }
            })()}
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              {signal.source_signals === 'trend_prediction' && (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-purple-50 text-purple-600 border border-purple-100">
                  חיזוי 🔮
                </span>
              )}
              {(() => {
                try {
                  const m = JSON.parse(signal.source_description || '{}');
                  if (!m.is_global_trend && !signal.is_us_leading_indicator) return null;
                  return (
                    <span
                      className="px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-blue-50 text-blue-600 border border-blue-100"
                      title={m.days_until_israel ? `צפוי להגיע לישראל בעוד ~${m.days_until_israel} ימים` : 'טרנד מוביל מארה״ב — 2–6 שבועות מקדימות'}
                    >
                      🌍 Global Trends{m.days_until_israel ? ` · ${m.days_until_israel}י` : ' · 2–6 שבועות מקדימות'}
                    </span>
                  );
                } catch { return null; }
              })()}
              {signal.category === 'early_trend' && (() => {
                try {
                  const m = JSON.parse(signal.source_description || '{}');
                  return (
                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-orange-50 text-orange-600 border border-orange-200">
                      ⚡ עולה לפני השיא{m.days_to_peak ? ` · ${m.days_to_peak}י` : ''}
                    </span>
                  );
                } catch { return null; }
              })()}
              <span className={`text-[10px] font-semibold ${impact.cls}`}>{impact.text}</span>
              <span className="text-[10px] text-foreground-muted opacity-60"
                title={formatDate(signal.detected_at || signal.created_date)}>
                {timeAgo(signal.detected_at || signal.created_date)}
              </span>
              <AiConfidenceBadge confidence={signal.confidence} compact={signal.confidence == null || signal.confidence >= 50} />
              <DataFreshnessBadge dateStr={signal.detected_at || signal.created_date} maxAgeHours={72} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {!signal.is_read && (
                <button
                  onClick={(e) => { e.stopPropagation(); markReadMutation.mutate(); }}
                  className="btn-subtle text-[10px] text-foreground-muted hover:text-foreground flex items-center gap-1"
                >
                  <CheckCheck className="w-3 h-3" /> סמן כנקרא
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); handleCreateTask(); }}
                disabled={creatingTask}
                className="btn-subtle text-[10px] text-foreground-muted hover:text-primary flex items-center gap-1"
              >
                {creatingTask ? <Loader2 className="w-3 h-3 animate-spin" /> : <ListPlus className="w-3 h-3" />}
                צור משימה
              </button>
              {(signal.category === 'trend' || signal.category === 'opportunity' || signal.category === 'early_trend' || signal.category === 'viral_signal') && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleCreateCampaignIdea(); }}
                  className="btn-subtle text-[10px] text-foreground-muted hover:text-primary flex items-center gap-1"
                >
                  <Megaphone className="w-3 h-3" />
                  {signal.category === 'early_trend' ? 'צור תוכן לטרנד'
                    : signal.category === 'viral_signal' ? 'פרסם עכשיו 🔥'
                    : 'צור קמפיין'}
                </button>
              )}
              {(() => {
                // Show action type badge + platform badge when metadata is available
                try {
                  const m = JSON.parse(signal.source_description || '{}');
                  const ACTION_ICON = { social_post:'📣', respond:'💬', promote:'🎯', call:'📞', task:'✅', post_publish:'📣' };
                  const platInfo = PLATFORM_BADGE[m.action_platform];
                  return (
                    <>
                      {m.action_label && m.action_type && (
                        <span className="text-[10px] px-2 py-0.5 bg-primary/8 text-primary rounded-full border border-primary/15">
                          {ACTION_ICON[m.action_type] || '⚡'} {m.action_label}
                        </span>
                      )}
                      {platInfo && (
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full border ${platInfo.cls}`}
                          title={m.platform_reason || platInfo.label}
                        >
                          {platInfo.icon} {platInfo.label}
                        </span>
                      )}
                    </>
                  );
                } catch {}
                return null;
              })()}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (signal.category === 'viral_signal') {
                    trackUxEvent('ux_cta_from_viral', businessProfile?.id, { signalId: signal.id });
                    const params = new URLSearchParams({
                      create: 'organic',
                      type: 'post',
                      signalId: signal.id,
                      summary: signal.summary || '',
                      action: signal.recommended_action || '',
                      viral: 'true',
                    });
                    navigate(`/marketing?${params.toString()}`);
                    return;
                  }
                  let meta = {};
                  try { meta = JSON.parse(signal.source_description || '{}'); } catch {}
                  const popupType = classifyInsight({
                    action_type: meta.action_type || signal.action_type,
                    action_label: meta.action_label,
                    summary: signal.summary,
                    recommended_action: signal.recommended_action,
                    category: signal.category,
                  });
                  if (isOrganicContent(popupType)) {
                    const params = new URLSearchParams({
                      create: 'organic',
                      type: popupType === 'story_post' ? 'story' : 'post',
                      signalId: signal.id,
                      summary: signal.summary || '',
                      action: signal.recommended_action || '',
                    });
                    navigate(`/marketing?${params.toString()}`);
                  } else if (isPaidCampaign(popupType)) {
                    const params = new URLSearchParams({
                      signalId: signal.id,
                      summary: signal.summary || '',
                      action: signal.recommended_action || '',
                      category: signal.category || '',
                    });
                    navigate(`/marketing/create?${params.toString()}`);
                  } else if (popupType === 'whatsapp_blast') {
                    const params = new URLSearchParams({
                      create: 'whatsapp',
                      signalId: signal.id,
                      summary: signal.summary || '',
                    });
                    navigate(`/marketing?${params.toString()}`);
                  } else if (popupType === 'seasonal_promo') {
                    const params = new URLSearchParams({
                      type: 'seasonal',
                      signalId: signal.id,
                      event: signal.summary || '',
                      summary: signal.summary || '',
                    });
                    navigate(`/marketing/create?${params.toString()}`);
                  } else if (popupType === 'new_competitor_alert') {
                    // Extract competitor name from summary if possible
                    const compName = signal.summary?.match(/["״](.*?)["״]/)?.[1] || signal.summary || '';
                    const params = new URLSearchParams({ newCompetitor: compName });
                    navigate(`/competitors?${params.toString()}`);
                  } else {
                    setShowActionPopup(true);
                  }
                }}
                className="btn-subtle text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 font-semibold flex items-center gap-1 px-2 py-0.5 rounded-md transition-all"
              >
                ⚡ פעל עכשיו
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleExpand(); }}
                className="btn-subtle text-[10px] text-primary font-medium opacity-60 hover:opacity-100 flex items-center gap-1 mr-auto"
              >
                <Sparkles className="w-3 h-3" /> תובנות AI <ArrowLeft className="w-3 h-3" />
              </button>
              <FeedbackBar
                compact
                signalId={signal.id}
                signalText={signal.summary}
                agentName={signal.agent_name}
                businessId={businessProfile?.id}
              />
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <div onClick={e => e.stopPropagation()}>
              <DismissMenu
                entityType="signal"
                entityId={signal.id}
                title={signal.summary}
                businessProfileId={businessProfile?.id}
                onDismissed={() => dismissMutation.mutate()}
                buttonLabel=""
                buttonClassName="btn-subtle text-[11px] text-foreground-muted hover:text-red-500 opacity-50 hover:opacity-100 transition-all flex items-center gap-0.5"
              />
            </div>
            {!signal.is_read && <span className="w-2 h-2 rounded-full bg-primary" />}
          </div>
        </div>
      </div>

      {/* ── Expanded panel ── */}
      {showActionPopup && (
        <ActionPopup
          signal={signal}
          businessProfile={businessProfile}
          onClose={() => setShowActionPopup(false)}
        />
      )}
      {expanded && (
        <div className="px-5 pb-4 mx-5 mb-3 rounded-xl bg-secondary border border-border space-y-4 p-4 fade-in-up">

          {/* Platform recommendation (from agent guidance) */}
          {(() => {
            try {
              const m = JSON.parse(signal.source_description || '{}');
              const platInfo = PLATFORM_BADGE[m.action_platform];
              if (!platInfo || !m.platform_reason) return null;
              return (
                <div className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border ${platInfo.cls}`}>
                  <span className="text-xl flex-shrink-0">{platInfo.icon}</span>
                  <div>
                    <p className="text-[11px] font-semibold mb-0.5">למה דווקא {platInfo.label}?</p>
                    <p className="text-[11px] opacity-80">{m.platform_reason}</p>
                  </div>
                </div>
              );
            } catch { return null; }
          })()}

          {/* Aspect matrix — trend signals only */}
          {signal.category === 'trend' && (() => {
            let m = {};
            try { m = JSON.parse(signal.source_description || '{}'); } catch {}
            const platform = m.platform || m.action_platform || '';
            const isGoogle = platform === 'google' || (signal.agent_name || '').toLowerCase().includes('google') || (signal.agent_name || '').toLowerCase().includes('trends');
            const isSocial = platform === 'instagram' || platform === 'facebook';
            const sourceCount = directUrls.length || sourceIds.length;

            const cells = [
              { label: 'ביטחון', value: signal.confidence != null ? `${signal.confidence}%` : '—' },
              { label: 'השפעה', value: signal.impact_level === 'high' ? 'גבוהה' : signal.impact_level === 'medium' ? 'בינונית' : 'נמוכה' },
              { label: 'מקורות', value: sourceCount || '—' },
              { label: 'גיל', value: timeAgo(signal.detected_at || signal.created_date) || '—' },
            ];
            if (isGoogle) {
              const kws = m.keywords ? (Array.isArray(m.keywords) ? m.keywords : String(m.keywords).split(',').filter(Boolean)) : [];
              if (kws.length) cells.push({ label: 'מילות מפתח', value: kws.length });
              if (m.days_until_israel) cells.push({ label: 'מקדים ישראל', value: `${m.days_until_israel}י` });
            }
            if (isSocial && m.engagement_rate) cells.push({ label: 'מעורבות', value: `${m.engagement_rate}%` });
            if (m.reach_estimate) cells.push({ label: 'חשיפה', value: m.reach_estimate });

            return (
              <div>
                <h4 className="text-[11px] font-semibold text-foreground-secondary mb-2">מדדי מגמה</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {cells.map((cell, i) => (
                    <div key={i} className="bg-white border border-border rounded-lg px-3 py-2 text-center">
                      <p className="text-[9px] text-foreground-muted mb-0.5">{cell.label}</p>
                      <p className="text-[13px] font-bold text-foreground">{cell.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Visual trend media — images / videos / links (AC4) */}
          {signal.category === 'visual_trend' && (() => {
            let m = {};
            try { m = JSON.parse(signal.source_description || '{}'); } catch {}
            const images = Array.isArray(m.images) ? m.images : Array.isArray(m.media_urls) ? m.media_urls : [];
            const videos = Array.isArray(m.videos) ? m.videos : [];
            const links  = Array.isArray(m.links) ? m.links : [];
            if (!images.length && !videos.length && !links.length) return null;
            return (
              <div>
                <h4 className="text-[11px] font-semibold text-foreground-secondary mb-2">🎨 מדיה וויזואלים</h4>
                {images.length > 0 && (
                  <div className="grid grid-cols-3 gap-1.5 mb-2">
                    {images.slice(0, 6).map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                        <img src={url} alt="" className="w-full aspect-square object-cover rounded-lg border border-border" onError={e => { e.currentTarget.style.display = 'none'; }} />
                      </a>
                    ))}
                  </div>
                )}
                {videos.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {videos.slice(0, 2).map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                        className="flex items-center gap-2 text-[11px] text-primary hover:underline bg-white rounded-lg border border-border px-3 py-2">
                        ▶ סרטון {i + 1}
                      </a>
                    ))}
                  </div>
                )}
                {links.length > 0 && (
                  <div className="space-y-1.5">
                    {links.slice(0, 3).map((url, i) => {
                      const domain = (() => { try { return new URL(url).hostname.replace('www.', ''); } catch { return url; } })();
                      return (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                          className="flex items-center gap-2 text-[11px] text-primary hover:underline bg-white rounded-lg border border-border px-3 py-2">
                          🔗 {domain}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Reasoning chain */}
          {signal.reasoning_chain && (
            <div>
              <h4 className="text-[11px] font-semibold text-foreground-secondary mb-2 flex items-center gap-1.5">
                <span className="w-3.5 h-3.5 rounded-sm bg-primary/10 inline-flex items-center justify-center text-[8px] text-primary font-bold">AI</span>
                איך הגענו לתובנה הזו
              </h4>
              <p className="text-[11px] text-foreground-secondary leading-relaxed bg-white rounded-lg border border-border px-3 py-2.5 whitespace-pre-line">
                {signal.reasoning_chain}
              </p>
            </div>
          )}

          {/* Keywords — search/Google trends */}
          {(() => {
            try {
              const m = JSON.parse(signal.source_description || '{}');
              const isSearch = m.platform === 'google' || (signal.agent_name || '').toLowerCase().includes('google') || (signal.agent_name || '').toLowerCase().includes('trends');
              const kws = m.keywords
                ? (Array.isArray(m.keywords) ? m.keywords : String(m.keywords).split(',').map(k => k.trim()).filter(Boolean))
                : (signal.keywords ? (Array.isArray(signal.keywords) ? signal.keywords : String(signal.keywords).split(',').map(k => k.trim()).filter(Boolean)) : []);
              if (!isSearch || !kws.length) return null;
              return (
                <div>
                  <h4 className="text-[11px] font-semibold text-foreground-secondary mb-2 flex items-center gap-1.5">
                    <span>🔍</span> מילות מפתח לטרגוט
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {kws.map((kw, i) => (
                      <span key={i} className="px-2 py-1 text-[11px] font-semibold bg-primary/10 text-primary rounded-lg border border-primary/20">
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              );
            } catch { return null; }
          })()}

          {/* Source excerpts */}
          {signal.source_raw_excerpts && (() => {
            try {
              const excerpts = JSON.parse(signal.source_raw_excerpts);
              if (!excerpts?.length) return null;
              return (
                <div>
                  <h4 className="text-[11px] font-semibold text-foreground-secondary mb-2">ציטוטים מהמקורות</h4>
                  <div className="space-y-1.5">
                    {excerpts.map((excerpt, i) => (
                      <div key={i} className="flex gap-2 bg-white rounded-lg border border-border px-3 py-2">
                        <span className="text-foreground-muted text-[11px] mt-0.5 flex-shrink-0">"</span>
                        <p className="text-[11px] text-foreground-secondary leading-relaxed italic">{excerpt}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            } catch { return null; }
          })()}

          {/* Source URLs */}
          {directUrls.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold text-foreground-secondary mb-2">
                מקורות ({directUrls.length}) — נתונים אמיתיים מהרשת
              </h4>
              <div className="space-y-1.5">
                {directUrls.map((url, i) => {
                  const domain = (() => {
                    try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
                  })();
                  return (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="flex items-center gap-2 text-[11px] text-primary hover:underline bg-white rounded-lg border border-border px-3 py-2 group">
                      <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-60 group-hover:opacity-100" />
                      <span className="truncate">{domain}</span>
                      <span className="text-foreground-muted opacity-50 text-[10px] mr-auto">←</span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {directUrls.length === 0 && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              <p className="text-[10px] text-amber-700">
                תובנה זו מבוססת על ניתוח דפוסים — אין קישור ישיר למקור ספציפי.
                ביטחון: {signal.confidence || 0}%
              </p>
            </div>
          )}

          {/* Early trend velocity metrics — detail view only (AC3) */}
          {signal.category === 'early_trend' && (() => {
            try {
              const m = JSON.parse(signal.source_description || '{}');
              if (!m.velocity_score && !m.days_to_peak) return null;
              return (
                <div className="flex flex-wrap gap-2">
                  {m.velocity_score != null && (
                    <span className="text-[11px] px-3 py-1.5 bg-orange-50 text-orange-700 rounded-lg border border-orange-100 font-medium">
                      🚀 מהירות: {m.velocity_score}/100
                    </span>
                  )}
                  {m.days_to_peak != null && (
                    <span className="text-[11px] px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg border border-amber-100 font-medium">
                      📅 שיא צפוי: ~{m.days_to_peak} ימים
                    </span>
                  )}
                  {m.stage && (
                    <span className="text-[11px] px-3 py-1.5 bg-secondary text-foreground-secondary rounded-lg border border-border">
                      שלב: {m.stage}
                    </span>
                  )}
                </div>
              );
            } catch { return null; }
          })()}

          {/* Agent metadata */}
          <div className="flex items-center gap-3 pt-1 border-t border-border/50 flex-wrap">
            {signal.agent_name && (
              <span className="text-[10px] text-foreground-muted">סוכן: {signal.agent_name}</span>
            )}
            {signal.self_score != null && (
              <span className="text-[10px] text-foreground-muted">איכות עצמית: {signal.self_score}/100</span>
            )}
            {signal.source_description && signal.category !== 'early_trend' && (
              <span className="text-[10px] text-foreground-muted opacity-60">{signal.source_description}</span>
            )}
          </div>

          {/* ── AI Insight block ── */}

          {/* Skeleton while loading */}
          {generatingPlan && !parsedInsight && (
            <div className="animate-pulse space-y-2.5 rounded-xl border border-border p-4">
              <div className="flex gap-2">
                <div className="h-5 w-12 bg-secondary/70 rounded-full" />
                <div className="h-5 w-20 bg-secondary/70 rounded-full" />
              </div>
              <div className="h-4 w-3/4 bg-secondary/70 rounded" />
              <div className="h-6 w-2/5 bg-secondary rounded-lg" />
              <div className="h-10 w-3/5 bg-primary/10 rounded-lg" />
            </div>
          )}

          {/* Error */}
          {analysisError && !generatingPlan && (
            <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3 text-center">
              <p className="text-[12px] text-red-600">{analysisError}</p>
              <button onClick={generateAnalysis}
                className="mt-2 text-[11px] text-foreground-muted underline hover:text-foreground transition-colors">
                נסה שוב
              </button>
            </div>
          )}

          {/* Structured insight card */}
          {parsedInsight && !generatingPlan && (
            <div className={`rounded-xl p-4 space-y-3 ${uStyle.border}`}>
              {/* Status bar */}
              <div className="flex items-center gap-2 flex-wrap">
                {parsedInsight.urgency && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${uStyle.badge}`}>
                    {parsedInsight.urgency}
                  </span>
                )}
                <span className="text-[10px] text-foreground-muted">{config.label}</span>
                <span className="text-[10px] text-foreground-muted mr-auto opacity-60">
                  {timeAgo(signal.detected_at || signal.created_date)}
                </span>
              </div>

              {/* One sentence */}
              {parsedInsight.oneSentence && (
                <p className="text-[13px] font-semibold text-foreground leading-snug">
                  {parsedInsight.oneSentence}
                </p>
              )}

              {/* Impact number */}
              {parsedInsight.impactNumber && (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-foreground-muted bg-white border border-border rounded-lg px-3 py-1.5">
                  💡 {parsedInsight.impactNumber}
                </span>
              )}

              {/* Primary CTA — FIX 5: open ActionPopup instead of silently creating task */}
              {parsedInsight.actionLabel && (
                <button
                  onClick={() => setShowActionPopup(true)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-foreground text-background rounded-lg text-[12px] font-medium hover:opacity-90 transition-all"
                >
                  <span className="flex items-center gap-1.5">
                    <CheckCheck className="w-3.5 h-3.5" />
                    {parsedInsight.actionLabel} ←
                  </span>
                  {parsedInsight.actionTime && (
                    <span className="text-[10px] opacity-60">⏱ {parsedInsight.actionTime}</span>
                  )}
                </button>
              )}

              {/* Secondary row */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={generateAnalysis}
                  disabled={generatingPlan}
                  className="text-[10px] text-foreground-muted hover:text-foreground flex items-center gap-1 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" /> עדכן תובנה
                </button>
                {(signal.category === 'trend' || signal.category === 'opportunity' || signal.category === 'viral_signal') && (
                  <button
                    onClick={handleCreateCampaignIdea}
                    className="text-[10px] text-primary/70 hover:text-primary flex items-center gap-1 transition-colors mr-auto"
                  >
                    <Megaphone className="w-3 h-3" />
                    {signal.category === 'viral_signal' ? 'פרסם עכשיו 🔥' : 'צור קמפיין'}
                  </button>
                )}
              </div>

            </div>
          )}
        </div>
      )}
    </div>
  );
}
