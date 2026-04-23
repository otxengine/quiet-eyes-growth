import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import PipelineColumn from './PipelineColumn';
import LeadDetailPanel from './LeadDetailPanel';
import LostReasonPicker from './LostReasonPicker';

const stages = [
  { key: 'new', label: 'חדש', color: 'bg-gray-100 text-gray-600' },
  { key: 'contacted', label: 'נוצר קשר', color: 'bg-blue-50 text-blue-600' },
  { key: 'meeting', label: 'פגישה', color: 'bg-amber-50 text-amber-600' },
  { key: 'negotiation', label: 'משא ומתן', color: 'bg-purple-50 text-purple-600' },
  { key: 'closed_won', label: 'נסגר ✓', color: 'bg-green-50 text-green-600' },
  { key: 'closed_lost', label: 'אבד', color: 'bg-red-50 text-red-400', dimmed: true },
];

export default function PipelineView({ leads, businessProfile }) {
  const queryClient = useQueryClient();
  const [selectedLead, setSelectedLead] = useState(null);
  const [lostLead, setLostLead] = useState(null);
  const [wonLead, setWonLead] = useState(null);
  const [dealValue, setDealValue] = useState('');
  const [draggedLead, setDraggedLead] = useState(null);

  const groupedLeads = {};
  stages.forEach(s => { groupedLeads[s.key] = []; });
  leads.forEach(lead => {
    const stage = lead.lifecycle_stage || 'new';
    if (groupedLeads[stage]) groupedLeads[stage].push(lead);
    else groupedLeads['new'].push(lead);
  });

  const handleDrop = async (leadId, newStage) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead || lead.lifecycle_stage === newStage) return;

    if (newStage === 'closed_lost') {
      setLostLead({ ...lead, targetStage: newStage });
      return;
    }
    if (newStage === 'closed_won') {
      setWonLead(lead);
      setDealValue('');
      return;
    }

    await moveToStage(lead, newStage);
  };

  const moveToStage = async (lead, newStage, reason) => {
    const updates = {
      lifecycle_stage: newStage,
      lifecycle_updated_at: new Date().toISOString(),
    };
    if (reason) updates.notes = (lead.notes ? lead.notes + '\n' : '') + `סיבת אובדן: ${reason}`;
    
    // Map lifecycle to status
    if (newStage === 'closed_won') updates.status = 'completed';
    else if (newStage === 'closed_lost') updates.status = 'lost';
    else if (newStage === 'contacted') updates.status = 'contacted';
    else if (newStage === 'new') updates.status = lead.score >= 70 ? 'hot' : 'warm';

    await base44.entities.Lead.update(lead.id, updates);

    // Log outcome
    try {
      await base44.functions.invoke('logOutcome', {
        action_type: 'lifecycle_change',
        was_accepted: true,
        outcome_description: `ליד "${lead.name}" הועבר ל${stages.find(s => s.key === newStage)?.label || newStage}`,
        linked_business: lead.linked_business || '',
      });
    } catch (_) {}

    queryClient.invalidateQueries({ queryKey: ['leadsPage'] });
    toast.success(`${lead.name} הועבר ל${stages.find(s => s.key === newStage)?.label}`);
  };

  return (
    <div className="relative">
      <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 400 }}>
        {stages.map(stage => (
          <PipelineColumn
            key={stage.key}
            stage={stage}
            leads={groupedLeads[stage.key]}
            onDrop={handleDrop}
            onLeadClick={setSelectedLead}
            draggedLead={draggedLead}
            setDraggedLead={setDraggedLead}
          />
        ))}
      </div>

      {selectedLead && (
        <LeadDetailPanel
          lead={selectedLead}
          businessProfile={businessProfile}
          stages={stages}
          onClose={() => setSelectedLead(null)}
          onStageChange={(newStage) => { moveToStage(selectedLead, newStage); setSelectedLead(null); }}
        />
      )}

      {lostLead && (
        <LostReasonPicker
          lead={lostLead}
          onSelect={(reason) => { moveToStage(lostLead, 'closed_lost', reason); setLostLead(null); }}
          onClose={() => setLostLead(null)}
        />
      )}

      {wonLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setWonLead(null)}>
          <div className="bg-white rounded-xl border border-border shadow-xl p-5 w-[320px]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-semibold text-foreground">🎉 סגירת עסקה</h3>
              <button onClick={() => setWonLead(null)}><X className="w-4 h-4 text-foreground-muted" /></button>
            </div>
            <p className="text-[12px] text-foreground-muted mb-3">סכום העסקה עם "{wonLead.name}"?</p>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[14px] font-semibold text-foreground">₪</span>
              <input
                type="number"
                value={dealValue}
                onChange={e => setDealValue(e.target.value)}
                placeholder="0"
                className="flex-1 px-3 py-2.5 rounded-lg border border-border text-[14px] font-medium text-foreground focus:outline-none focus:border-primary"
                autoFocus
              />
            </div>
            <button
              onClick={async () => {
                const val = parseInt(dealValue) || 0;
                if (val > 0) {
                  await base44.entities.Lead.update(wonLead.id, { total_value: val });
                }
                await moveToStage(wonLead, 'closed_won');
                setWonLead(null);
              }}
              className="w-full py-2.5 rounded-lg bg-foreground text-background text-[12px] font-semibold hover:opacity-90 transition-all"
            >
              סגור עסקה ✓
            </button>
          </div>
        </div>
      )}
    </div>
  );
}