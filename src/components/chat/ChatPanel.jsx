import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Send, Loader2, Sparkles, Trash2, Maximize2, CheckCircle, Zap } from 'lucide-react';
import ChatMessage from './ChatMessage';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

function storageKey(businessProfileId) {
  return businessProfileId
    ? `quieteyes_chat_${businessProfileId}`
    : 'quieteyes_chat_default';
}

function loadMessages(businessProfileId) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(businessProfileId)) || '[]');
  } catch {
    return [];
  }
}

function saveMessages(msgs, businessProfileId) {
  try {
    localStorage.setItem(storageKey(businessProfileId), JSON.stringify(msgs.slice(-30)));
  } catch {}
}

function buildSuggestions(profile, alerts, leads, reviews) {
  const questions = [];

  const hotLeads = (leads || []).filter(l => l.status === 'hot');
  if (hotLeads.length > 0) {
    questions.push({ text: `יש לי ${hotLeads.length} לידים חמים — מה הפעולה הכי דחופה?`, icon: '🎯' });
  }

  const negReviews = (reviews || []).filter(r => r.sentiment === 'negative' && r.response_status === 'pending');
  if (negReviews.length > 0) {
    questions.push({ text: `יש ${negReviews.length} ביקורות שליליות ללא מענה — איך לטפל?`, icon: '⭐' });
  }

  const criticalAlerts = (alerts || []).filter(a => a.priority === 'high' || a.priority === 'critical');
  if (criticalAlerts.length > 0) {
    questions.push({ text: 'מה ההתראות הדחופות ביותר שלי עכשיו?', icon: '🎯' });
  }

  if (questions.length < 2) questions.push({ text: 'מה הפעולה הכי משפיעה שאני יכול לעשות היום?', icon: '🎯' });
  if (questions.length < 3) questions.push({ text: 'מה מצב הלידים שלי השבוע?', icon: '📊' });
  if (questions.length < 4) questions.push({ text: 'איך אני ביחס למתחרים שלי?', icon: '❓' });

  return questions.slice(0, 4);
}

// Build a local greeting from suggestion data (no API call)
function buildGreeting(alerts, leads, reviews) {
  const hotLeads = (leads || []).filter(l => l.status === 'hot');
  const pendingReviews = (reviews || []).filter(r => r.response_status === 'pending' || r.response_status === 'suggested');
  const criticalAlerts = (alerts || []).filter(a => a.priority === 'high' || a.priority === 'critical');

  const parts = [];
  if (hotLeads.length > 0) parts.push(`${hotLeads.length} לידים חמים`);
  if (pendingReviews.length > 0) parts.push(`${pendingReviews.length} ביקורות ממתינות`);
  if (criticalAlerts.length > 0) parts.push(`${criticalAlerts.length} התראות דחופות`);

  if (parts.length === 0) return 'שלום! אני כאן לעזור לך לנהל ולצמח את העסק. מה תרצה לבדוק?';
  return `שלום! יש לך ${parts.join(' ו-')} — רוצה לטפל בהם עכשיו?`;
}

// Detect navigation chips from AI response text
function detectChips(text) {
  const chips = [];
  if (/לידים?/.test(text)) chips.push({ label: '← לידים', path: '/leads' });
  if (/ביקורות?|מוניטין/.test(text)) chips.push({ label: '← מוניטין', path: '/reviews' });
  if (/מתחרי/.test(text)) chips.push({ label: '← מתחרים', path: '/competitors' });
  if (/תובנ|התראה/.test(text)) chips.push({ label: '← תובנות', path: '/insights' });
  if (/פעולה|כדאי|משימה/.test(text)) chips.push({ label: '+ צור משימה', action: 'create_task' });
  return chips;
}

const DEFAULT_QUICK_ACTIONS = [
  { label: '📋 תקציר יומי', prompt: 'תן לי תקציר של מה שקרה בעסק היום' },
  { label: '🔥 פעולה דחופה', prompt: 'מה הפעולה הכי דחופה שאני צריך לעשות עכשיו?' },
  { label: '📈 מצב שוק', prompt: 'מה מצב השוק והמתחרים שלי עכשיו?' },
];

