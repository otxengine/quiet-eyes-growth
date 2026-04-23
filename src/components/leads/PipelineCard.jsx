import React from 'react';

function scoreColor(score) {
  if (score >= 80) return 'bg-green-500';
  if (score >= 40) return 'bg-amber-500';
  return 'bg-gray-400';
}

function daysInStage(updatedAt) {
  if (!updatedAt) return null;
  const diff = Date.now() - new Date(updatedAt).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  return days;
}

export default function PipelineCard({ lead, onClick, onDragStart }) {
  const initials = lead.name ? lead.name.split(' ').map(w => w[0]).join('').substring(0, 2) : '?';
  const days = daysInStage(lead.lifecycle_updated_at || lead.created_date);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="bg-white rounded-lg border border-border p-2.5 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow group"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-6 h-6 rounded-md bg-secondary flex items-center justify-center text-[9px] font-bold text-foreground-muted flex-shrink-0">
          {initials}
        </div>
        <span className="text-[12px] font-medium text-foreground truncate flex-1">{lead.name}</span>
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${scoreColor(lead.score)}`} title={`ציון: ${lead.score}`} />
      </div>
      {lead.service_needed && (
        <p className="text-[10px] text-foreground-muted truncate mb-1">{lead.service_needed}</p>
      )}
      <div className="flex items-center justify-between">
        {lead.total_value ? (
          <span className="text-[10px] font-medium text-foreground-secondary">₪{lead.total_value.toLocaleString()}</span>
        ) : <span />}
        {days !== null && (
          <span className="text-[9px] text-foreground-muted">{days === 0 ? 'היום' : `${days} ימים`}</span>
        )}
      </div>
    </div>
  );
}