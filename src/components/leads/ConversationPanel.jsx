import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { MessageSquare, User, Bot, UserCheck, Phone, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

function timeAgo(d) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'עכשיו';
  if (mins < 60) return `לפני ${mins} דק'`;
  return `לפני ${Math.floor(mins / 60)} שעות`;
}

const statusConfig = {
  active:     { label: 'בתהליך', color: 'text-warning' },
  qualified:  { label: 'מוסמך', color: 'text-success' },
  rejected:   { label: 'לא מתאים', color: 'text-danger' },
  handed_off: { label: 'הועבר לאנוש', color: 'text-primary' },
  closed:     { label: 'סגור', color: 'text-foreground-muted' },
};

export default function ConversationPanel({ lead, businessProfile }) {
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const [customMsg, setCustomMsg] = useState('');

  const { data: convos = [], isLoading } = useQuery({
    queryKey: ['conversations', lead?.id],
    queryFn: () => base44.entities.ConversationHistory.filter({ lead_id: String(lead.id) }),
    enabled: !!lead?.id,
    refetchInterval: 30000,
  });

  const convo = convos[0];
  const messages = (() => { try { return JSON.parse(convo?.messages || '[]'); } catch { return []; } })();

  const handleHumanTakeover = async () => {
    await base44.functions.invoke('whatsappBotHandler', {
      mode: 'human_takeover',
      lead_id: lead.id,
    });
    qc.invalidateQueries({ queryKey: ['conversations', lead.id] });
    toast.success('הבוט עצר — עכשיו אתה מנהל את השיחה');
  };

  const handleSendCustom = async () => {
    if (!customMsg.trim()) return;
    setSending(true);
    const phone = lead.contact_info?.match(/[\d\-+()]{7,}/)?.[0] || '';
    const normalized = phone.replace(/[^0-9]/g, '');
    const intl = normalized.startsWith('0') ? '972' + normalized.slice(1) : normalized;
    if (intl) {
      window.open(`https://wa.me/${intl}?text=${encodeURIComponent(customMsg)}`, '_blank');
    }
    setCustomMsg('');
    setSending(false);
    toast.success('נפתח WhatsApp ✓');
  };

  if (!lead) return null;
  if (isLoading) return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="w-4 h-4 animate-spin text-foreground-muted" />
    </div>
  );

  const phone = lead.contact_info?.match(/[\d\-+()]{7,}/)?.[0] || '';
  const intl = phone.replace(/[^0-9]/g, '').replace(/^0/, '972');

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-foreground-muted" />
          <span className="text-[13px] font-semibold text-foreground">שיחה עם {lead.name}</span>
          {convo && (
            <span className={`text-[10px] font-medium ${statusConfig[convo.status]?.color || ''}`}>
              {statusConfig[convo.status]?.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {intl && (
            <a href={`https://wa.me/${intl}`} target="_blank" rel="noopener"
              className="text-[11px] text-[#25D366] border border-[#25D366]/30 rounded-md px-2.5 py-1 hover:bg-[#25D366]/5 flex items-center gap-1">
              <Phone className="w-3 h-3" /> פתח WhatsApp
            </a>
          )}
          {convo && !convo.human_takeover && (
            <button onClick={handleHumanTakeover}
              className="text-[11px] text-primary border border-primary/30 rounded-md px-2.5 py-1 hover:bg-primary/5 flex items-center gap-1">
              <UserCheck className="w-3 h-3" /> קח שליטה
            </button>
          )}
        </div>
      </div>

      {/* No conversation yet */}
      {!convo && (
        <div className="bg-secondary/50 rounded-xl p-6 text-center">
          <Bot className="w-8 h-8 text-foreground-muted opacity-40 mx-auto mb-2" />
          <p className="text-[12px] text-foreground-muted">עדיין אין שיחת בוט עם הליד הזה</p>
          {intl && (
            <a href={`https://wa.me/${intl}?text=${encodeURIComponent(businessProfile?.bot_greeting || 'שלום!')}`}
              target="_blank" rel="noopener"
              className="inline-flex items-center gap-1.5 mt-3 text-[11px] font-medium bg-[#25D366] text-white px-3 py-1.5 rounded-lg hover:opacity-90">
              <MessageSquare className="w-3 h-3" /> התחל שיחה
            </a>
          )}
        </div>
      )}

      {/* Message thread */}
      {convo && messages.length > 0 && (
        <div className="space-y-2 max-h-72 overflow-y-auto rounded-xl border border-border p-3 bg-secondary/20">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-2 ${msg.role === 'bot' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                msg.role === 'bot' ? 'bg-primary/10 text-primary' : 'bg-secondary text-foreground-muted'
              }`}>
                {msg.role === 'bot' ? <Bot className="w-3 h-3" /> : <User className="w-3 h-3" />}
              </div>
              <div className={`max-w-[80%] rounded-xl px-3 py-2 ${
                msg.role === 'bot' ? 'bg-primary/10 text-foreground' : 'bg-white border border-border text-foreground-secondary'
              }`}>
                <p className="text-[11px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                <p className="text-[9px] text-foreground-muted mt-1 opacity-60">{timeAgo(msg.time)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Qualification progress */}
      {convo && convo.status === 'active' && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${((convo.qualification_step || 0) / (convo.total_steps || 1)) * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-foreground-muted shrink-0">
            שאלה {convo.qualification_step || 0}/{convo.total_steps || '?'}
          </span>
        </div>
      )}

      {/* Human takeover active */}
      {convo?.human_takeover && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg px-3 py-2 flex items-center gap-2">
          <UserCheck className="w-3.5 h-3.5 text-primary" />
          <p className="text-[11px] text-primary">אתה מנהל את השיחה — הבוט שקט</p>
        </div>
      )}

      {/* Custom message send when human is in control */}
      {convo?.human_takeover && (
        <div className="flex gap-2">
          <input
            value={customMsg}
            onChange={(e) => setCustomMsg(e.target.value)}
            placeholder="כתוב הודעה ושלח דרך WhatsApp..."
            className="flex-1 border border-border rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:border-primary"
            onKeyDown={(e) => e.key === 'Enter' && handleSendCustom()}
          />
          <button
            onClick={handleSendCustom}
            disabled={sending || !customMsg.trim()}
            className="bg-[#25D366] text-white rounded-lg px-3 py-2 text-[11px] font-medium hover:opacity-90 disabled:opacity-40"
          >
            שלח
          </button>
        </div>
      )}
    </div>
  );
}
