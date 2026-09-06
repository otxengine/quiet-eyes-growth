import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useNavigate } from 'react-router-dom';
import { Bell, X, AlertTriangle, Target, TrendingUp, Trophy, Zap, ClipboardList, Copy, CheckCheck, Send, Loader2, Megaphone } from 'lucide-react';
import { toast } from 'sonner';
import ActionPopup from '@/components/ui/ActionPopup';
import FeedbackWidget from '@/components/FeedbackWidget';
import DismissMenu from '@/components/ui/DismissMenu';

const _apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3007/api';
const SERVER_BASE = _apiUrl.replace(/\/api\/?$/, '');

const typeConfig = {
  action_needed:      { icon: Zap,           color: '#ef4444', bg: 'bg-red-50' },
  negative_review:    { icon: AlertTriangle,  color: '#ef4444', bg: 'bg-red-50' },
  opportunity:        { icon: Target,         color: '#10b981', bg: 'bg-green-50' },
  market_opportunity: { icon: TrendingUp,     color: '#10b981', bg: 'bg-green-50' },
  hot_lead:           { icon: Zap,            color: '#f59e0b', bg: 'bg-yellow-50' },
  risk:               { icon: AlertTriangle,  color: '#f59e0b', bg: 'bg-yellow-50' },
  retention_risk:     { icon: AlertTriangle,  color: '#f59e0b', bg: 'bg-yellow-50' },
  competitor_move:    { icon: Trophy,         color: '#6366f1', bg: 'bg-purple-50' },
  competitor_ads:     { icon: Megaphone,      color: '#f97316', bg: 'bg-orange-50' },
  milestone:          { icon: Trophy,         color: '#6366f1', bg: 'bg-purple-50' },
  challenge:          { icon: Trophy,         color: '#ec4899', bg: 'bg-pink-50' },
};

const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

function parseActionMeta(sourceAgent) {
  if (!sourceAgent) return null;
  try { return JSON.parse(sourceAgent); } catch { return null; }
}

