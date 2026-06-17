import React, { useState, useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Send, Loader2, Sparkles, Trash2, MessageSquare } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

// --- storage helpers ---
function storageKey(bpId) {
  return bpId ? `cortexi_chat_${bpId}` : 'cortexi_chat_default';
}
function loadMessages(bpId) {
  try { return JSON.parse(localStorage.getItem(storageKey(bpId)) || '[]'); } catch { return []; }
}
function saveMessages(msgs, bpId) {
  try { localStorage.setItem(storageKey(bpId), JSON.stringify(msgs.slice(-50))); } catch {}
}

// --- chip detection (mirrors ChatPanel) ---
function detectChips(text) {
  const chips = [];
  if (/לידים?/.test(text)) chips.push({ label: '← לידים', path: '/leads' });
  if (/ביקורות?|מוניטין/.test(text)) chips.push({ label: '← מוניטין', path: '/reviews' });
  if (/מתחרי/.test(text)) chips.push({ label: '← מתחרים', path: '/competitors' });
  if (/תובנ|התראה/.test(text)) chips.push({ label: '← תובנות', path: '/insights' });
  if (/פעולה|כדאי|משימה/.test(text)) chips.push({ label: '+ צור משימה', action: 'create_task' });
  return chips;
}

function formatTime(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

// Group messages by date for the sidebar
function groupByDate(messages) {
  const groups = {};
  messages.forEach((m, idx) => {
    if (!m.timestamp) return;
    const d = new Date(m.timestamp);
    const key = d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });
    if (!groups[key]) groups[key] = [];
    groups[key].push({ ...m, _idx: idx });
  });
  return groups;
}

const SUGGESTED_QUESTIONS = [
  { text: 'מה הפעולה הכי משפיעה שאני יכול לעשות היום?', icon: '🎯' },
  { text: 'מה מצב הלידים שלי השבוע?', icon: '📊' },
  { text: 'איך אני ביחס למתחרים שלי?', icon: '🥊' },
  { text: 'מה ההתראות הדחופות ביותר שלי?', icon: '🔔' },
  { text: 'תן לי תקציר של מה שקרה בעסק היום', icon: '📋' },
  { text: 'איך אפשר לשפר את המוניטין שלי?', icon: '⭐' },
];

