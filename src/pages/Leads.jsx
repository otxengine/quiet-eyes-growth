import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import AddLeadModal from '@/components/leads/AddLeadModal';
import LeadDetailPanel from '@/components/leads/LeadDetailPanel';
import PageHeader from '@/components/shared/PageHeader';
import StatCards from '@/components/shared/StatCards';
import UrgentActionsSection from '@/components/shared/UrgentActionsSection';
import DataTable from '@/components/shared/DataTable';

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
