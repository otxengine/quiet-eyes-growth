import React, { useState } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ArrowRight, ExternalLink, Loader2, ListPlus, CheckCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { classifyInsight, isOrganicContent, isPaidCampaign } from '@/lib/popup_classifier';
import ActionPopup from '@/components/ui/ActionPopup';

const PLATFORM_BADGE = {
  instagram: { icon: '📸', label: 'Instagram', cls: 'bg-pink-50 text-pink-600 border-pink-200' },
  facebook:  { icon: '👤', label: 'Facebook',  cls: 'bg-blue-50 text-blue-600 border-blue-200' },
  tiktok:    { icon: '🎵', label: 'TikTok',    cls: 'bg-gray-100 text-gray-700 border-gray-300' },
  google:    { icon: '⭐', label: 'Google',    cls: 'bg-red-50 text-red-600 border-red-200' },
  whatsapp:  { icon: '💬', label: 'WhatsApp',  cls: 'bg-green-50 text-green-700 border-green-200' },
  wolt:      { icon: '🛵', label: 'Wolt',      cls: 'bg-sky-50 text-sky-600 border-sky-200' },
  ten_bis:   { icon: '🍽️', label: 'תן ביס',   cls: 'bg-orange-50 text-orange-600 border-orange-200' },
  website:   { icon: '🌐', label: 'אתר',       cls: 'bg-gray-50 text-gray-600 border-gray-200' },
};