function ActionButton({ alert, actionMeta, bpId, onActed }) {
  const [copied, setCopied]     = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished]   = useState(false);

  const handleCopy = async () => {
    if (!actionMeta?.prefilled_text) return;
    try {
      await navigator.clipboard.writeText(actionMeta.prefilled_text);
      setCopied(true);
      toast.success('הטקסט הועתק ✓');
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handlePublish = async () => {
    if (!actionMeta?.prefilled_text || !bpId) return;
    setPublishing(true);
    try {
      // Get auth token (same logic as api/client.js)
      let authToken = null;
      if (window.__clerk?.session) {
        try { authToken = await window.__clerk.session.getToken(); } catch {}
      }
      if (!authToken) authToken = window.__clerk_session_token || localStorage.getItem('clerk_session_token');
      const authHeaders = authToken
        ? { Authorization: `Bearer ${authToken}` }
        : { 'x-dev-user': localStorage.getItem('dev_user_id') || 'dev-user' };

      const res = await fetch(`${SERVER_BASE}/api/functions/publishPost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          businessProfileId: bpId,
          caption: actionMeta.prefilled_text,
          platform: 'both',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה בפרסום');
      setPublished(true);
      toast.success(data.message || 'הפוסט נשלח לפרסום ✓');
      onActed?.();
    } catch (err) {
      toast.error(`שגיאה בפרסום: ${err.message}`);
    } finally {
      setPublishing(false);
    }
  };

  if (!actionMeta?.action_label) return null;

  const { action_type, action_label, prefilled_text } = actionMeta;

  // post_publish — publish directly to Facebook/Instagram
  if (action_type === 'post_publish' && prefilled_text) {
    return (
      <div className="mt-2 space-y-1.5">
        <div className="px-2.5 py-2 rounded-lg bg-white/70 border border-border/40 text-[11px] text-foreground-secondary leading-relaxed">
          {prefilled_text}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePublish}
            disabled={publishing || published}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-white bg-primary hover:bg-primary/90 px-2.5 py-1 rounded-lg transition-all disabled:opacity-60"
          >
            {publishing ? <Loader2 className="w-3 h-3 animate-spin" /> : published ? <CheckCheck className="w-3 h-3" /> : <Send className="w-3 h-3" />}
            {published ? 'פורסם!' : publishing ? 'מפרסם...' : action_label || 'פרסם עכשיו'}
          </button>
          <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] text-foreground-muted hover:text-foreground transition-all">
            {copied ? <CheckCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? 'הועתק' : 'העתק'}
          </button>
        </div>
      </div>
    );
  }

  // promote / social_post (legacy) — copy only
  if ((action_type === 'social_post' || action_type === 'promote') && prefilled_text) {
    return (
      <div className="mt-2 space-y-1.5">
        <div className="px-2.5 py-2 rounded-lg bg-white/70 border border-border/40 text-[11px] text-foreground-secondary leading-relaxed">
          {prefilled_text}
        </div>
        <button onClick={handleCopy}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:opacity-70 transition-all">
          {copied ? <CheckCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'הועתק!' : action_label}
        </button>
      </div>
    );
  }

  // respond — copy text for manual reply
  if (action_type === 'respond' && prefilled_text) {
    return (
      <div className="mt-2 space-y-1.5">
        <div className="px-2.5 py-2 rounded-lg bg-white/70 border border-border/40 text-[11px] text-foreground-secondary leading-relaxed">
          {prefilled_text}
        </div>
        <button onClick={handleCopy}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:opacity-70 transition-all">
          {copied ? <CheckCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'הועתק!' : action_label}
        </button>
      </div>
    );
  }

  return null;
}

export default function ProactiveAlertsPanel({ bpId }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [popupSignal, setPopupSignal] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDismissing, setBulkDismissing] = useState(false);

  const { data: alerts = [] } = useQuery({
    queryKey: ['proactiveAlerts', bpId],
    queryFn: () => base44.entities.ProactiveAlert.filter({ linked_business: bpId, is_dismissed: false }, '-created_at', 10),
    enabled: !!bpId,
    refetchInterval: 60000,
  });

  const dismissMutation = useMutation({
    mutationFn: (id) => base44.entities.ProactiveAlert.update(id, { is_dismissed: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['proactiveAlerts'] }),
  });

  const actMutation = useMutation({
    mutationFn: ({ id, url }) => {
      base44.entities.ProactiveAlert.update(id, { is_acted_on: true });
      return Promise.resolve(url);
    },
    onSuccess: (url) => { if (url) navigate(url); queryClient.invalidateQueries({ queryKey: ['proactiveAlerts'] }); },
  });

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBulkDismiss = async () => {
    if (selectedIds.size === 0) return;
    setBulkDismissing(true);
    try {
      await Promise.all([...selectedIds].map(id =>
        base44.entities.ProactiveAlert.update(id, { is_dismissed: true })
      ));
      queryClient.invalidateQueries({ queryKey: ['proactiveAlerts'] });
      setSelectedIds(new Set());
      setSelectMode(false);
    } catch {
      toast.error('שגיאה במחיקה');
    }
    setBulkDismissing(false);
  };

  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };

  const sorted = [...alerts].sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));

  if (sorted.length === 0) return null;

  return (
    <>
    {popupSignal && (
      <ActionPopup
        signal={popupSignal}
        businessProfile={{ id: bpId }}
        onClose={() => setPopupSignal(null)}
      />
    )}
    <div className="card-base p-5">
      <div className="flex items-center gap-2 mb-4">
        <Bell className="w-4 h-4 text-foreground-muted" />
        <h3 className="text-[13px] font-semibold text-foreground">התראות פרואקטיביות</h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-foreground text-background font-semibold">{sorted.length}</span>

        <div className="flex items-center gap-2 mr-auto">
          {selectMode ? (
            <>
              {selectedIds.size > 0 && (
                <button
                  onClick={handleBulkDismiss}
                  disabled={bulkDismissing}
                  className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-all disabled:opacity-60"
                >
                  {bulkDismissing ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                  מחק נבחרים ({selectedIds.size})
                </button>
              )}
              <button
                onClick={exitSelectMode}
                className="text-[10px] text-foreground-muted hover:text-foreground transition-all px-2 py-1"
              >
                ביטול
              </button>
            </>
          ) : (
            <button
              onClick={() => setSelectMode(true)}
              className="text-[10px] text-foreground-muted hover:text-foreground transition-all px-2 py-1 rounded-lg hover:bg-secondary"
            >
              בחר
            </button>
          )}
        </div>
      </div>
      <div className="space-y-2">
        {sorted.map(alert => {
          const config = typeConfig[alert.alert_type] || typeConfig.action_needed;
          const Icon = config.icon;
          const actionMeta = parseActionMeta(alert.source_agent);
          const isSelected = selectedIds.has(alert.id);

          return (
            <div
              key={alert.id}
              onClick={selectMode ? () => toggleSelect(alert.id) : undefined}
              className={`rounded-xl p-4 border transition-all duration-150 ${
                selectMode
                  ? isSelected
                    ? 'bg-primary/10 border-primary cursor-pointer'
                    : `${config.bg} border-border/40 cursor-pointer hover:border-primary/40`
                  : `${config.bg} border-transparent hover:border-border-hover`
              }`}
            >
              <div className="flex items-start gap-2.5">
                {selectMode ? (
                  <div className={`w-4 h-4 rounded border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-all ${isSelected ? 'bg-primary border-primary' : 'border-border'}`}>
                    {isSelected && <CheckCheck className="w-2.5 h-2.5 text-white" />}
                  </div>
                ) : (
                  <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: config.color }} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-foreground leading-snug">{alert.title}</p>
                  {alert.description && <p className="text-[11px] text-foreground-secondary mt-1 leading-relaxed">{alert.description}</p>}

                  {!selectMode && (
                    <>
                      <ActionButton
                        alert={alert}
                        actionMeta={actionMeta}
                        bpId={bpId}
                        onActed={() => actMutation.mutate({ id: alert.id, url: null })}
                      />
                      <div className="flex items-center gap-2.5 mt-2">
                        {alert.suggested_action && !actionMeta?.prefilled_text && (
                          <span className="text-[11px] text-foreground-secondary">{alert.suggested_action}</span>
                        )}
                        {actionMeta?.action_label && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              actMutation.mutate({ id: alert.id, url: null });
                              setPopupSignal({
                                id: alert.id,
                                summary: alert.description || alert.title,
                                recommended_action: actionMeta.action_label,
                                source_description: JSON.stringify({
                                  action_label: actionMeta.action_label,
                                  action_type: actionMeta.action_type || 'task',
                                  prefilled_text: actionMeta.prefilled_text || '',
                                  time_minutes: actionMeta.action_type === 'call' ? 10 : actionMeta.action_type === 'social_post' ? 15 : 20,
                                  urgency_hours: actionMeta.urgency_hours || 24,
                                }),
                                impact_level: alert.priority === 'high' || alert.priority === 'critical' ? 'high' : 'medium',
                              });
                            }}
                            className="flex items-center gap-1 text-[10px] font-semibold text-primary hover:text-primary transition-all"
                          >
                            <Zap className="w-3 h-3" /> פעל עכשיו
                          </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); navigate(`/tasks?from_alert=${alert.id}&title=${encodeURIComponent(actionMeta?.action_label || alert.suggested_action || alert.title)}&desc=${encodeURIComponent(alert.description || '')}&priority=${alert.priority === 'critical' ? 'critical' : alert.priority === 'high' ? 'high' : 'medium'}`); }}
                          className="btn-subtle flex items-center gap-1 text-[10px] font-medium text-foreground-muted hover:text-foreground transition-all">
                          <ClipboardList className="w-3 h-3" /> הפוך למשימה
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/insights/alert-${alert.id}`); }}
                          className="flex items-center gap-1 text-[10px] font-medium text-foreground-muted hover:text-primary transition-all"
                        >
                          פתח תובנה מלאה
                        </button>
                        <FeedbackWidget
                          agentName={alert.source_agent || 'generateProactiveAlerts'}
                          outputType="alert"
                          businessProfileId={bpId}
                          compact={true}
                        />
                      </div>
                    </>
                  )}
                </div>
                {!selectMode && (
                  <DismissMenu
                    entityType="alert"
                    entityId={alert.id}
                    title={alert.title}
                    businessProfileId={bpId}
                    onDismissed={() => dismissMutation.mutate(alert.id)}
                    buttonLabel=""
                    buttonClassName="p-1 rounded-md text-foreground-muted/40 hover:text-foreground-muted hover:bg-white/50 transition-all flex items-center"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
    </>
  );
}