const PAGE_QUICK_ACTIONS = {
  '/leads': [
    { label: '🔥 ליד חם הבא', prompt: 'מה לעשות עם הליד החם הבא שלי?' },
    { label: '📊 סיכום לידים', prompt: 'תן לי סיכום מצב הלידים שלי' },
    { label: '🎯 טיפ לסגירה', prompt: 'תן לי טיפ לסגירת עסקה' },
  ],
  '/reviews': [
    { label: '⭐ ביקורת ממתינה', prompt: 'עזור לי לטפל בביקורת הממתינה' },
    { label: '📝 נוסח תגובה', prompt: 'עזור לי לנסח תגובה מקצועית לביקורת שלילית' },
    { label: '📊 סיכום מוניטין', prompt: 'מה מצב המוניטין שלי עכשיו?' },
  ],
  '/competitors': [
    { label: '🥊 SWOT מהיר', prompt: 'תעשה SWOT מהיר על המתחרה הכי חזק שלי' },
    { label: '📈 שינוי מתחרה', prompt: 'מה השינויים האחרונים אצל המתחרים שלי?' },
    { label: '💡 הזדמנות', prompt: 'איפה יש לי הזדמנות ביחס למתחרים?' },
  ],
  '/insights': [
    { label: '🎯 תובנה דחופה', prompt: 'מה התובנה הדחופה ביותר שצריכה את תשומת הלב שלי?' },
    { label: '📋 סיכום תובנות', prompt: 'תסכם את התובנות האחרונות שלי' },
    { label: '⚡ פעולה מיידית', prompt: 'מה הפעולה המיידית הכי חשובה שעולה מהתובנות?' },
  ],
};

// ── Pending Action Confirmation Card ─────────────────────────────────────────
function ConfirmationCard({ action, onApprove, onCancel, loading }) {
  if (!action) return null;
  return (
    <div
      className="rounded-2xl p-3 border mx-1 my-1"
      style={{ background: 'rgba(232,52,77,0.04)', borderColor: 'rgba(232,52,77,0.2)' }}
      dir="rtl"
    >
      <div className="flex items-center gap-2 mb-2">
        <Zap className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#E8344D' }} />
        <p className="text-[12px] font-semibold text-foreground">{action.label}</p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onApprove}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white transition-opacity disabled:opacity-60"
          style={{ background: '#E8344D' }}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
          אשר
        </button>
        <button
          onClick={onCancel}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-[11px] border border-border text-foreground-muted hover:bg-secondary transition-colors"
        >
          בטל
        </button>
      </div>
    </div>
  );
}

