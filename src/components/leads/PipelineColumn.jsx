import React, { useState } from 'react';
import PipelineCard from './PipelineCard';

export default function PipelineColumn({ stage, leads, onDrop, onLeadClick, draggedLead, setDraggedLead }) {
  const [dragOver, setDragOver] = useState(false);

  const totalValue = leads.reduce((sum, l) => sum + (l.total_value || 0), 0);

  return (
    <div
      className={`flex-shrink-0 w-[220px] rounded-xl border transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-border bg-background-surface'} ${stage.dimmed ? 'opacity-60' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); if (draggedLead) onDrop(draggedLead, stage.key); setDraggedLead(null); }}
    >
      <div className={`px-3 py-2.5 rounded-t-xl ${stage.color} border-b border-border`}>
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold">{stage.label}</span>
          <span className="text-[10px] font-medium opacity-70">{leads.length}</span>
        </div>
        {totalValue > 0 && <span className="text-[9px] opacity-60">₪{totalValue.toLocaleString()}</span>}
      </div>
      <div className="p-2 space-y-2 min-h-[200px] max-h-[500px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        {leads.map(lead => (
          <PipelineCard
            key={lead.id}
            lead={lead}
            onClick={() => onLeadClick(lead)}
            onDragStart={() => setDraggedLead(lead.id)}
          />
        ))}
      </div>
    </div>
  );
}