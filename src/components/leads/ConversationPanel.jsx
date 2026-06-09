import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, User, Bot, UserCheck, Phone, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

function timeAgo(d) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'עכשיו';
  if (mins < 60) return `לפני ${mins} דק'`;
  return `לפני ${Math.floor(mins / 60)} שעות`;
}

async function apiFetch(path) {
  const token = window.__clerk?.session
    ? await window.__clerk.session.getToken().catch(() => null)
    : window.__clerk_session_token || localStorage.getItem('clerk_session_token') || null;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : { 'x-dev-user': 'dev-user' },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPatch(path) {
  const token = window.__clerk?.session
    ? await window.__clerk.session.getToken().catch(() => null)
    : window.__clerk_session_token || localStorage.getItem('clerk_session_token') || null;
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : { 'x-dev-user': 'dev-user' }),
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function ConversationPanel({ lead, businessProfile }) {
  const qc = useQueryClient();
  const [restarting, setRestarting] = useState(false);

  // Use contact_phone (set by bot) or extract from contact_info
  const phone = lead?.contact_phone
    || lead?.contact_info?.match(/[\d\-+()]{7,}/)?.[0]?.replace(/[^0-9+]/g, '')
    || null;

  const { data: convo, isLoading } = useQuery({
    queryKey: ['botConversation', phone],
    queryFn:  () => phone ? apiFetch(`/conversations/by-phone/${phone}`) : null,
    enabled:  !!phone,
    refetchInterval: 30000,
  });

  const messages = convo?.messages ?? [];

  const intl = phone
    ? phone.replace(/[^0-9]/g, '').replace(/^0/, '972')
    : '';

  const handleRestartBot = async () => {
    if (!convo?.id) return;
    setRestarting(true);
    try {
      await apiPatch(`/conversations/${convo.id}/reactivate`);
      qc.invalidateQueries({ queryKey: ['botConversation', phone] });
      toast.success('הבוט הופעל מחדש — ימשיך לענות להודעות הבאות');
    } catch (err) {
      toast.error('שגיאה: ' + err.message);
    }
    setRestarting(false);
  };

  if (!lead) return null;

  if (isLoading) return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="w-4 h-4 animate-spin text-foreground-muted" />
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-foreground-muted" />
          <span className="text-[13px] font-semibold text-foreground">שיחה עם {lead.name}</span>
          {convo && (
            <span className={`text-[10px] font-medium ${convo.status === 'human_handoff' ? 'text-primary' : 'text-success'}`}>
              {convo.status === 'human_handoff' ? 'הועבר לאנוש' : 'פעיל'}
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
          {convo?.human_takeover && (
            <button onClick={handleRestartBot} disabled={restarting}
              className="text-[11px] text-primary border border-primary/30 rounded-md px-2.5 py-1 hover:bg-primary/5 flex items-center gap-1 disabled:opacity-50">
              {restarting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              הפעל בוט מחדש
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
                msg.role === 'bot'
                  ? 'bg-primary/10 text-foreground'
                  : 'bg-white border border-border text-foreground-secondary'
              }`}>
                <p className="text-[11px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                <p className="text-[9px] text-foreground-muted mt-1 opacity-60">{timeAgo(msg.time)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Human handoff banner */}
      {convo?.human_takeover && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg px-3 py-2 flex items-center gap-2">
          <UserCheck className="w-3.5 h-3.5 text-primary" />
          <p className="text-[11px] text-primary">
            הבוט סיים — {convo.handoff_reason || 'הליד הועבר לטיפול אנושי'}
          </p>
        </div>
      )}
    </div>
  );
}