export default function ChatPanel({ onClose, businessProfile, prefilledMessage, onPrefilledConsumed, pageKey }) {
  const bpId = businessProfile?.id;
  const navigate = useNavigate();

  const [messages, setMessages] = useState(() => loadMessages(bpId));
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const bottomRef = useRef(null);

  const { data: alertsData = [] } = useQuery({
    queryKey: ['chatAlerts', bpId],
    queryFn: () => base44.entities.ProactiveAlert.filter({ linked_business: bpId, is_dismissed: false, is_acted_on: false }, '-created_at', 5),
    enabled: !!bpId && messages.length === 0,
    staleTime: 2 * 60 * 1000,
  });
  const { data: leadsData = [] } = useQuery({
    queryKey: ['chatLeads', bpId],
    queryFn: () => base44.entities.Lead.filter({ linked_business: bpId }, '-created_date', 20),
    enabled: !!bpId && messages.length === 0,
    staleTime: 2 * 60 * 1000,
  });
  const { data: reviewsData = [] } = useQuery({
    queryKey: ['chatReviews', bpId],
    queryFn: () => base44.entities.Review.filter({ linked_business: bpId }, '-created_date', 20),
    enabled: !!bpId && messages.length === 0,
    staleTime: 2 * 60 * 1000,
  });

  const suggestions = buildSuggestions(businessProfile, alertsData, leadsData, reviewsData);

  // Page-specific quick actions
  const quickActions = PAGE_QUICK_ACTIONS[pageKey] || DEFAULT_QUICK_ACTIONS;

  // Reload history when business changes
  useEffect(() => {
    setMessages(loadMessages(bpId));
  }, [bpId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // When a prefilled message arrives (from chat:open event), inject it and send
  useEffect(() => {
    if (!prefilledMessage) return;
    setInput(prefilledMessage);
    onPrefilledConsumed?.();
  }, [prefilledMessage]);

  const handleSend = async (overrideText) => {
    const text = (overrideText || input).trim();
    if (!text || sending) return;
    setInput('');

    const userMsg = { role: 'user', content: text, timestamp: Date.now() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    saveMessages(updated, bpId);
    setSending(true);

    try {
      const history = updated.slice(-8)
        .map(m => `${m.role === 'user' ? 'משתמש' : 'עוזר'}: ${m.content}`)
        .join('\n');

      let replyText;

      if (bpId) {
        try {
          const res = await base44.functions.invoke('chatWithBusiness', {
            businessProfileId: bpId,
            message: text,
            history,
          });
          const data = res?.data || res;
          replyText = data?.reply || data?.content || JSON.stringify(data);
          if (data?.pendingAction) setPendingAction(data.pendingAction);
        } catch (_) {
          replyText = null;
        }
      }

      if (!replyText) {
        const bp = businessProfile;
        const bpContext = bp
          ? `\nהעסק שלי: ${bp.name} — ${bp.category} ב${bp.city}.`
          : '';

        const reply = await base44.integrations.Core.InvokeLLM({
          model: 'sonnet',
          maxTokens: 600,
          prompt: `אתה יועץ עסקי AI של מערכת QuietEyes — פלטפורמת מודיעין עסקי לעסקים קטנים ישראלים.${bpContext}
המערכת עוקבת אחר מתחרים, מנתחת ביקורות, מייצרת תובנות שוק ופועלת דרך סוכנים AI ברקע.

כללי תגובה:
- ענה בעברית בלבד
- תן תשובות ישירות, מעשיות, ספציפיות לעסק — לא עצות גנריות
- אם השאלה קשורה לתחום המרקטינג/מתחרים/ביקורות — ציין פעולה קונקרטית אחת
- אורך: 2-4 משפטים, אלא אם נשאל להסבר מפורט

היסטוריית השיחה:
${history}

שאלת המשתמש: ${text}`,
        });
        replyText = typeof reply === 'string' ? reply : (reply?.content || JSON.stringify(reply));
      }

      const assistantMsg = {
        role: 'assistant',
        content: replyText,
        chips: detectChips(replyText),
        timestamp: Date.now(),
      };
      const withReply = [...updated, assistantMsg];
      setMessages(withReply);
      saveMessages(withReply, bpId);
    } catch (err) {
      console.error('[Chat] Error:', err);
      const errMsg = { role: 'assistant', content: 'מצטער, אין חיבור כרגע. נסה שוב.', timestamp: Date.now() };
      const withErr = [...updated, errMsg];
      setMessages(withErr);
      saveMessages(withErr, bpId);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearHistory = () => {
    setMessages([]);
    saveMessages([], bpId);
  };

  const handleChipAction = (chip) => {
    if (chip.path) {
      navigate(chip.path);
    }
    // create_task chips are handled via pendingAction confirmation card — no navigation
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
          if (pendingAction.payload?.id) {
            await base44.entities.Lead.update(pendingAction.payload.id, pendingAction.payload);
          }
          break;
        case 'respond_review':
          if (pendingAction.payload?.id) {
            await base44.entities.Review.update(pendingAction.payload.id, {
              suggested_response: pendingAction.payload.suggested_response,
            });
          }
          break;
        case 'dismiss_alert':
          if (pendingAction.payload?.id) {
            await base44.entities.ProactiveAlert.update(pendingAction.payload.id, { is_dismissed: true });
          }
          break;
        case 'navigate':
          navigate(pendingAction.payload?.path || '/');
          break;
      }
      const successMsg = {
        role: 'assistant',
        content: `בוצע! ${pendingAction.label}`,
        timestamp: Date.now(),
      };
      const withSuccess = [...messages, successMsg];
      setMessages(withSuccess);
      saveMessages(withSuccess, bpId);
    } catch (err) {
      console.error('[ChatPanel] Action error:', err);
    } finally {
      setActionLoading(false);
      setPendingAction(null);
    }
  };

  // Personal greeting computed locally from context data
  const greeting = buildGreeting(alertsData, leadsData, reviewsData);

  return (
    <div
      className="fixed z-[65] flex flex-col overflow-hidden"
      style={{
        position: 'fixed',
        bottom: 88,
        left: 16,
        right: 'auto',
        width: 'min(440px, calc(100vw - 32px))',
        height: 'min(620px, calc(100vh - 104px))',
        background: 'rgba(255,255,255,0.88)',
        backdropFilter: 'blur(24px) saturate(200%)',
        WebkitBackdropFilter: 'blur(24px) saturate(200%)',
        border: '1px solid rgba(255,255,255,0.7)',
        boxShadow: '0 16px 40px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.08)',
        borderRadius: '20px',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #E8344D, #FF6B6B)' }}
          >
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <span className="text-[13px] font-semibold text-foreground">יועץ AI</span>
            {businessProfile?.name && (
              <span className="text-[10px] text-foreground-muted block leading-none">{businessProfile.name}</span>
            )}
            {!businessProfile?.name && (
              <span className="text-[10px] text-primary/70 block leading-none">פעיל</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigate('/chat')}
            title="פתח בדף מלא"
            className="p-1.5 rounded-md hover:bg-secondary transition-colors"
          >
            <Maximize2 className="w-3.5 h-3.5 text-foreground-muted/60" />
          </button>
          {messages.length > 0 && (
            <button onClick={clearHistory} title="נקה שיחה" className="p-1.5 rounded-md hover:bg-secondary transition-colors">
              <Trash2 className="w-3.5 h-3.5 text-foreground-muted/60 hover:text-danger transition-colors" />
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-secondary transition-colors">
            <X className="w-4 h-4 text-foreground-muted" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ scrollbarWidth: 'none' }}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-start justify-start h-full pt-2 gap-3">
            <div className="w-full text-center pb-1">
              <div
                className="w-10 h-10 rounded-2xl mx-auto mb-2 flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, rgba(232,52,77,0.1), rgba(232,52,77,0.05))' }}
              >
                <Sparkles className="w-5 h-5 text-primary/60" />
              </div>
              {/* Personalized greeting based on business state */}
              <p className="text-[12px] text-foreground-muted font-medium px-2">{greeting}</p>
            </div>
            <div className="w-full space-y-1.5">
              {suggestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => setInput(q.text)}
                  className="w-full text-right text-[11px] bg-white border border-border/60 rounded-xl px-3 py-2.5 hover:border-primary/30 hover:bg-primary/4 transition-all text-foreground-secondary hover:text-foreground group"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-primary/60 group-hover:text-primary text-[14px]">{q.icon}</span>
                    {q.text}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.filter(m => m.role !== 'system').map((msg, i) => (
            <ChatMessage key={i} message={msg} onChipAction={handleChipAction} />
          ))
        )}
        {sending && (
          <div className="flex items-center gap-2 px-3 py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary/50" />
            <span className="text-[12px] text-primary/50">חושב...</span>
          </div>
        )}
        {pendingAction && (
          <ConfirmationCard
            action={pendingAction}
            onApprove={executePendingAction}
            onCancel={() => setPendingAction(null)}
            loading={actionLoading}
          />
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick Actions + Input */}
      <div className="border-t border-border/50">
        {/* Page-aware Quick Action Bar */}
        <div className="px-3 pt-2 flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {quickActions.map(a => (
            <button
              key={a.label}
              onClick={() => setInput(a.prompt)}
              className="flex-shrink-0 text-[10px] font-medium px-2.5 py-1 rounded-lg bg-secondary/60 text-foreground-muted hover:bg-primary/8 hover:text-primary border border-border/50 transition-all whitespace-nowrap"
            >
              {a.label}
            </button>
          ))}
        </div>

        {/* Input area */}
        <div className="px-3 pb-3 pt-2">
          <div className="flex items-center gap-2 bg-secondary/40 border border-border/60 rounded-xl px-3 py-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="שאל שאלה..."
              className="flex-1 bg-transparent text-[13px] text-foreground placeholder-foreground-muted/50 outline-none"
              disabled={sending}
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || sending}
              className="p-1.5 rounded-lg text-white transition-all disabled:opacity-30"
              style={{
                background: 'linear-gradient(135deg, #E8344D, #FF6B6B)',
                boxShadow: '0 2px 8px rgba(232,52,77,0.3)',
              }}
            >
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
