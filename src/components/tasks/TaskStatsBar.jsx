import React from 'react';

export default function TaskStatsBar({ tasks }) {
  const pending = tasks.filter(t => t.status === 'pending').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;
  const done = tasks.filter(t => t.status === 'done').length;
  const overdue = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done' && t.status !== 'cancelled').length;

  const cards = [
    { label: 'ממתינות', value: pending },
    { label: 'בביצוע', value: inProgress },
    { label: 'הושלמו', value: done },
    { label: 'באיחור', value: overdue, danger: overdue > 0 },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((card, i) => (
        <div key={card.label} className={`card-base p-5 fade-in-up stagger-${i + 1}`}>
          <p className="text-[11px] font-medium text-foreground-muted mb-1">{card.label}</p>
          <span className={`text-[28px] font-bold leading-none tracking-tight ${card.danger ? 'text-danger' : 'text-foreground'}`}>
            {card.value}
          </span>
        </div>
      ))}
    </div>
  );
}