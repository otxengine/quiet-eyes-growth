/**
 * CommandHome — AI Command Center
 * Route: /command
 */
import React, { useState, useRef, useEffect } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  ArrowLeft, RefreshCw, Sparkles, Zap, Flame, Clock, Loader2,
  Trash2, CheckCircle, X,
} from 'lucide-react';
import ChatMessage from '@/components/chat/ChatMessage';

// ── Time greeting ──────────────────────────────────────────────────────────────
function getGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'בוקר טוב';
  if (h >= 12 && h < 17) return 'צהריים טובים';
  if (h >= 17 && h < 21) return 'ערב טוב';
  return 'לילה טוב';
}

// ── Dot-grid SVG background ────────────────────────────────────────────────────
const DOT_GRID = `url("data:image/svg+xml,%3Csvg width='28' height='28' viewBox='0 0 28 28' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='14' cy='14' r='1.2' fill='%23C4C2CF' fill-opacity='0.45'/%3E%3C/svg%3E")`;

// ── localStorage helpers ────────────────────────────────────────────────────────
function chatKey(bpId) {
  return bpId ? `cortexi_command_chat_${bpId}` : 'cortexi_command_chat_default';
}
function loadHistory(bpId) {
  try { return JSON.parse(localStorage.getItem(chatKey(bpId)) || '[]'); } catch { return []; }
}
function saveHistory(msgs, bpId) {
  try { localStorage.setItem(chatKey(bpId), JSON.stringify(msgs.slice(-10))); } catch {}
}

// ── Shortcut cards ─────────────────────────────────────────────────────────────
const SHORTCUTS = [
  { key: 'brief',    label: 'בריף בוקר',    desc: 'מה השתנה מאתמול?',          Icon: Zap,       prompt: 'תן לי בריף בוקר — מה השתנה מאתמול בעסק?' },
  { key: 'urgent',   label: 'דחוף להיום',   desc: 'תובנות חשובות להיום',       Icon: Flame,     prompt: 'מה הפעולה הדחופה ביותר שאני צריך לעשות היום?' },
  { key: 'snapshot', label: 'תמונת מצב',    desc: 'תמונת מצב עדכנית',          Icon: Sparkles,  prompt: 'תן לי תמונת מצב של העסק — לידים, ביקורות, מתחרים' },
  { key: 'recent',   label: 'בוצע לאחרונה', desc: 'פעולות שבוצעו לאחרונה',    Icon: RefreshCw, prompt: 'מה הפעולות שבוצעו לאחרונה במערכת ומה הסטטוס שלהן?' },
];

// ── Alert Card ─────────────────────────────────────────────────────────────────
function AlertCard({ alert, onAction, onDismiss }) {
  if (!alert) return null;
  const ago = (() => {
    const ms = Date.now() - new Date(alert.created_date || alert.created_at).getTime();
    const m = Math.floor(ms / 60_000);
    if (m < 60) return `${m} דק'`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} שע'`;
    return `${Math.floor(h / 24)} ימים`;
  })();

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-3 w-full relative"
      style={{ background: '#EDE8F5' }}
      dir="rtl"
    >
      <button
        onClick={onDismiss}
        className="absolute top-3 left-3 p-1 rounded-full hover:bg-black/10 transition-colors"
        title="סגור"
      >
        <X className="w-3.5 h-3.5 text-foreground-muted" />
      </button>
      <p className="text-[11px] text-foreground-muted">התראה</p>
      <div>
        <p className="text-[15px] font-bold text-foreground leading-snug">{alert.title}</p>
        {alert.description && (
          <p className="text-[12px] text-foreground-secondary mt-1 leading-relaxed">{alert.description}</p>
        )}
      </div>
      <div className="flex items-center gap-3 mt-1">
        <button
          onClick={onAction}
          className="px-4 py-1.5 rounded-full text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: '#E8344D' }}
        >
          הגב עכשיו
        </button>
        <div className="flex items-center gap-1 text-[11px] text-foreground-muted">
          <Clock className="w-3.5 h-3.5" />
          <span>{ago}</span>
        </div>
      </div>
    </div>
  );
}

