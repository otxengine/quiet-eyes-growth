import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Plus, Loader2, MessageSquare, Bot, User, UserCheck, RefreshCw, Phone } from 'lucide-react';
import { toast } from 'sonner';
import AddLeadModal from '@/components/leads/AddLeadModal';
import LeadDetailPanel from '@/components/leads/LeadDetailPanel';
import PageHeader from '@/components/shared/PageHeader';
import StatCards from '@/components/shared/StatCards';
import UrgentActionsSection from '@/components/shared/UrgentActionsSection';
import DataTable from '@/components/shared/DataTable';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

async function apiFetch(path) {
  const token = window.__clerk?.session
    ? await window.__clerk.session.getToken().catch(() => null)
    : localStorage.getItem('clerk_session_token') || null;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : { 'x-dev-user': 'dev-user' },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPatch(path) {
  const token = window.__clerk?.session
    ? await window.__clerk.session.getToken().catch(() => null)
    : localStorage.getItem('clerk_session_token') || null;
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

function timeAgo(d) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

function ConversationChat({ convo, businessProfile, onRestart }) {
  const [restarting, setRestarting] = useState(false);

  const { data: full, isLoading } = useQuery({
    queryKey: ['convoFull', convo?.sender_id],
    queryFn:  () => apiFetch(`/conversations/by-phone/${encodeURIComponent(convo.sender_id)}`),
    enabled:  !!convo,
    refetchInterval: 30000,
  });

  const handleRestart = async () => {
    if (!full?.id) return;
    setRestarting(true);
    try {
      await apiPatch(`/conversations/${full.id}/reactivate`);
      onRestart();
      toast.success('Bot restarted');
    } catch (e) { toast.error(e.message); }
    setRestarting(false);
  };

  if (!convo) return (
    <div className="flex flex-col items-center justify-center h-full text-foreground-muted">
      <MessageSquare className="w-10 h-10 opacity-20 mb-3" />
      <p className="text-[13px]">Select a conversation to view</p>
    </div>
  );

  if (isLoading) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-5 h-5 animate-spin text-foreground-muted" />
    </div>
  );

  const messages = full?.messages ?? [];
  const intl = convo.sender_id?.replace(/[^0-9]/g, '').replace(/^0/, '972');

  return (
    <div className="flex flex-col h-full">
      {/* Chat header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div>
          <p className="text-[13px] font-semibold text-foreground">
            {convo.lead_name || convo.sender_id}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
              convo.status === 'human_handoff'
                ? 'bg-amber-50 text-amber-700'
                : 'bg-green-50 text-green-700'
            }`}>
              {convo.status === 'human_handoff' ? 'Human handoff' : 'Bot active'}
            </span>
            {convo.lead_id && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                convo.lead_status === 'hot' ? 'bg-red-50 text-red-600' :
                convo.lead_status === 'warm' ? 'bg-amber-50 text-amber-600' :
                'bg-blue-50 text-blue-600'
              }`}>
                {convo.lead_status === 'hot' ? '🔥' : convo.lead_status === 'warm' ? '⚡' : '•'} Lead created
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {intl && (
            <a href={`https://wa.me/${intl}`} target="_blank" rel="noopener"
              className="text-[11px] text-[#25D366] border border-[#25D366]/30 rounded-md px-2.5 py-1 hover:bg-[#25D366]/5 flex items-center gap-1">
              <Phone className="w-3 h-3" /> Open WhatsApp
            </a>
          )}
          {full?.human_takeover && (
            <button onClick={handleRestart} disabled={restarting}
              className="text-[11px] text-primary border border-primary/30 rounded-md px-2.5 py-1 hover:bg-primary/5 flex items-center gap-1 disabled:opacity-50">
              {restarting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Restart bot
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-secondary/10">
        {messages.length === 0 && (
          <p className="text-center text-[12px] text-foreground-muted py-8">No messages yet</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === 'bot' ? 'flex-row-reverse' : 'flex-row'}`}>
            <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
              msg.role === 'bot' ? 'bg-primary/10 text-primary' : 'bg-white border border-border text-foreground-muted'
            }`}>
              {msg.role === 'bot' ? <Bot className="w-3 h-3" /> : <User className="w-3 h-3" />}
            </div>
            <div className={`max-w-[75%] rounded-xl px-3 py-2 ${
              msg.role === 'bot' ? 'bg-primary/10 text-foreground' : 'bg-white border border-border text-foreground-secondary'
            }`}>
              <p className="text-[12px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
              <p className="text-[9px] text-foreground-muted mt-1 opacity-60">{timeAgo(msg.time)}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Handoff banner */}
      {full?.human_takeover && (
        <div className="px-4 py-2 border-t border-border bg-amber-50 flex items-center gap-2">
          <UserCheck className="w-3.5 h-3.5 text-amber-600" />
          <p className="text-[11px] text-amber-700">{full.handoff_reason || 'Transferred to human'}</p>
        </div>
      )}
    </div>
  );
}

function ConversationsTab({ bpId, businessProfile }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState(null);

  const { data: convos = [], isLoading } = useQuery({
    queryKey: ['allConversations', bpId],
    queryFn:  () => apiFetch(`/conversations/all/${bpId}`),
    enabled:  !!bpId,
    refetchInterval: 30000,
  });

  if (isLoading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
    </div>
  );

  if (convos.length === 0) return (
    <div className="flex flex-col items-center justify-center py-20 text-foreground-muted">
      <MessageSquare className="w-10 h-10 opacity-20 mb-3" />
      <p className="text-[13px]">No conversations yet</p>
      <p className="text-[11px] mt-1 opacity-60">WhatsApp bot conversations will appear here</p>
    </div>
  );

  return (
    <div className="flex border border-border rounded-xl overflow-hidden bg-card" style={{ height: '60vh' }}>
      {/* Left: conversation list */}
      <div className="w-72 flex-shrink-0 border-r border-border overflow-y-auto">
        {convos.map(c => (
          <button
            key={c.id}
            onClick={() => setSelected(c)}
            className={`w-full text-right px-4 py-3 border-b border-border hover:bg-secondary/50 transition-colors ${
              selected?.id === c.id ? 'bg-secondary' : ''
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-foreground-muted">{timeAgo(c.last_message_at)}</span>
              <div className="flex items-center gap-1">
                {c.lead_id ? (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                    c.lead_status === 'hot' ? 'bg-red-50 text-red-600' :
                    c.lead_status === 'warm' ? 'bg-amber-50 text-amber-600' :
                    'bg-blue-50 text-blue-600'
                  }`}>
                    {c.lead_status === 'hot' ? '🔥' : '⚡'} Lead
                  </span>
                ) : (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">No lead</span>
                )}
              </div>
            </div>
            <p className="text-[12px] font-medium text-foreground truncate">
              {c.lead_name || c.sender_id}
            </p>
            <p className="text-[11px] text-foreground-muted truncate mt-0.5">{c.last_message || '—'}</p>
            <span className={`text-[9px] mt-1 inline-block px-1.5 py-0.5 rounded-full ${
              c.status === 'human_handoff' ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'
            }`}>
              {c.status === 'human_handoff' ? 'Handoff' : 'Bot active'}
            </span>
          </button>
        ))}
      </div>

      {/* Right: full chat */}
      <div className="flex-1 overflow-hidden">
        <ConversationChat
          convo={selected}
          businessProfile={businessProfile}
          onRestart={() => qc.invalidateQueries({ queryKey: ['allConversations', bpId] })}
        />
      </div>
    </div>
  );
}

