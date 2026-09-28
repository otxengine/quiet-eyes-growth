import React from 'react';
import { Settings } from 'lucide-react';

export default function SyncEventsConfig({ bp, saveField }) {
  const syncEvents = (bp?.crm_sync_events || 'create,update').split(',').map(s => s.trim());

  const toggleEvent = (evt) => {
    let events = [...syncEvents];
    if (events.includes(evt)) {
      events = events.filter(e => e !== evt);
    } else {
      events.push(evt);
    }
    saveField({ crm_sync_events: events.filter(Boolean).join(',') });
  };

  const eventOptions = [
    { key: 'create', label: 'ליד חדש', emoji: '🆕' },
    { key: 'update', label: 'עדכון נתונים', emoji: '✏️' },
    { key: 'status_change', label: 'שינוי סטטוס', emoji: '🔄' },
  ];

  return (
    <div className="card-base p-5">
      <div className="flex items-center gap-2 mb-3">
        <Settings className="w-4 h-4 text-foreground-muted" />
        <h3 className="text-[13px] font-bold text-foreground">מתי לסנכרן?</h3>
      </div>
      <p className="text-[11px] text-foreground-muted mb-3">בחר אילו אירועים יגרמו לשליחת נתונים ל-CRM</p>
      <div className="flex flex-wrap gap-2">
        {eventOptions.map(evt => (
          <button
            key={evt.key}
            onClick={() => toggleEvent(evt.key)}
            className={`px-4 py-2.5 rounded-lg text-[12px] font-medium transition-all ${
              syncEvents.includes(evt.key)
                ? 'bg-foreground text-background shadow-sm'
                : 'text-foreground-muted border border-border hover:border-border-hover hover:text-foreground'
            }`}
          >
            {evt.emoji} {evt.label}
          </button>
        ))}
      </div>
    </div>
  );
}