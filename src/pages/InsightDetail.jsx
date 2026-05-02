import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Lightbulb, Zap, Target, TrendingUp, AlertTriangle, Trophy,
  ArrowRight, CheckCircle2, Circle, ClipboardList, ChevronLeft,
  Loader2, Clock, CheckCheck, Bot, Send, ChevronDown, ChevronUp,
  Sparkles, RotateCcw, Database
} from 'lucide-react';
import { toast } from 'sonner';
import { fetchBusinessSnapshot, snapshotToPromptContext } from '@/lib/businessSnapshot';
import { getActionsForInsight, getRelevantSnapshotContext } from '@/lib/insightActions';
import ActionChip from '@/components/insights/ActionChip';

// ── Meta configs ────────────────────────────────────────────────────────────

const TYPE_META = {
  action_needed:      { label: 'פעולה נדרשת',   color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-100',    icon: Zap },
  negative_review:    { label: 'ביקורת שלילית', color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-100',    icon: AlertTriangle },
  opportunity:        { label: 'הזדמנות',        color: 'text-green-600',  bg: 'bg-green-50',  border: 'border-green-100',  icon: Target },
  market_opportunity: { label: 'הזדמנות שוק',   color: 'text-green-600',  bg: 'bg-green-50',  border: 'border-green-100',  icon: TrendingUp },
  risk:               { label: 'סיכון',          color: 'text-amber-600',  bg: 'bg-amber-50',  border: 'border-amber-100',  icon: AlertTriangle },
  retention_risk:     { label: 'סיכון שימור',   color: 'text-amber-600',  bg: 'bg-amber-50',  border: 'border-amber-100',  icon: AlertTriangle },
  competitor_move:    { label: 'מהלך מתחרה',    color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-100', icon: Trophy },
  milestone:          { label: 'אבן דרך',        color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-100', icon: Trophy },
  hot_lead:           { label: 'ליד חם',         color: 'text-amber-600',  bg: 'bg-amber-50',  border: 'border-amber-100',  icon: Zap },
  competitive:        { label: 'תחרותי',         color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-100', icon: Target },
  defensive:          { label: 'הגנתי',          color: 'text-amber-600',  bg: 'bg-amber-50',  border: 'border-amber-100',  icon: AlertTriangle },
  general:            { label: 'כללי',           color: 'text-blue-600',   bg: 'bg-blue-50',   border: 'border-blue-100',   icon: Lightbulb },
};

const PRIORITY_BADGE = {
  critical: { label: 'קריטי', color: 'text-red-700',    bg: 'bg-red-100',    dot: 'bg-red-500' },
  high:     { label: 'גבוה',  color: 'text-orange-700', bg: 'bg-orange-100', dot: 'bg-orange-400' },
  medium:   { label: 'בינוני',color: 'text-yellow-700', bg: 'bg-yellow-100', dot: 'bg-yellow-400' },
  low:      { label: 'נמוך',  color: 'text-gray-600',   bg: 'bg-gray-100',   dot: 'bg-gray-300' },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseSteps(text) {
  if (!text) return [];
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const steps = lines.map(l => l.replace(/^[\d]+[.)]\s*/, '').replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
  return steps.length > 1 ? steps : (text.trim() ? [text.trim()] : []);
}

function useStepChecks(insightId, count) {
  const key = `insight_steps_${insightId}`;
  const [checks, setChecks] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem(key) || 'null');
      if (Array.isArray(s) && s.length === count) return s;
    } catch {}
    return Array(count).fill(false);
  });
  useEffect(() => {
    if (checks.length !== count) setChecks(Array(count).fill(false));
  }, [count]); // eslint-disable-line
  const toggle = (i) => setChecks(prev => {
    const n = [...prev]; n[i] = !n[i];
    try { localStorage.setItem(key, JSON.stringify(n)); } catch {}
    return n;
  });
  return { checks, toggle };
}

// ── Status Timeline ──────────────────────────────────────────────────────────

function StatusTimeline({ status, isActedOn }) {
  const stages = [
    { key: 'proposed',    label: 'הוצע' },
    { key: 'in_progress', label: 'בביצוע' },
    { key: 'completed',   label: 'הושלם' },
  ];
  const idx = isActedOn ? 2 : status === 'in_progress' ? 1 : status === 'completed' ? 2 : 0;
  return (
    <div className="flex items-center">
      {stages.map((s, i) => (
        <React.Fragment key={s.key}>
          <div className="flex flex-col items-center">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all
              ${i <= idx ? 'bg-primary border-primary' : 'bg-white border-border'}`}>
              {i <= idx
                ? <CheckCheck className="w-3.5 h-3.5 text-white" />
                : <div className="w-2 h-2 rounded-full bg-border" />}
            </div>
            <span className={`text-[10px] mt-1 font-medium ${i === idx ? 'text-primary' : i < idx ? 'text-foreground-secondary' : 'text-foreground-muted'}`}>
              {s.label}
            </span>
          </div>
          {i < stages.length - 1 && (
            <div className={`h-0.5 flex-1 mx-1 mb-4 ${i < idx ? 'bg-primary' : 'bg-border'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── AI Agent Advisor ─────────────────────────────────────────────────────────

const GUIDANCE_SCHEMA = {
  type: 'object',
  properties: {
    steps:     { type: 'array', items: { type: 'string' } },
    quick_win: { type: 'string' },
    tip:       { type: 'string' },
  },
  required: ['steps', 'quick_win'],
};

// Chat response schema — text + optional action buttons
const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    text:    { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          type:  { type: 'string', enum: ['navigate', 'execute', 'external'] },
          url:   { type: 'string' },
          href:  { type: 'string' },
          fn:    { type: 'string' },
          icon:  { type: 'string' },
          params: { type: 'object' },
        },
        required: ['label', 'type'],
      },
    },
  },
  required: ['text'],
};

function AgentAdvisor({ insight, snapshot, bpId }) {
  const [guidance, setGuidance]       = useState(null);
  const [loading, setLoading]         = useState(false);
  const [open, setOpen]               = useState(false);
  const [question, setQuestion]       = useState('');
  const [chat, setChat]               = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = React.useRef(null);

  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat, chatLoading]);

  // Rich context — prevents irrelevant suggestions
  const snapshotCtx = snapshotToPromptContext(snapshot);

  const generateGuidance = async () => {
    setLoading(true);
    setOpen(true);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        model: 'haiku',
        response_json_schema: GUIDANCE_SCHEMA,
        prompt: `יועץ עסקי לעסקים ישראלים. ענה בעברית. הצע פעולות ספציפיות בהתאם למה שהעסק כבר עשה ומה חסר.
${snapshotCtx}
תובנה: "${insight.title}". ${insight.description ? insight.description.slice(0, 150) : ''}
סוג: ${insight.typeLabel}. עדיפות: ${insight.priority}.
הנחיה: אם פלטפורמה כבר מחוברת — אל תציע לחבר אותה. הצע צעדים מעשיים שניתן לבצע ישירות.`,
      });
      const parsed = res && typeof res === 'object' && res.steps ? res : null;
      setGuidance(parsed);
      if (!parsed) toast.error('לא הצלחתי לייצר הדרכה — נסה שוב');
    } catch {
      toast.error('שגיאה בטעינת ההדרכה');
    }
    setLoading(false);
  };

  // Platform capabilities list for the chat agent
  const platformCapabilities = [
    'create_task: צור משימה במערכת',
    'navigate:/tasks: עבור לעמוד משימות',
    'navigate:/reviews: עבור לעמוד ביקורות',
    'navigate:/marketing: צור פוסט/קמפיין',
    'navigate:/competitors: עמוד מתחרים',
    'navigate:/retention: שימור לקוחות',
    'navigate:/leads: לידים חמים',
    'navigate:/social: חבר רשתות חברתיות',
    'navigate:/integrations: הגדרות אינטגרציות',
  ].join('\n');

  const sendQuestion = async () => {
    const q = question.trim();
    if (!q || chatLoading) return;
    setQuestion('');
    setChat(prev => [...prev, { role: 'user', text: q }]);
    setChatLoading(true);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        model: 'haiku',
        response_json_schema: CHAT_SCHEMA,
        prompt: `אתה סוכן עסקי שיודע לנווט בפלטפורמת OTX. ענה בעברית.
מצב העסק:
${snapshotCtx}

תובנה נוכחית: "${insight.title}"

יכולות הפלטפורמה שלך:
${platformCapabilities}

שאלת המשתמש: "${q}"

ענה תשובה קצרה ומעשית (text) + הוסף עד 2 כפתורי פעולה (actions) שניתן לבצע ישירות בפלטפורמה.
אם המשתמש שואל על פלטפורמה שכבר מחוברת — אל תציע לחבר אותה שוב.`,
      });

      const msg = res && typeof res === 'object' && res.text
        ? res
        : { text: typeof res === 'string' ? res : 'לא הצלחתי לענות. נסה שוב.', actions: [] };

      setChat(prev => [...prev, { role: 'assistant', ...msg }]);
    } catch {
      setChat(prev => [...prev, { role: 'assistant', text: 'שגיאה — נסה שוב.', actions: [] }]);
    }
    setChatLoading(false);
  };

  return (
    <div className="card-base overflow-hidden">
      {/* Header */}
      <button
        onClick={guidance ? () => setOpen(v => !v) : generateGuidance}
        disabled={loading}
        className="w-full flex items-center justify-between px-5 py-3.5 border-b border-border hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Bot className="w-4 h-4 text-primary" />
          </div>
          <div className="text-right">
            <p className="text-[13px] font-semibold text-foreground">סוכן ייעוץ AI</p>
            <p className="text-[10px] text-foreground-muted">הדרכה + שאלות בזמן אמת</p>
          </div>
        </div>
        {loading
          ? <Loader2 className="w-4 h-4 animate-spin text-foreground-muted" />
          : !guidance
            ? <span className="text-[11px] font-semibold text-primary flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" /> קבל הדרכה ←
              </span>
            : open
              ? <ChevronUp className="w-4 h-4 text-foreground-muted" />
              : <ChevronDown className="w-4 h-4 text-foreground-muted" />
        }
      </button>

      {open && (
        <div className="p-5 space-y-4">

          {/* Guidance — shown after generation */}
          {guidance && (
            <>
              {/* Quick Win */}
              {guidance.quick_win && (
                <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-green-50 border border-green-100">
                  <Zap className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-bold text-green-700 mb-0.5">ניצחון מהיר — עשה עכשיו</p>
                    <p className="text-[12px] text-green-600 leading-relaxed">{guidance.quick_win}</p>
                  </div>
                </div>
              )}

              {/* Steps */}
              {guidance.steps?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-foreground-muted">שלבי ביצוע</p>
                  {guidance.steps.map((step, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-border bg-secondary/20">
                      <span className="w-5 h-5 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <p className="text-[12px] text-foreground leading-relaxed">{step}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Pro tip */}
              {guidance.tip && (
                <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-purple-50 border border-purple-100">
                  <Sparkles className="w-3.5 h-3.5 text-purple-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[12px] text-purple-700 leading-relaxed">{guidance.tip}</p>
                </div>
              )}

              <button
                onClick={() => { setGuidance(null); setChat([]); generateGuidance(); }}
                className="flex items-center gap-1 text-[10px] text-foreground-muted hover:text-foreground transition-all"
              >
                <RotateCcw className="w-3 h-3" /> חדש הדרכה
              </button>
              <div className="border-t border-border" />
            </>
          )}

          {/* Chat — always visible once panel is open */}
          <div>
            <p className="text-[11px] font-semibold text-foreground-muted mb-3 flex items-center gap-1.5">
              <Bot className="w-3.5 h-3.5" /> שאל את הסוכן
            </p>

            {/* Messages */}
            {chat.length > 0 && (
              <div className="space-y-3 mb-3 max-h-64 overflow-y-auto pr-1">
                {chat.map((msg, i) => (
                  <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-start' : 'items-end'}`}>
                    <div className={`max-w-[88%] px-3 py-2 rounded-2xl text-[12px] leading-relaxed
                      ${msg.role === 'user'
                        ? 'bg-primary text-white rounded-br-sm'
                        : 'bg-secondary text-foreground rounded-bl-sm border border-border'}`}>
                      {msg.text}
                    </div>
                    {/* ActionChips embedded in assistant messages */}
                    {msg.role === 'assistant' && msg.actions?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5 max-w-[88%] justify-end">
                        {msg.actions.map((action, ai) => (
                          <ActionChip key={ai} action={action} bpId={bpId} size="sm" />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-end">
                    <div className="px-4 py-2.5 rounded-2xl rounded-bl-sm bg-secondary border border-border">
                      <span className="flex gap-1">
                        {[0,1,2].map(d => (
                          <span key={d} className="w-1.5 h-1.5 rounded-full bg-foreground-muted animate-bounce"
                            style={{ animationDelay: `${d * 0.15}s` }} />
                        ))}
                      </span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}

            {/* Suggested questions — shown before first chat */}
            {chat.length === 0 && !guidance && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {[
                  'מה הצעד הראשון הכי חשוב?',
                  'כמה זמן ייקח?',
                  'מה הסיכונים?',
                ].map(q => (
                  <button key={q} onClick={() => setQuestion(q)}
                    className="text-[10px] px-2.5 py-1 rounded-full border border-border bg-secondary hover:bg-secondary/80 text-foreground-muted transition-all">
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendQuestion()}
                placeholder="שאל שאלה על ביצוע התובנה..."
                className="flex-1 text-[12px] border border-border rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-foreground-muted"
                dir="rtl"
              />
              <button
                onClick={sendQuestion}
                disabled={!question.trim() || chatLoading}
                className="p-2 rounded-xl bg-primary text-white hover:opacity-90 disabled:opacity-40 transition-all flex-shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Related Card ─────────────────────────────────────────────────────────────

function RelatedCard({ item, onClick }) {
  const meta = TYPE_META[item.alert_type || item.category || 'general'] || TYPE_META.general;
  const Icon = meta.icon;
  return (
    <button onClick={onClick} className={`text-right rounded-xl border ${meta.border} ${meta.bg} p-3 hover:shadow-sm transition-all w-full`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
        <span className={`text-[9px] font-bold ${meta.color}`}>{meta.label}</span>
      </div>
      <p className="text-[11px] font-semibold text-foreground leading-snug line-clamp-2">{item.title}</p>
    </button>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function InsightDetail() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const { businessProfile } = useOutletContext();
  const queryClient = useQueryClient();
  const bpId = businessProfile?.id;

  // Parse: "alert-{uuid}" | "action-{uuid}"
  const kind     = id?.startsWith('action-') ? 'action' : 'alert';
  const entityId = id?.replace(/^(alert|action)-/, '');

  // Load business snapshot (cached 15 min) — context for all agents
  const { data: snapshot, isLoading: snapshotLoading } = useQuery({
    queryKey: ['businessSnapshot', bpId],
    queryFn: () => fetchBusinessSnapshot(bpId),
    enabled: !!bpId,
    staleTime: 15 * 60 * 1000,
  });

  const { data: alert, isLoading: loadingAlert, error: alertError } = useQuery({
    queryKey: ['proactiveAlert', entityId],
    queryFn: () => base44.entities.ProactiveAlert.get(entityId),
    enabled: kind === 'alert' && !!entityId,
  });

  const { data: action, isLoading: loadingAction, error: actionError } = useQuery({
    queryKey: ['action', entityId],
    queryFn: () => base44.entities.Action.get(entityId),
    enabled: kind === 'action' && !!entityId,
  });

  const loading = loadingAlert || loadingAction;
  const entity  = kind === 'alert' ? alert : action;

  // Normalize fields across Alert / Action schemas
  const title       = entity?.title || '';
  const description = entity?.description || '';
  const reasoning   = kind === 'action' ? (entity?.reasoning || '') : '';
  const impact      = kind === 'action' ? (entity?.impact_estimate || '') : '';
  const stepsText   = kind === 'action'
    ? (entity?.execution_plan || entity?.suggested_action || '')
    : (entity?.suggested_action || '');
  const typeKey     = kind === 'alert'
    ? (entity?.alert_type || 'action_needed')
    : (entity?.category || 'general');
  const priority    = entity?.priority || 'medium';
  const sourceAgent = entity?.source_agent || null;
  const createdAt   = entity?.created_date || entity?.created_at;
  const status      = kind === 'action' ? (entity?.status || 'proposed') : null;
  const isActedOn   = kind === 'alert' ? !!entity?.is_acted_on : entity?.status === 'completed';

  const typeMeta    = TYPE_META[typeKey] || TYPE_META.general;
  const priorityMeta = PRIORITY_BADGE[priority] || PRIORITY_BADGE.medium;
  const TypeIcon    = typeMeta.icon;

  const steps = parseSteps(stepsText);
  const { checks, toggle } = useStepChecks(id, steps.length);

  // Related alerts — same type, exclude current
  const { data: relatedAlerts = [] } = useQuery({
    queryKey: ['relatedAlerts', bpId, typeKey, entityId],
    queryFn: () => base44.entities.ProactiveAlert.filter(
      { linked_business: bpId, alert_type: typeKey, is_dismissed: false }, '-created_at', 6
    ),
    enabled: !!bpId && kind === 'alert' && !!entity,
    select: data => data.filter(a => a.id !== entityId).slice(0, 3),
  });

  // Mark completed
  const completeMutation = useMutation({
    mutationFn: () => kind === 'alert'
      ? base44.entities.ProactiveAlert.update(entityId, { is_acted_on: true })
      : base44.entities.Action.update(entityId, { status: 'completed' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [kind === 'alert' ? 'proactiveAlert' : 'action', entityId] });
      queryClient.invalidateQueries({ queryKey: ['proactiveAlerts'] });
      queryClient.invalidateQueries({ queryKey: ['activeInsights'] });
      toast.success('סומן כהושלם ✓');
    },
  });

  // ── Render: loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24" dir="rtl">
        <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
      </div>
    );
  }

  // ── Render: not found ──
  if (!entity) {
    return (
      <div className="text-center py-20 space-y-3" dir="rtl">
        <Lightbulb className="w-10 h-10 text-foreground-muted opacity-30 mx-auto" />
        <p className="text-[13px] text-foreground-muted">
          {alertError || actionError ? 'שגיאה בטעינת התובנה' : 'התובנה לא נמצאה'}
        </p>
        <button onClick={() => navigate('/insights')} className="text-[12px] text-primary hover:underline">
          ← חזור לרשימת התובנות
        </button>
      </div>
    );
  }

  const insightForAgent = { title, description, typeLabel: typeMeta.label, priority, stepsText };

  // Quick actions from ActionRouter — filtered by snapshot
  const quickActions = getActionsForInsight(typeKey, snapshot, insightForAgent, 4);

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-12" dir="rtl">

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
        <button onClick={() => navigate('/insights')} className="hover:text-primary transition-colors flex items-center gap-1">
          <ArrowRight className="w-3 h-3" /> תובנות
        </button>
        <ChevronLeft className="w-3 h-3" />
        <span className="text-foreground truncate max-w-[220px]">{title}</span>
      </div>

      {/* ── A. Header ── */}
      <div className={`rounded-2xl border ${typeMeta.border} ${typeMeta.bg} p-5`}>
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-white border ${typeMeta.border}`}>
            <TypeIcon className={`w-5 h-5 ${typeMeta.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${typeMeta.bg} ${typeMeta.color} border ${typeMeta.border}`}>
                {typeMeta.label}
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${priorityMeta.bg} ${priorityMeta.color} flex items-center gap-1`}>
                <span className={`w-1.5 h-1.5 rounded-full ${priorityMeta.dot}`} />
                {priorityMeta.label}
              </span>
              {isActedOn && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex items-center gap-1">
                  <CheckCheck className="w-3 h-3" /> הושלם
                </span>
              )}
            </div>
            <h1 className="text-[17px] font-bold text-foreground leading-snug mb-2">{title}</h1>
            <div className="flex flex-wrap gap-3 text-[10px] text-foreground-muted">
              {createdAt && <span>{new Date(createdAt).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })}</span>}
              {sourceAgent && <span>· סוכן: {sourceAgent}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* ── Quick Actions Bar ── */}
      {quickActions.length > 0 && (
        <div className="card-base px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-semibold text-foreground-muted flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-primary opacity-60" />
              פעולות מהירות
            </p>
            {snapshotLoading && (
              <span className="flex items-center gap-1 text-[10px] text-foreground-muted">
                <Database className="w-3 h-3 animate-pulse" /> לומד את העסק...
              </span>
            )}
            {snapshot && !snapshotLoading && (
              <span className="text-[10px] text-foreground-muted opacity-60">
                {snapshot.connected_platforms.length} פלטפורמות פעילות
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {quickActions.map((action) => (
              <ActionChip key={action.key} action={action} bpId={bpId} size="md" />
            ))}
          </div>
        </div>
      )}

      {/* ── B. למה זה חשוב ── */}
      {(description || reasoning || impact) && (
        <div className="card-base p-5 space-y-3">
          <h2 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-primary opacity-60" />
            למה זה חשוב
          </h2>
          {description && (
            <p className="text-[12px] text-foreground-secondary leading-relaxed">{description}</p>
          )}
          {reasoning && reasoning !== description && (
            <p className="text-[12px] text-foreground-secondary leading-relaxed border-t border-border pt-3">{reasoning}</p>
          )}
          {impact && (
            <div className="rounded-lg bg-green-50 border border-green-100 px-3 py-2">
              <p className="text-[11px] font-semibold text-green-700 mb-0.5">הערכת השפעה</p>
              <p className="text-[11px] text-green-600 leading-relaxed">{impact}</p>
            </div>
          )}
        </div>
      )}

      {/* ── C. AI Agent Advisor ── */}
      <AgentAdvisor insight={insightForAgent} snapshot={snapshot} bpId={bpId} />

      {/* ── D. שלבי ביצוע ── */}
      {steps.length > 0 && (
        <div className="card-base p-5">
          <h2 className="text-[13px] font-semibold text-foreground mb-3 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary opacity-60" />
            שלבי ביצוע מקוריים
          </h2>
          <div className="space-y-1.5">
            {steps.map((step, i) => (
              <button key={i} onClick={() => toggle(i)}
                className="w-full flex items-start gap-3 p-2.5 rounded-lg hover:bg-secondary/40 transition-colors text-right group">
                {checks[i]
                  ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                  : <Circle className="w-4 h-4 text-border flex-shrink-0 mt-0.5 group-hover:text-foreground-muted transition-colors" />}
                <span className={`text-[11px] font-medium leading-snug flex-1 ${checks[i] ? 'line-through text-foreground-muted' : 'text-foreground'}`}>
                  {i + 1}. {step}
                </span>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-foreground-muted mt-2">
            {checks.filter(Boolean).length} / {steps.length} הושלמו · נשמר מקומית
          </p>
        </div>
      )}

      {/* ── E. מעקב סטטוס ── */}
      <div className="card-base p-5">
        <h2 className="text-[13px] font-semibold text-foreground mb-4 flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary opacity-60" />
          מעקב סטטוס
        </h2>
        <StatusTimeline status={status} isActedOn={isActedOn} />
        <div className="flex items-center gap-3 mt-5 flex-wrap">
          {!isActedOn && (
            <button
              onClick={() => completeMutation.mutate()}
              disabled={completeMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-white text-[12px] font-semibold hover:opacity-90 transition-all disabled:opacity-50"
            >
              {completeMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <CheckCheck className="w-3.5 h-3.5" />}
              סמן כהושלם
            </button>
          )}
          <button
            onClick={() => navigate(`/tasks?from_insight=${id}&title=${encodeURIComponent(title)}&desc=${encodeURIComponent(description)}&priority=${priority === 'critical' || priority === 'high' ? priority : 'medium'}`)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border bg-white text-[12px] font-medium text-foreground hover:bg-secondary/30 transition-all"
          >
            <ClipboardList className="w-3.5 h-3.5" />
            המר למשימה
          </button>
        </div>
      </div>

      {/* ── F. תובנות קשורות ── */}
      {relatedAlerts.length > 0 && (
        <div className="card-base p-5">
          <h2 className="text-[13px] font-semibold text-foreground mb-3">תובנות קשורות</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {relatedAlerts.map(rel => (
              <RelatedCard key={rel.id} item={rel} onClick={() => navigate(`/insights/alert-${rel.id}`)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
