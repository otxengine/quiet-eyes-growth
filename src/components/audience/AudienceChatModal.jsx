import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import { Send, Loader2, Sparkles, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import AudienceSegmentCard from '@/components/marketing/AudienceSegmentCard';

/**
 * Popup: describe the campaign you want to run, the LLM either asks one
 * short clarifying question or proposes grounded audience segments (via
 * discussTargetAudience) ready to save.
 */
export default function AudienceChatModal({ businessProfileId: bpId, onClose }) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState([]); // { role: 'user'|'assistant', content, segments? }
  const [input,    setInput]    = useState('');
  const [sending,  setSending]  = useState(false);
  const [savedKeys, setSavedKeys] = useState({}); // { "msgIdx-segIdx": true }
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const saveMutation = useMutation({
    mutationFn: (segment) => base44.entities.AudienceSegment.create({
      linked_business: bpId,
      name: segment.segment_name,
      description: segment.description || '',
      segment_json: JSON.stringify(segment),
      source: 'ai_generated',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audienceSegments', bpId] });
      toast.success('הקהל נשמר');
    },
    onError: (err) => toast.error('שגיאה: ' + (err?.message || 'נסה שוב')),
  });

  const handleSave = (segment, key) => {
    saveMutation.mutate(segment, {
      onSuccess: () => setSavedKeys(s => ({ ...s, [key]: true })),
    });
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || !bpId) return;
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    const updated = [...messages, { role: 'user', content: text }];
    setMessages(updated);
    setInput('');
    setSending(true);
    try {
      const res = await base44.functions.invoke('discussTargetAudience', {
        businessProfileId: bpId,
        message: text,
        history,
      });
      const data = res?.data || res;
      setMessages([...updated, {
        role: 'assistant',
        content: data?.reply || 'מצטער, לא הצלחתי לעבד את הבקשה.',
        segments: data?.segments || [],
      }]);
    } catch (err) {
      setMessages([...updated, { role: 'assistant', content: 'שגיאה: ' + (err?.message || 'נסה שוב'), segments: [] }]);
    }
    setSending(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" dir="rtl" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-card rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-[14px] font-bold text-foreground">מצא קהל יעד לקמפיין</span>
          <button onClick={onClose} className="mr-auto text-foreground-muted hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 && (
            <p className="text-[12px] text-foreground-muted text-center py-6">
              ספר לי איזה קמפיין אתה רוצה לפרסם — מה מקדמים, למי, ומה המטרה — ואני אמצא קהל יעד מתאים.
            </p>
          )}

          {messages.map((msg, i) => {
            const isUser = msg.role === 'user';
            return (
              <div key={i} className={cn('flex gap-2', isUser ? 'justify-end' : 'justify-start')}>
                {!isUser && (
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: 'linear-gradient(135deg, #E8344D, #FF6B6B)' }}>
                    <Sparkles className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
                <div className={cn('max-w-[85%] space-y-2.5', isUser && 'flex flex-col items-end')}>
                  <div className="rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed"
                    style={isUser ? { background: 'linear-gradient(135deg, #E8344D 0%, #FF6B6B 100%)' } : undefined}>
                    {isUser ? (
                      <p className="text-white">{msg.content}</p>
                    ) : (
                      <div className="bg-secondary/60 rounded-2xl px-4 py-2.5 -mx-4 -my-2.5">
                        <ReactMarkdown className="prose prose-sm max-w-none text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1">
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>

                  {msg.segments?.length > 0 && (
                    <div className="w-full space-y-2.5">
                      {msg.segments.map((seg, si) => {
                        const key = `${i}-${si}`;
                        return (
                          <AudienceSegmentCard
                            key={si}
                            segment={seg}
                            actions={
                              savedKeys[key] ? (
                                <span className="flex items-center gap-1 text-[11px] text-green-700 font-medium">
                                  <Check className="w-3.5 h-3.5" /> נשמר
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleSave(seg, key)}
                                  disabled={saveMutation.isPending}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-foreground text-background rounded-lg text-[11px] font-semibold hover:opacity-90 disabled:opacity-60"
                                >
                                  שמור קהל
                                </button>
                              )
                            }
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {sending && (
            <div className="flex items-center gap-2 px-1">
              <Loader2 className="w-4 h-4 animate-spin text-primary/50" />
              <span className="text-[13px] text-primary/50">חושב...</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center gap-2 bg-secondary/40 border border-border/60 rounded-xl px-3 py-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="למשל: מבצע קיץ על זרי כלה לזוגות טריים..."
              className="flex-1 bg-transparent text-[13px] text-foreground placeholder-foreground-muted/50 outline-none"
              disabled={sending}
              autoFocus
            />
            <button onClick={handleSend} disabled={sending || !input.trim()}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-white disabled:opacity-40 flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #E8344D, #FF6B6B)' }}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