const stages = [
  { key: 'new',         label: 'חדש',          color: 'bg-secondary text-foreground-secondary' },
  { key: 'contacted',   label: 'נוצר קשר',      color: 'bg-blue-50 text-blue-600' },
  { key: 'meeting',     label: 'פגישה',          color: 'bg-amber-50 text-amber-600' },
  { key: 'negotiation', label: 'משא ומתן',       color: 'bg-purple-50 text-purple-600' },
  { key: 'closed_won',  label: 'נסגר ✓',         color: 'bg-green-50 text-green-600' },
  { key: 'closed_lost', label: 'אבד',            color: 'bg-red-50 text-red-400' },
];

const SOURCE_ICONS = {
  google:    { label: 'G', bg: 'bg-red-100',   text: 'text-red-600' },
  facebook:  { label: 'f', bg: 'bg-blue-100',  text: 'text-blue-700' },
  whatsapp:  { label: 'W', bg: 'bg-green-100', text: 'text-green-700' },
  instagram: { label: 'ig', bg: 'bg-pink-100', text: 'text-pink-600' },
};

function ContactIcons({ lead }) {
  return (
    <div className="flex items-center gap-1.5">
      {lead.contact_phone && (
        <a
          href={`https://wa.me/${lead.contact_phone?.replace(/\D/g, '')}`}
          target="_blank"
          rel="noreferrer"
          title="WhatsApp"
          className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center text-green-700 text-[10px] font-bold hover:bg-green-200 transition-colors"
        >
          W
        </a>
      )}
      {lead.contact_phone && (
        <a
          href={`tel:${lead.contact_phone}`}
          title="שיחה"
          className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 text-[10px] hover:bg-gray-200 transition-colors"
        >
          ☎
        </a>
      )}
      {lead.source === 'facebook' && (
        <span className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-[10px] font-bold">f</span>
      )}
      {(lead.source === 'google' || lead.source === 'google_ads') && (
        <span className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-[10px] font-bold">G</span>
      )}
    </div>
  );
}

const COLUMNS = [
  { key: 'name',    label: 'שם' },
  { key: 'role',    label: 'תפקיד' },
  { key: 'company', label: 'חברה' },
  { key: 'city',    label: 'מיקום' },
  { key: 'source',  label: 'מקור' },
  { key: 'contact', label: 'יצירת קשר' },
];

