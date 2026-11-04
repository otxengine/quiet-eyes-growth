import React, { useState, useMemo } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Plus, Loader2, MessageSquare, Bot, User, UserCheck, RefreshCw, Phone, Search, ChevronDown, Settings2, Clock, X, MoreVertical, Info, Pencil, Share2, Archive, Trash2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import AddLeadModal from '@/components/leads/AddLeadModal';
import LeadDetailPanel from '@/components/leads/LeadDetailPanel';
import LeadSettingsPanel from '@/components/leads/LeadSettingsPanel';
import PageHeader from '@/components/shared/PageHeader';
import StatCards from '@/components/shared/StatCards';
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

// Filter tab keys — counts filled dynamically per-render
const FILTER_TAB_DEFS = [
  { key: 'all',    label: 'כל הלידים' },
  { key: 'hot',    label: 'לידים חמים' },
  { key: 'today',  label: 'לידים מהיום' },
  { key: 'week',   label: 'חזרו להתעניין השבוע' },
];

const stages = [
  { key: 'new',         label: 'חדש',          color: 'bg-secondary text-foreground-secondary' },
  { key: 'contacted',   label: 'נוצר קשר',      color: 'bg-blue-50 text-blue-600' },
  { key: 'meeting',     label: 'פגישה',          color: 'bg-amber-50 text-amber-600' },
  { key: 'negotiation', label: 'משא ומתן',       color: 'bg-purple-50 text-purple-600' },
  { key: 'closed_won',  label: 'נסגר ✓',         color: 'bg-green-50 text-green-600' },
  { key: 'closed_lost', label: 'אבד',            color: 'bg-red-50 text-red-400' },
];

// ── "כדאי לטפל היום" insight card ─────────────────────────────────────────────
function InsightCard({ title, description, ctaLabel, onCta, accent = 'violet' }) {
  const styles = {
    violet: { bg: 'from-violet-50 to-indigo-50', border: 'border-violet-100', cta: '#e8344d', ctaBg: '#fce4ec', ctaText: '#e8344d' },
    red:    { bg: 'from-red-50 to-pink-50',      border: 'border-red-100',    cta: '#e8344d', ctaBg: '#fce4ec', ctaText: '#e8344d' },
  };
  const s = styles[accent] || styles.violet;
  return (
    <div className={`rounded-xl border ${s.border} bg-gradient-to-br ${s.bg} p-4 flex flex-col gap-2`}>
      <p className="text-[13px] font-bold text-gray-800 text-right leading-snug">{title}</p>
      <p className="text-[11px] text-gray-500 text-right leading-relaxed">{description}</p>
      <div className="flex items-center gap-2 justify-start mt-1">
        {ctaLabel && (
          <button
            onClick={onCta}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors"
            style={{ borderColor: s.cta, color: s.ctaText, background: s.ctaBg }}
          >
            {ctaLabel}
          </button>
        )}
        <div className="flex items-center gap-1 text-[10px] text-gray-400">
          <Clock className="w-3 h-3" />
          <span>2 דק'</span>
        </div>
      </div>
    </div>
  );
}

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