// ── Pending Action Confirmation Card ───────────────────────────────────────────
function ConfirmationCard({ action, onApprove, onCancel, loading }) {
  if (!action) return null;
  return (
    <div
      className="rounded-2xl p-4 border flex flex-col gap-3"
      style={{ background: 'rgba(232,52,77,0.04)', borderColor: 'rgba(232,52,77,0.2)' }}
      dir="rtl"
    >
      <div className="flex items-center gap-2">
        <Zap className="w-4 h-4 flex-shrink-0" style={{ color: '#E8344D' }} />
        <p className="text-[13px] font-semibold text-foreground">{action.label}</p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onApprove}
          disabled={loading}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[12px] font-semibold text-white transition-opacity disabled:opacity-60"
          style={{ background: '#E8344D' }}
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
          אשר
        </button>
        <button
          onClick={onCancel}
          disabled={loading}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[12px] font-medium border border-border text-foreground-muted hover:bg-secondary transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          בטל
        </button>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function CommandHome() {
  const { businessProfile } = useOutletContext();
  const navigate = useNavigate();
  const bpId = businessProfile?.id;
  const bizName = businessProfile?.name || '';

  const [messages, setMessages] = useState(() => loadHistory(bpId));
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [dismissedAlertId, setDismissedAlertId] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Reload history when business changes
  useEffect(() => {
    setMessages(loadHistory(bpId));
  }, [bpId]);

  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Latest unread alert
  const { data: alerts = [] } = useQuery({
    queryKey: ['commandAlerts', bpId],
    queryFn: () => base44.entities.ProactiveAlert.filter(
      { linked_business: bpId, is_dismissed: false },
      '-created_date',
      5,
    ),
    enabled: !!bpId,
    staleTime: 2 * 60_000,
  });
  const topAlert = dismissedAlertId
    ? alerts.find(a => a.id !== dismissedAlertId) || null
    : alerts[0] || null;

  const sendMessage = async (text) => {
    const trimmed = (text || input).trim();
    if (!trimmed || sending) return;
    setInput('');
    setPendingAction(null);

    const userMsg = { role: 'user', content: trimmed, timestamp: Date.now() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    saveHistory(updated, bpId);
    setSending(true);

    try {
      let reply = '';
      let chips = [];
      let action = null;

      if (bpId) {
        try {
          const res = await base44.functions.invoke('commandChat', {
            businessProfileId: bpId,
            message: trimmed,
            history: updated.slice(-10).map(m => ({ role: m.role, content: m.content })),
          });
          const data = res?.data || res;
          let rawReply = data?.reply || '';
          // Safety: unwrap if reply is itself a JSON string
          if (typeof rawReply === 'string' && rawReply.trimStart().startsWith('{')) {
            try {
              const inner = JSON.parse(rawReply);
              if (inner?.reply) rawReply = inner.reply;
            } catch { /* use rawReply as-is */ }
          }
          reply = rawReply;
          chips = data?.chips || [];
          action = data?.pendingAction || null;
        } catch (_) {}
      }

      // Fallback to basic LLM if commandChat fails
      if (!reply) {
        const fallback = await base44.integrations.Core.InvokeLLM({
          model: 'sonnet',
          maxTokens: 500,
          prompt: `אתה יועץ עסקי AI. העסק: ${bizName}. ענה בעברית בקצרה.\n\nשאלה: ${trimmed}`,
        });
        reply = typeof fallback === 'string' ? fallback : (fallback?.content || 'מצטער, לא הצלחתי לענות.');
      }

      const assistantMsg = {
        role: 'assistant',
        content: reply,
        chips,
        timestamp: Date.now(),
      };
      const withReply = [...updated, assistantMsg];
      setMessages(withReply);
      saveHistory(withReply, bpId);
      if (action) setPendingAction(action);
    } catch (err) {
      console.error('[CommandHome] Error:', err);
      const errMsg = { role: 'assistant', content: 'מצטער, אין חיבור כרגע. נסה שוב.', timestamp: Date.now() };
      const withErr = [...updated, errMsg];
      setMessages(withErr);
      saveHistory(withErr, bpId);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearHistory = () => {
    setMessages([]);
    saveHistory([], bpId);
    setPendingAction(null);
  };

  const executePendingAction = async () => {
    if (!pendingAction) return;
    setActionLoading(true);
    try {
      switch (pendingAction.type) {
        case 'create_task':
          await base44.entities.Task.create({
            ...pendingAction.payload,
            linked_business: bpId,
            status: 'pending',
          });
          break;
        case 'update_lead':
          await base44.entities.Lead.update(pendingAction.payload.id, pendingAction.payload);
          break;
        case 'respond_review':
          await base44.entities.Review.update(pendingAction.payload.id, {
            suggested_response: pendingAction.payload.suggested_response,
          });
          break;
        case 'dismiss_alert':
          await base44.entities.ProactiveAlert.update(pendingAction.payload.id, { is_dismissed: true });
          break;
        case 'navigate':
          navigate(pendingAction.payload.path);
          break;
      }

      const successMsg = {
        role: 'assistant',
        content: `בוצע! ${pendingAction.label}`,
        timestamp: Date.now(),
      };
      const withSuccess = [...messages, successMsg];
      setMessages(withSuccess);
      saveHistory(withSuccess, bpId);
    } catch (err) {
      console.error('[CommandHome] Action error:', err);
    } finally {
      setActionLoading(false);
      setPendingAction(null);
    }
  };

  const greeting = getGreeting();

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: '#F2F1F6', backgroundImage: DOT_GRID }}
      dir="rtl"
    >
      {/* ── Hero section ────────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center justify-center pt-12 pb-6 px-6">
        {/* Avatar gradient */}
        <div
          className="w-20 h-20 rounded-full mb-5 flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, #9B59B6 0%, #F1C40F 100%)',
            boxShadow: '0 8px 32px rgba(155,89,182,0.25)',
          }}
        />

        {/* Greeting */}
        <h1 className="text-[26px] font-bold text-foreground text-center leading-tight">
          {greeting} {bizName},
        </h1>
        <p className="text-[18px] text-foreground-secondary text-center mt-1">
          מה תרצה לבצע היום?
        </p>

        {/* Messages area */}
        {messages.length > 0 && (
          <div
            className="w-full max-w-[600px] mt-6 rounded-2xl bg-white/60 border border-border/40 overflow-y-auto flex flex-col gap-3 p-4"
            style={{ maxHeight: 320, scrollbarWidth: 'none' }}
          >
            {messages.filter(m => m.role !== 'system').map((msg, i) => (
              <ChatMessage
                key={i}
                message={msg}
                onChipAction={(chip) => {
                  if (chip.action === 'create_task') navigate('/tasks');
                }}
              />
            ))}
            {sending && (
              <div className="flex items-center gap-2 px-3 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary/50" />
                <span className="text-[12px] text-primary/50">חושב...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Pending Action Confirmation */}
        {pendingAction && (
          <div className="w-full max-w-[600px] mt-3">
            <ConfirmationCard
              action={pendingAction}
              onApprove={executePendingAction}
              onCancel={() => setPendingAction(null)}
              loading={actionLoading}
            />
          </div>
        )}

        {/* Input row */}
        <div className="flex items-center gap-3 mt-5 w-full max-w-[600px]">
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || sending}
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 transition-all disabled:opacity-40 hover:opacity-80"
            style={{ background: '#1A1A2E' }}
          >
            {sending ? (
              <Loader2 className="w-5 h-5 text-white animate-spin" />
            ) : (
              <ArrowLeft className="w-5 h-5 text-white" />
            )}
          </button>

          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="תאר במילים מה תרצה לבצע..."
            className="flex-1 h-12 rounded-full bg-white border border-border px-5 text-[13px] text-foreground-secondary placeholder:text-foreground-muted/70 focus:outline-none focus:ring-2 focus:ring-purple-300 transition-all"
            dir="rtl"
            disabled={sending}
          />

          {messages.length > 0 && (
            <button
              onClick={clearHistory}
              title="נקה שיחה"
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-colors hover:bg-secondary"
              style={{ background: 'rgba(0,0,0,0.06)' }}
            >
              <Trash2 className="w-4 h-4 text-foreground-muted/60" />
            </button>
          )}
        </div>
      </div>

      {/* ── Divider ─────────────────────────────────────────────────────────── */}
      <div className="border-t border-border/70 mx-0" />

      {/* ── Bottom section: shortcuts + alert ───────────────────────────────── */}
      <div className="px-4 py-6 space-y-3">
        {/* Alert card — always full width, always stacked above shortcuts */}
        {topAlert && (
          <AlertCard
            alert={topAlert}
            onAction={() => navigate('/insights')}
            onDismiss={() => setDismissedAlertId(topAlert.id)}
          />
        )}

        {/* Shortcut cards — 2 columns on all screen sizes */}
        <div className="grid grid-cols-2 gap-3">
          {SHORTCUTS.map(({ key, label, desc, Icon, prompt }) => (
            <button
              key={key}
              onClick={() => {
                setInput(prompt);
                inputRef.current?.focus();
                sendMessage(prompt);
              }}
              className="bg-white rounded-2xl p-4 flex flex-col gap-2 text-right hover:shadow-md transition-all border border-transparent hover:border-border/60"
            >
              <div className="flex items-center gap-2 justify-end">
                <span className="text-[13px] font-semibold text-foreground">{label}</span>
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: '#FEE2E8' }}
                >
                  <Icon className="w-3.5 h-3.5" style={{ color: '#E8344D' }} />
                </div>
              </div>
              <p className="text-[11px] text-foreground-muted/70 leading-relaxed">{desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
