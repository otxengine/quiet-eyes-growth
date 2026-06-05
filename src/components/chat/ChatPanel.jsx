import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Send, Loader2, Sparkles, Trash2 } from 'lucide-react';
import ChatMessage from './ChatMessage';
import { useQuery } from '@tanstack/react-query';

// Storage key is scoped to the specific business so histories never bleed between accounts.
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

// Build context-aware suggested questions based on real business state
function buildSuggestions(profile, alerts, leads, reviews) {
  const questions = [];

  // Hot leads
  const hotLeads = (leads || []).filter(l => l.status === 'hot');
  if (hotLeads.length > 0) {
    questions.push({ text: `יש לי ${hotLeads.length} לידים חמים — מה הפעולה הכי דחופה?`, icon: '🎯' });
  }

  // Pending negative reviews
  const negReviews = (reviews || []).filter(r => r.sentiment === 'negative' && r.response_status === 'pending');
  if (negReviews.length > 0) {
    questions.push({ text: `יש ${negReviews.length} ביקורות שליליות ללא מענה — איך לטפל?`, icon: '⭐' });
  }

  // Active alerts
  const criticalAlerts = (alerts || []).filter(a => a.priority === 'high' || a.priority === 'critical');
  if (criticalAlerts.length > 0) {
    questions.push({ text: 'מה ההתראות הדחופות ביותר שלי עכשיו?', icon: '🎯' });
  }

  // Generic high-value questions if not enough context-specific ones
  if (questions.length < 2) questions.push({ text: 'מה הפעולה הכי משפיעה שאני יכול לעשות היום?', icon: '🎯' });
  if (questions.length < 3) questions.push({ text: 'מה מצב הלידים שלי השבוע?', icon: '📊' });
  if (questions.length < 4) questions.push({ text: 'איך אני ביחס למתחרים שלי?', icon: '❓' });

  return questions.slice(0, 4);
}

const QUICK_ACTIONS = [
  { label: '📋 תקציר יומי', prompt: 'תן לי תקציר של מה שקרה בעסק היום' },
  { label: '🔥 פעולה דחופה', prompt: 'מה הפעולה הכי דחופה שאני צריך לעשות עכשיו?' },
  { label: '📈 מצב שוק', prompt: 'מה מצב השוק והמתחרים שלי עכשיו?' },
];

export default function ChatPanel({ onClose, businessProfile }) {
  const bpId = businessProfile?.id;

  const [messages, setMessages] = useState(() => loadMessages(bpId));
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  // Fetch context to build smart suggested questions
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

  // When the business changes (or first load), reload the correct history.
  useEffect(() => {
    setMessages(loadMessages(bpId));
  }, [bpId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput('');

    const userMsg = { role: 'user', content: text };
    const updated = [...messages, userMsg];
    setMessages(updated);
    saveMessages(updated, bpId);
    setSending(true);

    try {
      // Last 8 turns as plain history string for context
      const history = updated.slice(-8)
        .map(m => `${m.role === 'user' ? 'משתמש' : 'עוזר'}: ${m.content}`)
        .join('\n');

      let replyText;

      // Prefer the server-side function when a business is loaded —
      // it fetches real signals / competitors and builds a rich system prompt.
      if (bpId) {
        try {
          const res = await base44.functions.invoke('chatWithBusiness', {
            businessProfileId: bpId,
            message: text,
            history,
          });
          const data = res?.data || res;
          replyText = data?.reply || data?.content || JSON.stringify(data);
        } catch (_) {
          // Fall back to generic LLM if server function not available
          replyText = null;
        }
      }

      // Generic fallback (no business context)
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

      const assistantMsg = { role: 'assistant', content: replyText };
      const withReply = [...updated, assistantMsg];
      setMessages(withReply);
      saveMessages(withReply, bpId);
    } catch (err) {
      console.error('[Chat] Error:', err);
      const errMsg = { role: 'assistant', content: 'מצטער, אין חיבור כרגע. נסה שוב.' };
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

  return (
    <div
      className="fixed z-50 flex flex-col overflow-hidden"
      style={{
        bottom: 88,
        left: 16,
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
              <p className="text-[12px] text-foreground-muted font-medium">שאל אותי על העסק שלך</p>
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
            <ChatMessage key={i} message={msg} />
          ))
        )}
        {sending && (
          <div className="flex items-center gap-2 px-3 py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary/50" />
            <span className="text-[12px] text-primary/50">חושב...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick Actions + Input */}
      <div className="border-t border-border/50">
        {/* Quick Action Bar */}
        <div className="px-3 pt-2 flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {QUICK_ACTIONS.map(a => (
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
              onClick={handleSend}
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
