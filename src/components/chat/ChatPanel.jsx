import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Send, Loader2, MessageSquare, Trash2 } from 'lucide-react';
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
    questions.push(`יש לי ${hotLeads.length} לידים חמים — מה הפעולה הכי דחופה?`);
  }

  // Pending negative reviews
  const negReviews = (reviews || []).filter(r => r.sentiment === 'negative' && r.response_status === 'pending');
  if (negReviews.length > 0) {
    questions.push(`יש ${negReviews.length} ביקורות שליליות ללא מענה — איך לטפל?`);
  }

  // Active alerts
  const criticalAlerts = (alerts || []).filter(a => a.priority === 'high' || a.priority === 'critical');
  if (criticalAlerts.length > 0) {
    questions.push('מה ההתראות הדחופות ביותר שלי עכשיו?');
  }

  // Generic high-value questions if not enough context-specific ones
  if (questions.length < 2) questions.push('מה הפעולה הכי משפיעה שאני יכול לעשות היום?');
  if (questions.length < 3) questions.push('מה מצב הלידים שלי השבוע?');
  if (questions.length < 4) questions.push('איך אני ביחס למתחרים שלי?');

  return questions.slice(0, 4);
}

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
      className="fixed z-50 bg-white rounded-xl border border-[#eeeeee] shadow-lg flex flex-col overflow-hidden"
      style={{
        bottom: 80,
        left: 16,
        width: 'min(380px, calc(100vw - 32px))',
        height: 'min(520px, calc(100vh - 100px))',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#f0f0f0]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-[#f5f5f5] flex items-center justify-center">
            <MessageSquare className="w-3.5 h-3.5 text-[#10b981]" />
          </div>
          <div>
            <span className="text-[13px] font-semibold text-[#111111]">עוזר AI</span>
            {businessProfile?.name && (
              <span className="text-[10px] text-[#999999] block leading-none">{businessProfile.name}</span>
            )}
            {!businessProfile?.name && (
              <span className="text-[10px] text-[#10b981] block leading-none">פעיל</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button onClick={clearHistory} title="נקה שיחה" className="p-1.5 rounded-md hover:bg-[#f5f5f5] transition-colors">
              <Trash2 className="w-3.5 h-3.5 text-[#bbbbbb] hover:text-red-400 transition-colors" />
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-[#f5f5f5] transition-colors">
            <X className="w-4 h-4 text-[#999999]" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ scrollbarWidth: 'none' }}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-start justify-start h-full pt-2 gap-3">
            <div className="w-full text-center pb-1">
              <MessageSquare className="w-7 h-7 text-[#e0e0e0] mx-auto mb-1" />
              <p className="text-[12px] text-[#999999] font-medium">שאל אותי על העסק שלך</p>
            </div>
            <div className="w-full space-y-1.5">
              {suggestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => { setInput(q); }}
                  className="w-full text-right text-[11px] text-[#444444] bg-[#f8f8f8] hover:bg-[#f0f0f0] border border-[#eeeeee] rounded-xl px-3 py-2.5 transition-colors leading-relaxed"
                >
                  {q}
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
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#cccccc]" />
            <span className="text-[12px] text-[#cccccc]">חושב...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 pb-3 pt-2 border-t border-[#f0f0f0]">
        <div className="flex items-center gap-2 bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="שאל שאלה..."
            className="flex-1 bg-transparent text-[13px] text-[#111111] placeholder-[#cccccc] outline-none"
            disabled={sending}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="p-1.5 rounded-md bg-[#111111] text-white hover:bg-[#333333] transition-colors disabled:opacity-30"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
