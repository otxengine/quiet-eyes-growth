import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Send, Loader2, MessageSquare } from 'lucide-react';
import ChatMessage from './ChatMessage';

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

export default function ChatPanel({ onClose, businessProfile }) {
  const bpId = businessProfile?.id;

  const [messages, setMessages] = useState(() => loadMessages(bpId));
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

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
          prompt: `אתה עוזר AI של מערכת QuietEyes Intelligence — פלטפורמת מודיעין עסקי לעסקים קטנים בישראל.${bpContext}
המערכת עוקבת אחר מתחרים, מנתחת ביקורות, מייצרת תובנות שוק, וסוכנים AI פועלים ברקע.

היסטוריית השיחה:
${history}

ענה בעברית בלבד. היה ממוקד ותכליתי. עד 3 משפטים אלא אם נדרש יותר.
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
        <button onClick={onClose} className="p-1.5 rounded-md hover:bg-[#f5f5f5] transition-colors">
          <X className="w-4 h-4 text-[#999999]" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ scrollbarWidth: 'none' }}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageSquare className="w-8 h-8 text-[#e0e0e0] mb-2" />
            <p className="text-[13px] text-[#999999]">שלום! אני העוזר AI שלך.</p>
            <p className="text-[11px] text-[#cccccc] mt-1">שאל אותי על הלידים, הביקורות או המתחרים שלך</p>
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
