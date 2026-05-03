import React, { useState, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import AgentCard from '@/components/agents/AgentCard';
import ChannelStatusCard from '@/components/agents/ChannelStatusCard';
import HealthScoreCard from '@/components/agents/HealthScoreCard';
import ProactiveAlertsPanel from '@/components/agents/ProactiveAlertsPanel';
import PredictionCard from '@/components/agents/PredictionCard';
import AiInsightBox from '@/components/ai/AiInsightBox';
import DataQualityDashboard from '@/components/agents/DataQualityDashboard';
import BusinessMemoryCard from '@/components/agents/BusinessMemoryCard';
import RiskMatrix from '@/components/agents/RiskMatrix';

const agentConfigs = [
  {
    name: 'העיניים', nameEn: 'Eyeni',
    functionName: 'collectWebSignals',
    intervalHours: 4,
    description: 'סוכן מודיעין ראשי. סורק אתרים, חדשות, ביקורות ומדריכים כל 4 שעות. תומך במילות מפתח וכתובות URL מותאמות.',
    lastRunLabel: 'סריקה אחרונה',
    entityCount: 'RawSignal',
  },
  {
    name: 'הסושיאל', nameEn: 'Social',
    functionName: 'collectSocialSignals',
    intervalHours: 4,
    description: 'סורק רשתות חברתיות כל 4 שעות — אזכורים, ביקורות, טרנדים בפייסבוק, אינסטגרם וטיקטוק. עוקב גם אחר מתחרים ברשתות.',
    lastRunLabel: 'סריקה אחרונה',
    entityCount: 'RawSignalSocial',
  },
  {
    name: 'המנתח', nameEn: 'Analyzer',
    functionName: 'runMarketIntelligence',
    intervalHours: 4,
    description: 'מנתח אותות מהאינטרנט ומרשתות חברתיות. מייצר תובנות שוק עם ניתוח סנטימנט מורחב.',
    lastRunLabel: 'ניתוח אחרון',
    entityCount: 'MarketSignal',
  },
  {
    name: 'הצופה', nameEn: 'Tracker',
    functionName: 'runCompetitorIdentification',
    intervalHours: 8,
    description: 'מזהה ועוקב אחר מתחרים כל 8 שעות. כולל מעקב נוכחות חברתית, דירוגים ומהלכים תחרותיים.',
    lastRunLabel: 'מעקב אחרון',
    entityCount: 'Competitor',
  },
  {
    name: 'המסנן', nameEn: 'Filter',
    functionName: 'runLeadGeneration',
    intervalHours: 6,
    description: 'מייצר ומעשיר לידים כל 6 שעות. ניקוד, סיווג, העשרת AI, והודעות מותאמות.',
    lastRunLabel: 'סינון אחרון',
    entityCount: 'Lead',
    enrichFunction: 'enrichLeads',
  },
  {
    name: 'הזיכרון', nameEn: 'Memory',
    functionName: 'updateSectorKnowledge',
    intervalHours: 12,
    description: 'מבצע סינתזת ידע, מזהה פערי מידע, יוצר קישורים מוצלבים ומשלים מידע חסר באופן אוטומטי.',
    lastRunLabel: 'עדכון אחרון',
    entityCount: 'SectorKnowledge',
    gapFunction: 'identifyKnowledgeGaps',
  },
  {
    name: 'החזאי', nameEn: 'Predictor',
    functionName: 'runPredictions',
    intervalHours: 24,
    description: 'חיזוי מגמות שוק, סיכויי סגירת עסקאות, ניתוח תרחישים, וזיהוי נטישת לקוחות.',
    lastRunLabel: 'חיזוי אחרון',
    entityCount: 'Prediction',
  },
  {
    name: 'המפקח', nameEn: 'Supervisor',
    functionName: 'generateProactiveAlerts',
    intervalHours: 6,
    description: 'מזהה מצבים שדורשים תגובה, יוצר התראות, אתגרים יומיים ומנטר את אינדקס הבריאות.',
    lastRunLabel: 'בדיקה אחרונה',
    entityCount: 'ProactiveAlert',
    healthFunction: 'calculateHealthScore',
  },
  {
    name: 'הצייד', nameEn: 'Hunter',
    functionName: 'findSocialLeads',
    intervalHours: 6,
    description: 'סורק קבוצות פייסבוק, אינסטגרם ופורומים כל 6 שעות ומחפש אנשים שמחפשים שירותים. יוצר לידים עם הודעה מוכנה לשליחה.',
    lastRunLabel: 'סריקה אחרונה',
    entityCount: 'Lead',
  },
  {
    name: 'המנקה', nameEn: 'Cleaner',
    functionName: 'applyDataFreshness',
    intervalHours: 24,
    description: 'מנקה ומעדכן את מסד הנתונים מדי יום — מארכב לידים ישנים, מסמן ביקורות היסטוריות, ומזהה לקוחות לאיחזור.',
    lastRunLabel: 'ניקוי אחרון',
    entityCount: 'Lead',
  },
  {
    name: 'המוח', nameEn: 'Brain',
    functionName: 'runMLLearning',
    intervalHours: 24,
    description: 'מנוע ML מרכזי — לומד מניצחונות ונפילות, מנתח ביקורות, מייצר תובנות cross-agent ומדרג לידים חכם יותר.',
    lastRunLabel: 'למידה אחרונה',
    entityCount: 'SectorKnowledge',
  },

  // ── Layer 7: OTX Advanced Agents ──────────────────────────────────────────
  {
    name: 'הקטליזטור הוויראלי', nameEn: 'Viral',
    functionName: 'runViralCatalyst',
    intervalHours: 4,
    description: 'סורק תבניות ויראליות בטיקטוק, אינסטגרם ופייסבוק. מייצר סקריפטים בעברית לפוסטים ויראליים מותאמים לסקטור.',
    lastRunLabel: 'סריקה אחרונה',
    layer: 7,
  },
  {
    name: 'בודק האמינות', nameEn: 'Integrity',
    functionName: 'runInfluenceIntegrity',
    intervalHours: 6,
    description: 'מנתח מגמות וטרנדים לזיהוי מניפולציה — botScore, coordinationScore. מוציא verdict: organic/suspicious/manipulated.',
    lastRunLabel: 'ניתוח אחרון',
    layer: 7,
  },
  {
    name: 'ראיית ההקשר', nameEn: 'Vision',
    functionName: 'runDeepContextVision',
    intervalHours: 6,
    description: 'ניתוח תמונות ומדיה ויזואלית של מתחרים ולקוחות עם Claude Vision. מזהה ביקוש שלא מסופק ותובנות עסקיות חזותיות.',
    lastRunLabel: 'ניתוח אחרון',
    layer: 7,
  },
  {
    name: 'שומר השימור', nameEn: 'Retention',
    functionName: 'runRetentionSentinel',
    intervalHours: 3,
    description: 'מזהה לקוחות בסיכון עזיבה — ניתוח פעילות, אותות חיצוניים, ומייצר הצעות שימור אוטומטיות.',
    lastRunLabel: 'בדיקה אחרונה',
    layer: 7,
  },
  {
    name: 'מאמן התמחור', nameEn: 'Pricing',
    functionName: 'runNegotiationPricing',
    intervalHours: 6,
    description: 'המלצות תמחור דינמיות בזמן אמת — ניתוח היצע/ביקוש, פרופיל הליד, מחירי מתחרים. כל המלצה עם valid_until.',
    lastRunLabel: 'המלצה אחרונה',
    layer: 7,
  },
  {
    name: 'הטייס האוטומטי', nameEn: 'Autopilot',
    functionName: 'runCampaignAutopilot',
    intervalHours: 8,
    description: 'יוצר טיוטות קמפיין בהתבסס על אירועים ואותות שוק — headline, body, CTA, קהל יעד. auto_publish=false תמיד.',
    lastRunLabel: 'טיוטה אחרונה',
    layer: 7,
  },
  {
    name: 'סייר ההרחבה', nameEn: 'Expansion',
    functionName: 'runExpansionScout',
    intervalHours: 168,
    description: 'מנתח אשכולות ביקוש שלא מסופק. מזהה הזדמנויות שירות חדשות עם הערכת ROI. רץ כל ראשון 04:00.',
    lastRunLabel: 'ניתוח אחרון',
    layer: 7,
  },
  {
    name: 'חדר המלחמה', nameEn: 'Reputation',
    functionName: 'runReputationWarRoom',
    intervalHours: 0.5,
    description: 'ניטור מוניטין 24/7 — מזהה ספייק ביקורות שליליות, תלונות ויראליות, מתקפות מתחרים. תמיד P1 בבאס.',
    lastRunLabel: 'בדיקה אחרונה',
    layer: 7,
  },
];

export default function Agents() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [runningAgent, setRunningAgent] = useState(null);
  const [agentResults, setAgentResults] = useState({}); // { [nameEn]: { ok, message } }

  const { data: counts = {} } = useQuery({
    queryKey: ['agentCounts', bpId],
    queryFn: async () => {
      const [rawSignals, socialSignals, signals, competitors, leads, sector, predictions, alerts] = await Promise.all([
        base44.entities.RawSignal.filter({ linked_business: bpId, signal_type: 'web_search' }, '-detected_at', 1),
        base44.entities.RawSignal.filter({ linked_business: bpId }, '-detected_at', 5),
        base44.entities.MarketSignal.filter({ linked_business: bpId }, '-detected_at', 1),
        base44.entities.Competitor.filter({ linked_business: bpId }),
        base44.entities.Lead.filter({ linked_business: bpId }, '-created_date', 1),
        base44.entities.SectorKnowledge.filter({}),
        base44.entities.Prediction.filter({ linked_business: bpId }, '-predicted_at', 1),
        base44.entities.ProactiveAlert.filter({ linked_business: bpId, is_dismissed: false }),
      ]);
      const socialOnly = socialSignals.filter(s => s.signal_type !== 'web_search');
      return {
        RawSignal: { count: rawSignals.length, lastDate: rawSignals[0]?.detected_at || rawSignals[0]?.created_date },
        RawSignalSocial: { count: socialOnly.length, lastDate: socialOnly[0]?.detected_at || socialOnly[0]?.created_date },
        MarketSignal: { count: signals.length, lastDate: signals[0]?.detected_at || signals[0]?.created_date },
        Competitor: { count: competitors.length, lastDate: competitors[0]?.last_scanned || competitors[0]?.created_date },
        Lead: { count: leads.length, lastDate: leads[0]?.created_at || leads[0]?.created_date },
        SectorKnowledge: { count: sector.length, lastDate: sector[0]?.last_updated || sector[0]?.created_date },
        Prediction: { count: predictions.length, lastDate: predictions[0]?.predicted_at || predictions[0]?.created_date },
        ProactiveAlert: { count: alerts.length, lastDate: alerts[0]?.created_at || alerts[0]?.created_date },
      };
    },
    enabled: !!bpId,
    refetchInterval: 60000,
  });

  // Fetch real automation logs
  const { data: automationLogs = [] } = useQuery({
    queryKey: ['automationLogs', bpId],
    queryFn: () => base44.entities.AutomationLog.filter({ linked_business: bpId }, '-start_time', 50),
    enabled: !!bpId,
    refetchInterval: 60000,
  });

  const agentsWithStatus = agentConfigs.map(config => {
    const entityData = counts[config.entityCount];
    // Find latest log for this agent
    const logs = automationLogs.filter(l => l.automation_name === config.functionName);
    const latestLog = logs[0];
    const automation = {
      last_run_at: latestLog?.start_time || entityData?.lastDate,
      last_run_status: latestLog?.status || (entityData?.lastDate ? 'success' : null),
      total_runs: entityData?.count || 0,
      successful_runs: entityData?.count || 0,
      items_processed: latestLog?.items_processed || 0,
    };
    return { ...config, automation };
  });

  // Check if agents are stale (no run in 8 hours)
  const eightHoursAgo = new Date(Date.now() - 8 * 3600000).toISOString();
  const latestAnyRun = automationLogs[0]?.start_time;
  const agentsStale = !latestAnyRun || latestAnyRun < eightHoursAgo;

  const { data: predictions = [] } = useQuery({
    queryKey: ['predictions', bpId],
    queryFn: () => base44.entities.Prediction.filter({ linked_business: bpId, status: 'active' }, '-predicted_at', 10),
    enabled: !!bpId,
  });

  const { data: sectorData = [] } = useQuery({
    queryKey: ['sectorMemory', businessProfile?.category],
    queryFn: () => base44.entities.SectorKnowledge.filter({}),
    enabled: !!businessProfile?.category,
  });
  const sk = sectorData.find(s => s.sector === businessProfile?.category);
  const allEpisodes = (() => { try { return JSON.parse(sk?.agent_episodic_memory || '[]'); } catch { return []; } })();
  const allScores = (() => { try { return JSON.parse(sk?.agent_prompt_scores || '{}'); } catch { return {}; } })();
  const pendingMessages = (() => {
    try {
      const msgs = JSON.parse(sk?.agent_message_queue || '[]');
      return msgs.filter(m => !m.acted_on && m.expires_at > new Date().toISOString());
    } catch { return []; }
  })();

  const handleRunAgent = useCallback(async (agent) => {
    if (!bpId || runningAgent) return;
    setRunningAgent(agent.nameEn);
    // Clear previous result for this agent
    setAgentResults(prev => ({ ...prev, [agent.nameEn]: null }));

    try {
      const API_BASE = import.meta.env.VITE_API_URL || '/api';
      const token = window.__clerk?.session
        ? await window.__clerk.session.getToken().catch(() => null)
        : null;
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : { 'x-dev-user': localStorage.getItem('dev_user_id') || 'dev-user' }),
      };

      const res = await fetch(`${API_BASE}/agents/trigger`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ agentName: agent.functionName, businessProfileId: bpId }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 429) {
        // Rate limited
        const msg = data.error || 'המתן לפני הפעלה מחדש';
        setAgentResults(prev => ({ ...prev, [agent.nameEn]: { ok: false, message: msg } }));
        toast.error(msg);
      } else if (!res.ok) {
        const msg = data.error || `שגיאה ${res.status}`;
        setAgentResults(prev => ({ ...prev, [agent.nameEn]: { ok: false, message: msg } }));
        toast.error(`שגיאה ב${agent.name}: ${msg}`);
      } else {
        // Build a result summary from the response
        const parts = [];
        if (data.new_signals != null) parts.push(`${data.new_signals} אותות חדשים`);
        if (data.signals_processed != null) parts.push(`${data.signals_processed} אותות עובדו`);
        if (data.insights_generated != null) parts.push(`${data.insights_generated} תובנות חדשות`);
        if (data.leads_created != null) parts.push(`${data.leads_created} לידים חדשים`);
        if (data.leads_updated != null) parts.push(`${data.leads_updated} לידים עודכנו`);
        if (data.leads_archived != null && data.leads_archived > 0) parts.push(`${data.leads_archived} ארכיב`);
        if (data.leads_deduplicated != null && data.leads_deduplicated > 0) parts.push(`${data.leads_deduplicated} כפילויות הוסרו`);
        if (data.items_created != null) parts.push(`${data.items_created} פריטים`);
        if (data.deals_analyzed != null) parts.push(`${data.deals_analyzed} עסקאות נותחו`);
        const totalCount = (data.new_signals ?? 0) + (data.leads_created ?? 0) + (data.leads_updated ?? 0) + (data.leads_archived ?? 0) + (data.leads_deduplicated ?? 0) + (data.items_created ?? 0) + (data.insights_generated ?? 0) + (data.deals_analyzed ?? 0);
        const summaryText = data.message || (parts.length > 0 ? parts.join(' · ') : 'הסוכן סיים בהצלחה');
        setAgentResults(prev => ({ ...prev, [agent.nameEn]: { ok: true, message: summaryText, count: totalCount || null } }));
        toast.success(`${agent.name} סיים: ${summaryText} ✓`);

        // Invalidate queries to refresh counts
        queryClient.invalidateQueries({ queryKey: ['agentCounts'] });
        queryClient.invalidateQueries({ queryKey: ['predictions'] });
        queryClient.invalidateQueries({ queryKey: ['proactiveAlerts'] });
        queryClient.invalidateQueries({ queryKey: ['healthScore'] });
        queryClient.invalidateQueries({ queryKey: ['automationLogs'] });
      }

      // Run sub-functions (non-blocking, best-effort)
      if (agent.enrichFunction) base44.functions.invoke(agent.enrichFunction, { businessProfileId: bpId }).catch(() => null);
      if (agent.gapFunction) base44.functions.invoke(agent.gapFunction, { businessProfileId: bpId }).catch(() => null);
      if (agent.healthFunction) base44.functions.invoke(agent.healthFunction, { businessProfileId: bpId }).catch(() => null);

    } catch (err) {
      const msg = err.message || 'שגיאה לא ידועה';
      setAgentResults(prev => ({ ...prev, [agent.nameEn]: { ok: false, message: msg } }));
      toast.error(`שגיאה ב${agent.name}: ${msg}`);
    }

    setRunningAgent(null);
  }, [bpId, runningAgent, queryClient]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[16px] font-bold text-foreground tracking-tight">סוכנים</h1>
        <p className="text-[12px] text-foreground-muted mt-0.5">19 סוכנים חכמים עובדים בשבילך 24/7</p>
      </div>

      {agentsStale && (
        <div className="flex items-center gap-2 px-4 py-3 bg-danger/5 border border-danger/20 rounded-lg">
          <span className="text-[13px]">⚠️</span>
          <p className="text-[12px] font-medium text-danger">הסוכנים לא רצו מזה 8 שעות — בדוק הגדרות</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <ChannelStatusCard businessProfile={businessProfile} />
          <ProactiveAlertsPanel bpId={bpId} />
        </div>
        <div className="space-y-4">
          <HealthScoreCard bpId={bpId} />
          <BusinessMemoryCard bpId={bpId} />
          <RiskMatrix bpId={bpId} />
          <DataQualityDashboard bpId={bpId} />
        </div>
      </div>

      <AiInsightBox
        title="אופטימיזציה של סוכנים — המלצות AI"
        prompt={`אתה מנהל מערכת AI. נתח את ביצועי 19 הסוכנים של "${businessProfile?.name}" (${businessProfile?.category}):
${agentsWithStatus.map(a => `- ${a.name} (${a.nameEn}): ${a.automation?.total_runs || 0} רשומות, ריצה אחרונה: ${a.automation?.last_run_at || 'לא רץ'}`).join('\n')}
מקורות מידע: חיפוש רשת, רשתות חברתיות (פייסבוק, אינסטגרם, טיקטוק), מילות מפתח מותאמות, URLs מותאמים, ניטור מתחרים חברתי.
הצע: 1) אילו סוכנים צריכים לרוץ בתדירות גבוהה יותר 2) שיפורים לדיוק ולמקורות מידע 3) שילובים בין סוכנים. בעברית, Markdown.`}
      />

      {/* Memory Dashboard */}
      {(allEpisodes.length > 0 || pendingMessages.length > 0) && (
        <div className="space-y-3">
          <h2 className="text-[14px] font-semibold text-foreground">זיכרון סוכנים</h2>

          {/* Pending cross-agent messages */}
          {pendingMessages.length > 0 && (
            <div className="card-lifted rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-foreground">הודעות בין-סוכניות ממתינות</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{pendingMessages.length}</span>
              </div>
              <div className="space-y-1.5">
                {pendingMessages.slice(0, 5).map((msg, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-background border border-border/50">
                    <span className={`mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                      msg.priority === 'critical' ? 'bg-danger/15 text-danger' :
                      msg.priority === 'high' ? 'bg-warning/15 text-warning' :
                      'bg-muted text-foreground-muted'
                    }`}>{msg.priority}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-medium text-foreground">{msg.from_agent}</span>
                        <span className="text-[10px] text-foreground-muted">→</span>
                        <span className="text-[11px] font-medium text-primary">{msg.to_agent === 'all' ? 'כולם' : msg.to_agent}</span>
                        <span className="text-[11px] text-foreground-muted truncate">{msg.subject}</span>
                      </div>
                      {msg.body && <p className="text-[11px] text-foreground-muted mt-0.5 line-clamp-1">{msg.body}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Agent quality scores */}
          {Object.keys(allScores).length > 0 && (
            <div className="card-lifted rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[13px] font-semibold text-foreground">ציוני איכות סוכנים</span>
                <span className="text-[11px] text-foreground-muted">{sk?.data_points_count ? `${sk.data_points_count.toLocaleString()} נקודות נתונים` : ''}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(allScores).map(([agentName, score]) => (
                  <div key={agentName} className="flex flex-col gap-1 px-3 py-2 rounded-lg bg-background border border-border/50">
                    <span className="text-[11px] font-medium text-foreground truncate">{agentName}</span>
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${score.avg_quality || 0}%`,
                            background: score.avg_quality >= 70 ? 'hsl(var(--success))' : score.avg_quality >= 50 ? 'hsl(var(--warning))' : 'hsl(var(--danger))',
                          }}
                        />
                      </div>
                      <span className="text-[11px] font-bold tabular-nums" style={{
                        color: score.avg_quality >= 70 ? 'hsl(var(--success))' : score.avg_quality >= 50 ? 'hsl(var(--warning))' : 'hsl(var(--danger))',
                      }}>{score.avg_quality || 0}</span>
                    </div>
                    <span className="text-[10px] text-foreground-muted">{score.run_count || 0} ריצות</span>
                    {score.improvement_notes?.length > 0 && (
                      <p className="text-[10px] text-foreground-muted line-clamp-2 mt-0.5 border-t border-border/30 pt-1">
                        💡 {score.improvement_notes[score.improvement_notes.length - 1]}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Last 6 episodes */}
          {allEpisodes.length > 0 && (
            <div className="card-lifted rounded-xl p-4">
              <span className="text-[13px] font-semibold text-foreground block mb-3">אפיזודות אחרונות</span>
              <div className="space-y-2">
                {allEpisodes.slice(0, 6).map((ep, i) => (
                  <div key={i} className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-background border border-border/50">
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      <span className="text-[11px] font-bold text-foreground-muted">{ep.agent}</span>
                      <div className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full font-semibold" style={{
                        background: ep.data_quality >= 70 ? 'hsl(var(--success)/0.1)' : ep.data_quality >= 50 ? 'hsl(var(--warning)/0.1)' : 'hsl(var(--danger)/0.1)',
                        color: ep.data_quality >= 70 ? 'hsl(var(--success))' : ep.data_quality >= 50 ? 'hsl(var(--warning))' : 'hsl(var(--danger))',
                      }}>{ep.data_quality || 0}%</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-foreground font-medium truncate">{ep.run_summary}</p>
                      <p className="text-[10px] text-foreground-muted mt-0.5">
                        {new Date(ep.timestamp).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        {ep.signals_count ? ` · ${ep.signals_count} אותות` : ''}
                      </p>
                      {ep.watch_next?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {ep.watch_next.filter(Boolean).slice(0, 2).map((w, j) => (
                            <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/8 text-primary truncate max-w-[160px]">{w}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Core Agents (Layer 1–4) */}
      <div>
        <h2 className="text-[13px] font-semibold text-foreground mb-3">סוכני ליבה</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {agentsWithStatus.filter(a => !a.layer).map((agent) => (
            <AgentCard
              key={agent.nameEn}
              agent={agent}
              isRunning={runningAgent === agent.nameEn}
              onRun={() => handleRunAgent(agent)}
              lastRunResult={agentResults[agent.nameEn] ?? null}
            />
          ))}
        </div>
      </div>

      {/* Layer 7 Advanced Agents */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-[13px] font-semibold text-foreground">סוכני Layer 7 — מתקדמים</h2>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">OTX Engine</span>
          <span className="text-[10px] text-foreground-muted">מופעלים דרך Deno scheduler</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {agentsWithStatus.filter(a => a.layer === 7).map((agent) => (
            <AgentCard
              key={agent.nameEn}
              agent={agent}
              isRunning={runningAgent === agent.nameEn}
              onRun={() => handleRunAgent(agent)}
              lastRunResult={agentResults[agent.nameEn] ?? null}
            />
          ))}
        </div>
      </div>

      {predictions.length > 0 && (
        <div>
          <h2 className="text-[14px] font-semibold text-foreground mb-3">חיזויים פעילים</h2>
          <div className="space-y-2">
            {predictions.map(p => <PredictionCard key={p.id} prediction={p} />)}
          </div>
        </div>
      )}
    </div>
  );
}