const CATEGORY_LABELS = {
  threat:          { label: 'איום',      cls: 'bg-red-50 text-red-600 border-red-200' },
  opportunity:     { label: 'הזדמנות',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  trend:           { label: 'מגמה',      cls: 'bg-blue-50 text-blue-600 border-blue-200' },
  mention:         { label: 'אזכור',     cls: 'bg-purple-50 text-purple-600 border-purple-200' },
  competitor_move: { label: 'מתחרים',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
};

const IMPACT_LABELS = {
  high:   { label: 'השפעה גבוהה',   cls: 'bg-red-50 text-red-700 border-red-200' },
  medium: { label: 'השפעה בינונית', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  low:    { label: 'השפעה נמוכה',   cls: 'bg-gray-50 text-gray-600 border-gray-200' },
};

const ACTION_ICON = { social_post: '📣', respond: '💬', promote: '🎯', call: '📞', task: '✅', post_publish: '📣' };

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
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function SignalDetail() {
  const { signalId } = useParams();
  const navigate = useNavigate();
  const { businessProfile } = useOutletContext();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('overview');
  const [showActionPopup, setShowActionPopup] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);

  const { data: signal, isLoading } = useQuery({
    queryKey: ['signal', signalId],
    queryFn: () => base44.entities.MarketSignal.get(signalId),
    enabled: !!signalId,
  });

  const { data: linkedTasks = [] } = useQuery({
    queryKey: ['linkedTasks', signalId],
    queryFn: async () => {
      const all = await base44.entities.Task.filter(
        { linked_business: businessProfile?.id, source_type: 'alert' }, '-created_date', 50,
      );
      return all.filter(t =>
        t.description?.includes(`[signal:${signalId}]`) ||
        t.description?.includes(signal?.summary?.slice(0, 30) || '')
      );
    },
    enabled: !!signalId && !!businessProfile?.id && !!signal,
  });

  const markReadMutation = useMutation({
    mutationFn: () => base44.entities.MarketSignal.update(signalId, { is_read: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['intelligenceSignals'] }),
  });

  const handleCreateTask = async () => {
    if (!signal) return;
    setCreatingTask(true);
    try {
      await base44.entities.Task.create({
        title: signal.summary,
        description: `[signal:${signalId}]\n${signal.recommended_action || ''}\n\nמקור: ${signal.summary}`,
        status: 'pending',
        priority: signal.impact_level === 'high' ? 'high' : signal.impact_level === 'medium' ? 'medium' : 'low',
        source_type: 'alert',
        linked_business: businessProfile?.id || '',
      });
      toast.success('המשימה נוצרה ✓');
      queryClient.invalidateQueries({ queryKey: ['linkedTasks', signalId] });
    } catch { toast.error('שגיאה ביצירת המשימה'); }
    setCreatingTask(false);
  };

  const handleAction = () => {
    if (!signal) return;
    let meta = {};
    try { meta = JSON.parse(signal.source_description || '{}'); } catch {}
    const popupType = classifyInsight({
      action_type: meta.action_type || signal.action_type,
      action_label: meta.action_label,
      action_platform: meta.action_platform,
      summary: signal.summary,
      recommended_action: signal.recommended_action,
      category: signal.category,
    });
    if (isOrganicContent(popupType)) {
      const params = new URLSearchParams({
        create: 'organic',
        type: popupType === 'story_post' ? 'story' : 'post',
        signalId,
        summary: signal.summary || '',
        action: signal.recommended_action || '',
      });
      navigate(`/marketing?${params.toString()}`);
    } else if (isPaidCampaign(popupType)) {
      const params = new URLSearchParams({ signalId, summary: signal.summary || '', action: signal.recommended_action || '' });
      navigate(`/marketing/create?${params.toString()}`);
    } else if (popupType === 'whatsapp_blast') {
      navigate(`/marketing?create=whatsapp&signalId=${signalId}&summary=${encodeURIComponent(signal.summary || '')}`);
    } else if (popupType === 'seasonal_promo') {
      navigate(`/marketing/create?type=seasonal&signalId=${signalId}&event=${encodeURIComponent(signal.summary || '')}`);
    } else if (popupType === 'new_competitor_alert') {
      const compName = signal.summary?.match(/["״](.*?)["״]/)?.[1] || signal.summary || '';
      navigate(`/competitors?newCompetitor=${encodeURIComponent(compName)}`);
    } else {
      setShowActionPopup(true);
    }
  };

  // Mark as read on open
  React.useEffect(() => {
    if (signal && !signal.is_read) markReadMutation.mutate();
  }, [signal?.id]); // eslint-disable-line

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20" dir="rtl">
        <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
      </div>
    );
  }

  if (!signal) {
    return (
      <div className="p-6 text-center text-foreground-muted" dir="rtl">
        <p className="mb-3">התובנה לא נמצאה</p>
        <button onClick={() => navigate('/signals')} className="text-primary text-[13px] hover:underline">
          ← חזור לתובנות
        </button>
      </div>
    );
  }

  let meta = {};
  try { meta = JSON.parse(signal.source_description || '{}'); } catch {}

  const platInfo = PLATFORM_BADGE[meta.action_platform];
  const catInfo  = CATEGORY_LABELS[signal.category] || { label: 'כללי', cls: 'bg-gray-50 text-gray-600 border-gray-200' };
  const impInfo  = IMPACT_LABELS[signal.impact_level] || IMPACT_LABELS.medium;

  const sourceUrls = (signal.source_urls || signal.source_signals || '')
    .split(/\s*\|\s*|\n/)
    .filter(u => u.startsWith('http'));

  const TABS = [
    { id: 'overview', label: 'סקירה' },
    { id: 'sources',  label: `מקורות${sourceUrls.length ? ` (${sourceUrls.length})` : ''}` },
    { id: 'actions',  label: `פעולות${linkedTasks.length ? ` (${linkedTasks.length})` : ''}` },
  ];

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 gap-3">
        <button
          onClick={() => navigate('/signals')}
          className="flex items-center gap-1.5 text-[12px] text-foreground-muted hover:text-foreground transition-colors mt-0.5 flex-shrink-0"
        >
          <ArrowRight className="w-4 h-4" /> תובנות שוק
        </button>
        <button
          onClick={handleAction}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-[13px] font-semibold hover:bg-emerald-700 transition-all flex-shrink-0"
        >
          ⚡ פעל עכשיו
        </button>
      </div>

      {/* Signal title */}
      <h1 className="text-[18px] font-bold text-foreground leading-snug mb-3">{signal.summary}</h1>

      {/* Meta badges */}
      <div className="flex flex-wrap gap-2 mb-4">
        {platInfo && (
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-[12px] font-semibold rounded-full border ${platInfo.cls}`}>
            {platInfo.icon} {platInfo.label}
          </span>
        )}
        <span className={`inline-flex items-center gap-1 px-3 py-1 text-[12px] font-medium rounded-full border ${impInfo.cls}`}>
          {impInfo.label}
        </span>
        <span className={`inline-flex items-center gap-1 px-3 py-1 text-[12px] font-medium rounded-full border ${catInfo.cls}`}>
          {catInfo.label}
        </span>
        {signal.confidence && (
          <span className="inline-flex items-center gap-1 px-3 py-1 text-[12px] font-medium rounded-full border bg-purple-50 text-purple-600 border-purple-200">
            🎯 {Math.round(signal.confidence)}% ביטחון
          </span>
        )}
        <span className="inline-flex items-center gap-1 px-3 py-1 text-[12px] text-foreground-muted rounded-full border border-border bg-secondary">
          {timeAgo(signal.detected_at || signal.created_date)}
          {signal.agent_name && ` · ${signal.agent_name}`}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 p-1 bg-secondary rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-4 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
              activeTab === t.id ? 'bg-card shadow-sm text-foreground' : 'text-foreground-muted hover:text-foreground'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Platform recommendation */}
          {platInfo && meta.platform_reason && (
            <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${platInfo.cls}`}>
              <span className="text-2xl flex-shrink-0">{platInfo.icon}</span>
              <div>
                <p className="text-[13px] font-bold mb-0.5">למה דווקא {platInfo.label}?</p>
                <p className="text-[12px] opacity-80">{meta.platform_reason}</p>
              </div>
            </div>
          )}

          {/* Recommended action */}
          {(meta.action_label || signal.recommended_action) && (
            <div className="bg-card border border-border rounded-xl px-4 py-3">
              <p className="text-[11px] font-semibold text-foreground-muted mb-1.5">פעולה מומלצת</p>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{ACTION_ICON[meta.action_type] || '⚡'}</span>
                <p className="text-[14px] font-semibold text-foreground">{meta.action_label || signal.recommended_action}</p>
                {meta.time_minutes && (
                  <span className="text-[10px] text-foreground-muted mr-auto">⏱ {meta.time_minutes} דקות</span>
                )}
              </div>
              {signal.recommended_action && meta.action_label && signal.recommended_action !== meta.action_label && (
                <p className="text-[12px] text-foreground-muted">{signal.recommended_action}</p>
              )}
            </div>
          )}

          {/* Prefilled text */}
          {meta.prefilled_text && (
            <div className="bg-card border border-border rounded-xl px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold text-foreground-muted">טקסט מוכן לשימוש</p>
                <button
                  onClick={() => { navigator.clipboard.writeText(meta.prefilled_text); toast.success('הועתק ✓'); }}
                  className="text-[10px] text-foreground-muted hover:text-foreground flex items-center gap-1"
                >
                  <CheckCheck className="w-3 h-3" /> העתק
                </button>
              </div>
              <p className="text-[12px] text-foreground leading-relaxed whitespace-pre-line bg-secondary rounded-lg px-3 py-2">
                {meta.prefilled_text}
              </p>
            </div>
          )}

          {/* Impact reason */}
          {meta.impact_reason && (
            <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
              <span className="text-lg flex-shrink-0">⚠️</span>
              <div>
                <p className="text-[11px] font-semibold text-amber-800 mb-0.5">למה זה חשוב עכשיו?</p>
                <p className="text-[12px] text-amber-700">{meta.impact_reason}</p>
                {meta.urgency_hours && (
                  <p className="text-[10px] text-amber-600 mt-1">פעל תוך {meta.urgency_hours} שעות</p>
                )}
              </div>
            </div>
          )}

          {/* Reasoning chain */}
          {signal.reasoning_chain && (
            <div className="bg-card border border-border rounded-xl px-4 py-3">
              <p className="text-[11px] font-semibold text-foreground-muted mb-2 flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-sm bg-primary/10 inline-flex items-center justify-center text-[8px] text-primary font-bold">AI</span>
                ניתוח מלא
              </p>
              <p className="text-[12px] text-foreground-secondary leading-relaxed whitespace-pre-line">{signal.reasoning_chain}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-2">
            <button onClick={handleAction}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-[13px] font-semibold hover:bg-emerald-700 transition-all">
              ⚡ פעל עכשיו
            </button>
            <button onClick={handleCreateTask} disabled={creatingTask}
              className="flex items-center gap-2 px-4 py-2.5 border border-border text-foreground-muted rounded-xl text-[12px] hover:bg-secondary transition-all disabled:opacity-60">
              {creatingTask ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListPlus className="w-3.5 h-3.5" />}
              צור משימה
            </button>
          </div>
        </div>
      )}

      {/* Tab: Sources */}
      {activeTab === 'sources' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 mb-2">
            <div className="bg-card border border-border rounded-xl px-4 py-3">
              <p className="text-[10px] text-foreground-muted mb-1">זוהה</p>
              <p className="text-[12px] font-medium">{formatDate(signal.detected_at || signal.created_date)}</p>
            </div>
            <div className="bg-card border border-border rounded-xl px-4 py-3">
              <p className="text-[10px] text-foreground-muted mb-1">סוכן</p>
              <p className="text-[12px] font-medium">{signal.agent_name || signal.source_type || 'מערכת'}</p>
            </div>
          </div>

          {signal.confidence && (
            <div className="bg-card border border-border rounded-xl px-4 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] font-semibold text-foreground-muted">רמת ביטחון</p>
                <p className="text-[12px] font-bold text-foreground">{Math.round(signal.confidence)}%</p>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(signal.confidence, 100)}%` }} />
              </div>
            </div>
          )}

          {sourceUrls.length > 0 ? (
            <div>
              <p className="text-[11px] font-semibold text-foreground-muted mb-2">מקורות ({sourceUrls.length})</p>
              <div className="space-y-2">
                {sourceUrls.map((url, i) => {
                  const domain = (() => { try { return new URL(url).hostname.replace('www.', ''); } catch { return url; } })();
                  return (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2.5 px-4 py-3 bg-card border border-border rounded-xl text-[12px] text-primary hover:bg-secondary transition-all group">
                      <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 opacity-50 group-hover:opacity-100" />
                      <span className="flex-1 truncate">{domain}</span>
                      <span className="text-[10px] text-foreground-muted opacity-60 truncate max-w-[200px]">{url}</span>
                    </a>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-foreground-muted text-[12px]">
              <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p>תובנה זו הופקה מניתוח AI פנימי — ללא מקורות חיצוניים</p>
            </div>
          )}
        </div>
      )}

      {/* Tab: Actions */}
      {activeTab === 'actions' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-foreground-muted">משימות שנוצרו מתובנה זו</p>
            <button onClick={handleCreateTask} disabled={creatingTask}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-background rounded-lg text-[11px] font-medium hover:opacity-90 disabled:opacity-60">
              {creatingTask ? <Loader2 className="w-3 h-3 animate-spin" /> : <ListPlus className="w-3 h-3" />}
              הוסף משימה
            </button>
          </div>

          {linkedTasks.length > 0 ? (
            <div className="space-y-2">
              {linkedTasks.map(task => (
                <button key={task.id} onClick={() => navigate(`/tasks/${task.id}`)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-card border border-border rounded-xl text-right hover:bg-secondary transition-all">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    task.status === 'completed' ? 'bg-emerald-500' : task.status === 'in_progress' ? 'bg-blue-500' : 'bg-gray-300'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-foreground truncate">{task.title}</p>
                    <p className="text-[10px] text-foreground-muted">{task.status === 'completed' ? 'הושלם' : task.status === 'in_progress' ? 'בביצוע' : 'ממתין'}</p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    task.priority === 'high' ? 'bg-red-50 text-red-600' : task.priority === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-600'
                  }`}>
                    {task.priority === 'high' ? 'גבוה' : task.priority === 'medium' ? 'בינוני' : 'נמוך'}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-10 text-foreground-muted">
              <ListPlus className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="text-[12px]">אין משימות מחוברות לתובנה זו</p>
              <p className="text-[11px] mt-1">לחץ "הוסף משימה" כדי ליצור אחת</p>
            </div>
          )}
        </div>
      )}

      {showActionPopup && (
        <ActionPopup
          signal={signal}
          businessProfile={businessProfile}
          onClose={() => setShowActionPopup(false)}
        />
      )}
    </div>
  );
}