export default function Leads() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [activeTab, setActiveTab] = useState('leads');

  const { data: allLeadsRaw = [], isLoading } = useQuery({
    queryKey: ['leadsPage', bpId],
    queryFn: () => base44.entities.Lead.filter({ linked_business: bpId }, '-score', 200),
    enabled: !!bpId,
  });

  const leads = allLeadsRaw.filter(l => !l.is_archived);
  const today = new Date().toISOString().slice(0, 10);
  const todayLeads  = leads.filter(l => (l.created_at || '').startsWith(today));
  const hotLeads    = leads.filter(l => l.status === 'hot');
  const urgentLeads = leads.filter(l => l.status === 'hot' && !l.last_contacted_at);
  const sources     = new Set(leads.map(l => l.source).filter(Boolean));

  // Urgent actions for section
  const urgentActions = [
    urgentLeads[0] && {
      title: `ליד חם ממתין: ${urgentLeads[0].name}`,
      description: urgentLeads[0].service_needed || 'לא נוצר קשר עדיין',
      ctaLabel: 'צור קשר עכשיו',
      onCta: () => setSelectedLead(urgentLeads[0]),
    },
    urgentLeads[1] && {
      title: `ליד חם נוסף: ${urgentLeads[1].name}`,
      description: urgentLeads[1].service_needed || 'ממתין לטיפול',
      ctaLabel: 'פתח ליד',
      onCta: () => setSelectedLead(urgentLeads[1]),
    },
  ].filter(Boolean);

  const statCards = [
    { count: todayLeads.length, label: 'לידים מהיום',          borderColor: 'blue' },
    { count: hotLeads.length,   label: 'לידים חמים',           borderColor: 'red' },
    { count: urgentLeads.length,label: 'דורש פעולה מיידית',    borderColor: 'yellow' },
    { count: sources.size,      label: 'מקורות',               borderColor: 'none' },
  ];

  const sourceLabel = (src) => {
    const map = { google: 'Google', facebook: 'Facebook', instagram: 'Instagram', whatsapp: 'WhatsApp', web: 'אתר', manual: 'ידני' };
    return map[src] || src || '—';
  };

  return (
    <div className="space-y-5">
      <PageHeader
        count={leads.length}
        title="לידים"
        actionLabel="ליד חדש"
        actionIcon={<Plus className="w-4 h-4" />}
        onAction={() => setShowAddModal(true)}
      />

      <StatCards cards={statCards} />

      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-border pb-0">
        <button
          onClick={() => setActiveTab('leads')}
          className={`px-4 py-2 text-[13px] font-medium rounded-t-md transition-colors ${
            activeTab === 'leads'
              ? 'bg-card border border-border border-b-card text-foreground -mb-px'
              : 'text-foreground-muted hover:text-foreground'
          }`}
        >
          לידים
        </button>
        <button
          onClick={() => setActiveTab('conversations')}
          className={`px-4 py-2 text-[13px] font-medium rounded-t-md transition-colors flex items-center gap-1.5 ${
            activeTab === 'conversations'
              ? 'bg-card border border-border border-b-card text-foreground -mb-px'
              : 'text-foreground-muted hover:text-foreground'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          שיחות WhatsApp
        </button>
      </div>

      {activeTab === 'conversations' ? (
        <ConversationsTab bpId={bpId} businessProfile={businessProfile} />
      ) : (
        <>
      {urgentActions.length > 0 && (
        <UrgentActionsSection actions={urgentActions} />
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
        </div>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={leads}
          emptyText="אין לידים — הסוכן ימצא לידים אוטומטית"
          renderCell={(lead, col) => {
            if (col.key === 'name')    return (
              <button
                onClick={() => setSelectedLead(lead)}
                className="font-semibold text-foreground hover:text-[#e8344d] transition-colors"
              >
                {lead.name || '—'}
              </button>
            );
            if (col.key === 'role')    return <span className="text-foreground-secondary text-xs">{lead.role || lead.job_title || '—'}</span>;
            if (col.key === 'company') return <span className="text-foreground-secondary text-xs">{lead.company || '—'}</span>;
            if (col.key === 'city')    return <span className="text-foreground-secondary text-xs">{lead.city || lead.location || '—'}</span>;
            if (col.key === 'source')  return (
              <span className="text-xs bg-gray-100 text-foreground-secondary px-2 py-0.5 rounded-full">
                {sourceLabel(lead.source)}
              </span>
            );
            if (col.key === 'contact') return <ContactIcons lead={lead} />;
            return lead[col.key] ?? '—';
          }}
        />
      )}

      {selectedLead && (
        <LeadDetailPanel
          lead={selectedLead}
          businessProfile={businessProfile}
          stages={stages}
          onClose={() => setSelectedLead(null)}
          onStageChange={(newStage) => {
            base44.entities.Lead.update(selectedLead.id, { lifecycle_stage: newStage, lifecycle_updated_at: new Date().toISOString() });
            queryClient.invalidateQueries({ queryKey: ['leadsPage'] });
            setSelectedLead(null);
          }}
        />
      )}
        </>
      )}

      {showAddModal && (
        <AddLeadModal
          businessProfile={businessProfile}
          onClose={() => setShowAddModal(false)}
          onAdded={() => {
            queryClient.invalidateQueries({ queryKey: ['leadsPage'] });
            setShowAddModal(false);
          }}
        />
      )}
    </div>
  );
}
