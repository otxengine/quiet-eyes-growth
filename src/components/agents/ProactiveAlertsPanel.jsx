import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useNavigate } from 'react-router-dom';
import { Bell, X, AlertTriangle, Target, TrendingUp, Trophy, Zap, ClipboardList, Copy, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import ActionPopup from '@/components/ui/ActionPopup';
import FeedbackWidget from '@/components/FeedbackWidget';

const typeConfig = {
  action_needed:      { icon: Zap,           color: '#ef4444', bg: 'bg-red-50' },
  negative_review:    { icon: AlertTriangle,  color: '#ef4444', bg: 'bg-red-50' },
  opportunity:        { icon: Target,         color: '#10b981', bg: 'bg-green-50' },
  market_opportunity: { icon: TrendingUp,     color: '#10b981', bg: 'bg-green-50' },
  hot_lead:           { icon: Zap,            color: '#f59e0b', bg: 'bg-yellow-50' },
  risk:               { icon: AlertTriangle,  color: '#f59e0b', bg: 'bg-yellow-50' },
  retention_risk:     { icon: AlertTriangle,  color: '#f59e0b', bg: 'bg-yellow-50' },
  competitor_move:    { icon: Trophy,         color: '#6366f1', bg: 'bg-purple-50' },
  milestone:          { icon: Trophy,         color: '#6366f1', bg: 'bg-purple-50' },
  challenge:          { icon: Trophy,         color: '#ec4899', bg: 'bg-pink-50' },
};

const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

function parseActionMeta(sourceAgent) {
  if (!sourceAgent) return null;
  try { return JSON.parse(sourceAgent); } catch { return null; }
}

function ActionButton({ alert, actionMeta, onActed }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!actionMeta?.prefilled_text) return;
    try {
      await navigator.clipboard.writeText(actionMeta.prefilled_text);
      setCopied(true);
      toast.success('הטקסט הועתק ✓');
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  if (!actionMeta?.action_label) return null;

  const { action_type, action_label, prefilled_text } = actionMeta;

  // Social post / promote — show copy button for prefilled text
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

  // Reply/respond — show content + copy
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
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-foreground text-background font-semibold mr-auto">{sorted.length}</span>
      </div>
      <div className="space-y-2">
        {sorted.map(alert => {
          const config = typeConfig[alert.alert_type] || typeConfig.action_needed;
          const Icon = config.icon;
          const actionMeta = parseActionMeta(alert.source_agent);

          return (
            <div key={alert.id} className={`rounded-xl p-4 ${config.bg} border border-transparent hover:border-border-hover transition-all duration-150`}>
              <div className="flex items-start gap-2.5">
                <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: config.color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-foreground leading-snug">{alert.title}</p>
                  {alert.description && <p className="text-[11px] text-foreground-secondary mt-1 leading-relaxed">{alert.description}</p>}

                  {/* Inline action with prefilled text */}
                  <ActionButton
                    alert={alert}
                    actionMeta={actionMeta}
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
                        className="flex items-center gap-1 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 transition-all"
                      >
                        <Zap className="w-3 h-3" /> פעל עכשיו
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); navigate(`/tasks?from_alert=${alert.id}&title=${encodeURIComponent(actionMeta?.action_label || alert.suggested_action || alert.title)}&desc=${encodeURIComponent(alert.description || '')}&priority=${alert.priority === 'critical' ? 'critical' : alert.priority === 'high' ? 'high' : 'medium'}`); }}
                      className="btn-subtle flex items-center gap-1 text-[10px] font-medium text-foreground-muted hover:text-foreground transition-all">
                      <ClipboardList className="w-3 h-3" /> הפוך למשימה
                    </button>
                    <FeedbackWidget
                      agentName={alert.source_agent || 'generateProactiveAlerts'}
                      outputType="alert"
                      businessProfileId={bpId}
                      compact={true}
                    />
                  </div>
                </div>
                <button onClick={() => dismissMutation.mutate(alert.id)} className="p-1 rounded-md text-foreground-muted/40 hover:text-foreground-muted hover:bg-white/50 transition-all">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
    </>
  );
}
