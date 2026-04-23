import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { MessageSquare, Bot, User } from 'lucide-react';

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

export default function LeadConversationHistory({ lead }) {
  const phone = lead.contact_info?.match(/[\d\-+()]{7,}/)?.[0]?.replace(/[^0-9+]/g, '');

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ['leadConversations', lead.linked_business, phone],
    queryFn: () => base44.entities.ConversationHistory.filter({
      linked_business: lead.linked_business,
      sender_id: phone,
    }, '-last_message_at', 5),
    enabled: !!phone && !!lead.linked_business,
  });

  if (!phone) return null;
  if (isLoading) return <p className="text-[11px] text-foreground-muted py-2">טוען שיחות...</p>;
  if (conversations.length === 0) return null;

  return (
    <div>
      <h4 className="text-[11px] font-semibold text-foreground mb-2 flex items-center gap-1.5">
        <MessageSquare className="w-3.5 h-3.5 text-foreground-muted" /> היסטוריית שיחות
      </h4>
      <div className="space-y-2 max-h-60 overflow-y-auto">
        {conversations.map(conv => {
          let messages = [];
          try { messages = JSON.parse(conv.messages || '[]'); } catch (_) {}
          return (
            <div key={conv.id} className="rounded-lg border border-border bg-secondary/20 overflow-hidden">
              <div className="px-3 py-2 border-b border-border bg-secondary/40 flex items-center justify-between">
                <span className="text-[10px] font-medium text-foreground-secondary capitalize">{conv.platform}</span>
                <span className="text-[9px] text-foreground-muted">{formatTime(conv.last_message_at)}</span>
              </div>
              {conv.summary && (
                <div className="px-3 py-1.5 border-b border-border bg-white">
                  <p className="text-[10px] text-foreground-muted italic">סיכום: {conv.summary}</p>
                </div>
              )}
              <div className="px-3 py-2 space-y-1.5">
                {messages.length === 0 && <p className="text-[10px] text-foreground-muted">אין הודעות שמורות</p>}
                {messages.slice(-8).map((msg, i) => {
                  const isBot = msg.role === 'bot' || msg.role === 'assistant';
                  return (
                    <div key={i} className={`flex items-start gap-1.5 ${isBot ? '' : 'flex-row-reverse'}`}>
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${isBot ? 'bg-primary/10' : 'bg-secondary'}`}>
                        {isBot ? <Bot className="w-2.5 h-2.5 text-primary" /> : <User className="w-2.5 h-2.5 text-foreground-muted" />}
                      </div>
                      <div className={`max-w-[80%] rounded-lg px-2.5 py-1.5 ${isBot ? 'bg-white border border-border' : 'bg-foreground text-background'}`}>
                        <p className="text-[10px] leading-relaxed">{msg.content || msg.text || ''}</p>
                        {msg.timestamp && <p className={`text-[8px] mt-0.5 ${isBot ? 'text-foreground-muted' : 'text-background/60'}`}>{formatTime(msg.timestamp)}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}