function RowMenu({ lead, onView, onArchive, onRestore, onDelete, isOpen, onToggle, isArchive }) {
  return (
    <div className="relative">
      <button
        onClick={e => { e.stopPropagation(); onToggle(); }}
        className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors text-gray-400"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={e => { e.stopPropagation(); onToggle(); }} />
          <div
            className="absolute left-0 top-8 bg-white border border-gray-100 rounded-xl shadow-xl z-40 py-1 min-w-[160px]"
            dir="rtl"
            onClick={e => e.stopPropagation()}
          >
            <button onClick={() => { onView(); onToggle(); }} className="flex items-center gap-2 w-full px-4 py-2 text-[12px] text-gray-700 hover:bg-gray-50 transition-colors">
              <Info className="w-3.5 h-3.5 text-gray-400" />
              הצג ליד
            </button>
            {isArchive ? (
              <>
                <button onClick={() => { onRestore(); onToggle(); }} className="flex items-center gap-2 w-full px-4 py-2 text-[12px] text-gray-700 hover:bg-gray-50 transition-colors">
                  <RotateCcw className="w-3.5 h-3.5 text-gray-400" />
                  שחזר לרשימת הלידים
                </button>
                <div className="border-t border-gray-100 my-0.5" />
                <button onClick={() => { onDelete(); onToggle(); }} className="flex items-center gap-2 w-full px-4 py-2 text-[12px] text-red-500 hover:bg-red-50 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                  מחק ליד
                </button>
              </>
            ) : (
              <>
                <button onClick={() => { onView(); onToggle(); }} className="flex items-center gap-2 w-full px-4 py-2 text-[12px] text-gray-700 hover:bg-gray-50 transition-colors">
                  <Pencil className="w-3.5 h-3.5 text-gray-400" />
                  עריכת ליד
                </button>
                <button
                  onClick={() => { navigator.clipboard?.writeText(window.location.origin + '/leads?id=' + lead.id); onToggle(); }}
                  className="flex items-center gap-2 w-full px-4 py-2 text-[12px] text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Share2 className="w-3.5 h-3.5 text-gray-400" />
                  שתף ליד
                </button>
                <div className="border-t border-gray-100 my-0.5" />
                <button onClick={() => { onArchive(); onToggle(); }} className="flex items-center gap-2 w-full px-4 py-2 text-[12px] text-red-500 hover:bg-red-50 transition-colors">
                  <Archive className="w-3.5 h-3.5" />
                  העבר לארכיון
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const COLUMNS = [
  { key: 'menu',    label: '', className: 'w-8' },
  { key: 'name',    label: 'שם' },
  { key: 'role',    label: 'תפקיד' },
  { key: 'company', label: 'חברה' },
  { key: 'city',    label: 'מיקום' },
  { key: 'source',  label: 'מקור' },
  { key: 'contact', label: 'יצירת קשר' },
];

const ARCHIVE_COLUMNS = [
  { key: 'menu',         label: '', className: 'w-8' },
  { key: 'name',         label: 'שם' },
  { key: 'role',         label: 'תפקיד' },
  { key: 'company',      label: 'חברה' },
  { key: 'archived_at',  label: 'תאריך ארכוב' },
  { key: 'archive_reason', label: 'סיבת ארכוב' },
  { key: 'source',       label: 'מקור' },
];

export default function Leads() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [showLeadSettings, setShowLeadSettings] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [filterTab, setFilterTab] = useState('all');
  const [search, setSearch] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState('all');
  const [viewMode, setViewMode] = useState('active'); // 'active' | 'archive'

  const { data: allLeadsRaw = [], isLoading } = useQuery({
    queryKey: ['leadsPage', bpId],
    queryFn: () => base44.entities.Lead.filter({ linked_business: bpId }, '-score', 200),
    enabled: !!bpId,
  });

  const leads = allLeadsRaw.filter(l => !l.is_archived);
  const archivedLeads = allLeadsRaw.filter(l => l.is_archived);
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const todayLeads  = leads.filter(l => (l.created_at || '').startsWith(today));
  const hotLeads    = leads.filter(l => l.status === 'hot');
  const weekLeads   = leads.filter(l => (l.updated_at || l.created_at || '') >= weekAgo && l.status !== 'cold');
  const urgentLeads = leads.filter(l => l.status === 'hot' && !l.last_contacted_at);
  const sources     = new Set(leads.map(l => l.source).filter(Boolean));

  const FILTER_TABS = FILTER_TAB_DEFS.map(t => ({
    ...t,
    count: t.key === 'all' ? leads.length : t.key === 'hot' ? hotLeads.length : t.key === 'today' ? todayLeads.length : weekLeads.length,
  }));

  // Insight cards for "כדאי לטפל היום"
  const insightCards = [
    urgentLeads.length > 0 && {
      title: `${urgentLeads.length} לידים חזרו להתעניין השבוע`,
      description: 'המערכת זיהתה פעילות חדשה מצד לידים בעלי פוטנציאל גבוה. ממולץ ליצור קשר בזמן שהעניין גבוה.',
      ctaLabel: 'צפה בלידים',
      onCta: () => setFilterTab('hot'),
      accent: 'violet',
    },
    urgentLeads.length > 0 && {
      title: `${Math.min(8, urgentLeads.length)} לידים הציגו פעילות חדשה`,
      description: 'זוהתה פעילות חדשה מצד לידים מאינסטגרם. נסחו פניות מותאמות אישית.',
      ctaLabel: 'צפה בלידים',
      onCta: () => setFilterTab('hot'),
      accent: 'red',
    },
  ].filter(Boolean);

  const statCards = [
    { count: todayLeads.length,  label: 'לידים מהיום',       borderColor: 'blue'   },
    { count: hotLeads.length,    label: 'לידים חמים',        borderColor: 'red'    },
    { count: urgentLeads.length, label: 'דורש פעולה מיידית', borderColor: 'yellow' },
    { count: sources.size,       label: 'מקורות פעילים',     borderColor: 'none'   },
  ];

  const sourceLabel = (src) => {
    const map = { google: 'Google', facebook: 'פייסבוק', instagram: 'אינסטגרם', whatsapp: 'WhatsApp', web: 'אתר', manual: 'ידני' };
    return map[src] || src || '—';
  };

  // Filter leads based on tab + search
  const filteredLeads = useMemo(() => {
    let filtered = leads;
    if (filterTab === 'hot')   filtered = filtered.filter(l => l.status === 'hot');
    if (filterTab === 'today') filtered = filtered.filter(l => (l.created_at || '').startsWith(today));
    if (filterTab === 'week')  filtered = filtered.filter(l => (l.updated_at || l.created_at || '') >= weekAgo && l.status !== 'cold');
    if (urgencyFilter === 'urgent') filtered = filtered.filter(l => l.status === 'hot' && !l.last_contacted_at);
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(l =>
        (l.name || '').toLowerCase().includes(q) ||
        (l.company || '').toLowerCase().includes(q) ||
        (l.city || '').toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [leads, filterTab, urgencyFilter, search, today, weekAgo]);

  const archiveStatCards = [
    { count: archivedLeads.length, label: 'סך הכול בארכיון', borderColor: 'blue' },
    {
      count: archivedLeads.length > 0
        ? Math.round(archivedLeads.reduce((sum, l) => {
            const d = l.archived_at ? (Date.now() - new Date(l.archived_at).getTime()) / 86400000 : 0;
            return sum + d;
          }, 0) / archivedLeads.length)
        : 0,
      label: 'ממוצע ימים בארכיון',
      borderColor: 'none',
    },
    {
      count: archivedLeads.filter(l => {
        const d = l.archived_at ? new Date(l.archived_at) : null;
        return d && d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear();
      }).length,
      label: 'שחזורו החודש',
      borderColor: 'yellow',
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header: count+title right, filter dropdown + add button */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 bg-foreground text-background px-4 py-2 rounded-full text-sm font-semibold hover:opacity-85 transition-opacity shadow-sm"
        >
          <Plus className="w-4 h-4" />
          ליד חדש
        </button>
        <div className="flex items-center gap-3">
          {/* Active / Archive toggle */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
            <button
              onClick={() => setViewMode('active')}
              className={`text-[12px] font-medium px-3 py-1.5 rounded-full transition-colors ${viewMode === 'active' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              לידים פעילים
            </button>
            <button
              onClick={() => setViewMode('archive')}
              className={`text-[12px] font-medium px-3 py-1.5 rounded-full transition-colors flex items-center gap-1 ${viewMode === 'archive' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Archive className="w-3 h-3" />
              ארכיון
            </button>
          </div>
          <div className="text-right">
            <div className="flex items-baseline gap-2 justify-end">
              <span className="text-3xl font-bold text-foreground">{viewMode === 'archive' ? archivedLeads.length : leads.length}</span>
              <span className="text-lg font-semibold text-foreground">לידים</span>
            </div>
          </div>
        </div>
      </div>

      {viewMode === 'archive' && (
        <p className="text-[13px] text-gray-500 text-right">
          לידים שהועברו לארכיון ואינם מופיעים ברשימת הלידים הפעילים. ניתן לשחזר אותם בכל עת.
        </p>
      )}

      <StatCards cards={viewMode === 'archive' ? archiveStatCards : statCards} />

      {/* No criteria banner */}
      {viewMode === 'active' && leads.length > 0 && urgentLeads.length === 0 && (
        <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <button
            onClick={() => setShowLeadSettings(true)}
            className="text-[12px] font-semibold text-[#e8344d] bg-white border border-[#e8344d]/30 px-3 py-1.5 rounded-full hover:bg-red-50 transition-colors"
          >
            הגדרות לידים
          </button>
          <div className="text-right">
            <p className="text-[13px] font-bold text-red-700">טרם הוגדרו קריטריונים ללידים</p>
            <p className="text-[11px] text-red-500">הסוכן יחפש בצורה כללית, ממולץ להגדיר את קהל היעד המדויק עבורכם</p>
          </div>
        </div>
      )}

      {/* "כדאי לטפל היום" insight cards */}
      {viewMode === 'active' && insightCards.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold text-gray-500 mb-3 text-right">כדאי לטפל היום באלו</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {insightCards.map((card, i) => (
              <InsightCard key={i} {...card} />
            ))}
          </div>
        </div>
      )}

      {/* Table header + filters */}
      <div>
        {viewMode === 'active' && (
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            {/* Filter pills */}
            <div className="flex items-center gap-2 flex-wrap">
              {FILTER_TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setFilterTab(tab.key)}
                  className="text-[12px] px-3 py-1.5 rounded-full border font-medium transition-colors"
                  style={
                    filterTab === tab.key
                      ? { background: '#111', color: '#fff', borderColor: '#111' }
                      : { background: '#fff', color: '#555', borderColor: '#e5e7eb' }
                  }
                >
                  {tab.label}
                  {tab.count > 0 && <span className="mr-1 text-[10px] opacity-70"> ({tab.count})</span>}
                </button>
              ))}
              <button
                onClick={() => setUrgencyFilter(v => v === 'urgent' ? 'all' : 'urgent')}
                className="flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-full border font-medium transition-colors"
                style={
                  urgencyFilter === 'urgent'
                    ? { background: '#fce4ec', color: '#e8344d', borderColor: '#e8344d' }
                    : { background: '#fff', color: '#555', borderColor: '#e5e7eb' }
                }
              >
                רמת דחיפות
                <ChevronDown className="w-3 h-3" />
              </button>
              {(search || urgencyFilter !== 'all' || filterTab !== 'all') && (
                <button
                  onClick={() => { setSearch(''); setUrgencyFilter('all'); setFilterTab('all'); }}
                  className="text-[11px] text-gray-400 hover:text-gray-600 flex items-center gap-1 px-2 py-1.5 rounded-full border border-gray-200 transition-colors"
                >
                  <X className="w-3 h-3" />
                  נקה פילטרים
                </button>
              )}
            </div>
            {/* Search */}
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-full px-3 py-1.5">
              <Search className="w-3.5 h-3.5 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="חיפוש ליד"
                className="text-[12px] bg-transparent outline-none text-gray-600 w-32 text-right"
              />
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
          </div>
        ) : viewMode === 'archive' ? (
          <DataTable
            columns={ARCHIVE_COLUMNS}
            rows={archivedLeads}
            emptyText="אין לידים בארכיון"
            renderCell={(lead, col) => {
              if (col.key === 'menu') return (
                <RowMenu
                  lead={lead}
                  isArchive
                  isOpen={menuOpenId === lead.id}
                  onToggle={() => setMenuOpenId(prev => prev === lead.id ? null : lead.id)}
                  onView={() => setSelectedLead(lead)}
                  onRestore={async () => {
                    await base44.entities.Lead.update(lead.id, { is_archived: false });
                    queryClient.invalidateQueries({ queryKey: ['leadsPage'] });
                    toast.success('הליד שוחזר לרשימה');
                  }}
                  onDelete={async () => {
                    if (!window.confirm('למחוק את הליד לצמיתות?')) return;
                    await base44.entities.Lead.delete(lead.id);
                    queryClient.invalidateQueries({ queryKey: ['leadsPage'] });
                    toast.success('הליד נמחק');
                  }}
                />
              );
              if (col.key === 'name') return (
                <button onClick={() => setSelectedLead(lead)} className="font-semibold text-foreground hover:text-[#e8344d] transition-colors text-right">
                  {lead.name || '—'}
                </button>
              );
              if (col.key === 'role')    return <span className="text-foreground-secondary text-xs">{lead.role || lead.job_title || '—'}</span>;
              if (col.key === 'company') return <span className="text-foreground-secondary text-xs font-semibold">{lead.company || '—'}</span>;
              if (col.key === 'archived_at') return (
                <span className="text-foreground-secondary text-xs">
                  {lead.archived_at ? new Date(lead.archived_at).toLocaleDateString('he-IL') : '—'}
                </span>
              );
              if (col.key === 'archive_reason') return (
                <span className="text-xs bg-gray-100 text-foreground-secondary px-2 py-0.5 rounded-full">
                  {lead.archive_reason || 'נפילה'}
                </span>
              );
              if (col.key === 'source') return (
                <span className="text-xs bg-gray-100 text-foreground-secondary px-2 py-0.5 rounded-full">
                  {sourceLabel(lead.source)}
                </span>
              );
              return lead[col.key] ?? '—';
            }}
          />
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={filteredLeads}
            emptyText="אין לידים — הסוכן ימצא לידים אוטומטית"
            renderCell={(lead, col) => {
              if (col.key === 'menu') return (
                <RowMenu
                  lead={lead}
                  isOpen={menuOpenId === lead.id}
                  onToggle={() => setMenuOpenId(prev => prev === lead.id ? null : lead.id)}
                  onView={() => setSelectedLead(lead)}
                  onArchive={async () => {
                    await base44.entities.Lead.update(lead.id, { is_archived: true, archived_at: new Date().toISOString() });
                    queryClient.invalidateQueries({ queryKey: ['leadsPage'] });
                  }}
                />
              );
              if (col.key === 'name') return (
                <button
                  onClick={() => setSelectedLead(lead)}
                  className="font-semibold text-foreground hover:text-[#e8344d] transition-colors text-right"
                >
                  {lead.name || '—'}
                </button>
              );
              if (col.key === 'role')    return <span className="text-foreground-secondary text-xs">{lead.role || lead.job_title || '—'}</span>;
              if (col.key === 'company') return <span className="text-foreground-secondary text-xs font-semibold">{lead.company || '—'}</span>;
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
      </div>

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

      {showLeadSettings && (
        <LeadSettingsPanel
          businessProfile={businessProfile}
          onClose={() => setShowLeadSettings(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['leadsPage', bpId] })}
        />
      )}
    </div>
  );
}