export default function Chat() {
  const { businessProfile } = useOutletContext() || {};
  const bpId = businessProfile?.id;
  const navigate = useNavigate();
  const bottomRef = useRef(null);

  const [messages, setMessages] = useState(() => loadMessages(bpId));
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => { setMessages(loadMessages(bpId)); }, [bpId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

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
          const res = await base44.functions.invoke('chatWithBusiness', { businessProfileId: bpId, message: text, history });
          const data = res?.data || res;
          replyText = data?.reply || data?.content || JSON.stringify(data);
        } catch (_) { replyText = null; }
      }

      if (!replyText) {
        const bp = businessProfile;
        const bpContext = bp ? `\nהעסק שלי: ${bp.name} — ${bp.category} ב${bp.city}.` : '';
        const reply = await base44.integrations.Core.InvokeLLM({
          model: 'sonnet',
          maxTokens: 800,
          prompt: `אתה יועץ עסקי AI של מערכת Cortexi.${bpContext}
ענה בעברית, תשובות ישירות ומעשיות.
היסטוריה:
${history}
שאלה: ${text}`,
        });
        replyText = typeof reply === 'string' ? reply : (reply?.content || JSON.stringify(reply));
      }

      const assistantMsg = { role: 'assistant', content: replyText, chips: detectChips(replyText), timestamp: Date.now() };
      const withReply = [...updated, assistantMsg];
      setMessages(withReply);
      saveMessages(withReply, bpId);
    } catch (err) {
      const errMsg = { role: 'assistant', content: 'מצטער, אין חיבור כרגע. נסה שוב.', timestamp: Date.now() };
      const withErr = [...updated, errMsg];
      setMessages(withErr);
      saveMessages(withErr, bpId);
    } finally {
      setSending(false);
    }
  };

  const clearHistory = () => { setMessages([]); saveMessages([], bpId); };

  const handleChip = (chip) => {
    if (chip.path) navigate(chip.path);
    else if (chip.action === 'create_task') navigate('/tasks');
  };

  const dateGroups = groupByDate(messages);

  return (
    <div className="flex gap-4 h-[calc(100vh-120px)]">
      {/* Sidebar — history + suggested questions */}
      <aside className="hidden lg:flex flex-col w-56 flex-shrink-0 gap-3">
        {/* Conversation history grouped by date */}
        {Object.keys(dateGroups).length > 0 ? (
          <div className="bg-white border border-border/50 rounded-xl p-3 flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
            <p className="text-[10px] font-semibold text-foreground-muted/60 uppercase tracking-wider mb-2">היסטוריה</p>
            {Object.entries(dateGroups).reverse().map(([date, msgs]) => (
              <div key={date} className="mb-3">
                <p className="text-[9px] text-foreground-muted/40 mb-1">{date}</p>
                {msgs.filter(m => m.role === 'user').slice(-3).map((m) => (
                  <p key={m._idx} className="text-[10px] text-foreground-muted truncate py-0.5 cursor-pointer hover:text-foreground transition-colors" title={m.content}>
                    {m.content.slice(0, 50)}...
                  </p>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white border border-border/50 rounded-xl p-3">
            <p className="text-[10px] text-foreground-muted/50 text-center">אין היסטוריית שיחות</p>
          </div>
        )}

        {/* Suggested questions */}
        <div className="bg-white border border-border/50 rounded-xl p-3">
          <p className="text-[10px] font-semibold text-foreground-muted/60 uppercase tracking-wider mb-2">שאלות ממומלצות</p>
          <div className="space-y-1">
            {SUGGESTED_QUESTIONS.map((q, i) => (
              <button
                key={i}
                onClick={() => setInput(q.text)}
                className="w-full text-right text-[10px] text-foreground-muted hover:text-primary transition-colors py-1 flex items-start gap-1.5"
              >
                <span className="flex-shrink-0 mt-0.5">{q.icon}</span>
                <span className="truncate">{q.text}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col bg-white border border-border/50 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #E8344D, #FF6B6B)' }}>
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="text-[14px] font-semibold text-foreground">יועץ AI</span>
              {businessProfile?.name && (
                <span className="text-[11px] text-foreground-muted block leading-none">{businessProfile.name}</span>
              )}
            </div>
          </div>
          {messages.length > 0 && (
            <button onClick={clearHistory} title="נקה שיחה"
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-foreground-muted/60 hover:text-danger border border-border/50 rounded-lg hover:border-danger/30 transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> נקה שיחה
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, rgba(232,52,77,0.1), rgba(232,52,77,0.05))' }}>
                <MessageSquare className="w-6 h-6 text-primary/50" />
              </div>
              <div>
                <p className="text-[15px] font-medium text-foreground mb-1">יועץ עסקי AI</p>
                <p className="text-[13px] text-foreground-muted">שאל אותי כל שאלה על העסק שלך</p>
              </div>
            </div>
          ) : (
            messages.filter(m => m.role !== 'system').map((msg, i) => {
              const isUser = msg.role === 'user';
              return (
                <div key={i} className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
                  {!isUser && (
                    <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ background: 'linear-gradient(135deg, #E8344D, #FF6B6B)' }}>
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                  )}
                  <div className={cn('max-w-[75%]', isUser && 'flex flex-col items-end')}>
                    <div className="rounded-2xl px-4 py-3 text-[13px] leading-relaxed"
                      style={isUser ? { background: 'linear-gradient(135deg, #E8344D 0%, #FF6B6B 100%)' } : undefined}>
                      {isUser ? (
                        <p className="text-white">{msg.content}</p>
                      ) : (
                        <div className="bg-secondary/60 rounded-2xl px-4 py-3 -mx-4 -my-3">
                          <ReactMarkdown className="prose prose-sm max-w-none text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5">
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                    {/* Action chips */}
                    {!isUser && msg.chips?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {msg.chips.map(chip => (
                          <button key={chip.label} onClick={() => handleChip(chip)}
                            className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-primary/8 text-primary border border-primary/20 hover:bg-primary/15 transition-all">
                            {chip.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {msg.timestamp && (
                      <span className="text-[9px] text-foreground-muted/40 mt-1 block">{formatTime(msg.timestamp)}</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
          {sending && (
            <div className="flex items-center gap-2 px-3 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary/50" />
              <span className="text-[13px] text-primary/50">חושב...</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-border/50 px-4 py-3">
          <div className="flex items-center gap-3 bg-secondary/40 border border-border/60 rounded-xl px-4 py-2.5">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="שאל שאלה..."
              className="flex-1 bg-transparent text-[14px] text-foreground placeholder-foreground-muted/50 outline-none"
              disabled={sending}
              autoFocus
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || sending}
              className="p-2 rounded-lg text-white transition-all disabled:opacity-30"
              style={{ background: 'linear-gradient(135deg, #E8344D, #FF6B6B)', boxShadow: '0 2px 8px rgba(232,52,77,0.3)' }}
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
