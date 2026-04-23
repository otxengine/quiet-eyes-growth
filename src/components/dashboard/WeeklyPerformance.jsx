import React, { useMemo } from 'react';

const dayLabels = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

function getLast7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({
      date: d.toISOString().split('T')[0],
      dayIndex: d.getDay(),
      label: dayLabels[d.getDay()]
    });
  }
  return days;
}

export default function WeeklyPerformance({ signals = [], leads = [], reviews = [] }) {
  const days = useMemo(() => getLast7Days(), []);

  const counts = useMemo(() => {
    return days.map(day => {
      const signalCount = signals.filter(s => (s.detected_at || s.created_date || '').startsWith(day.date)).length;
      const leadCount = leads.filter(l => (l.created_at || l.created_date || '').startsWith(day.date)).length;
      return { ...day, signalCount, leadCount };
    });
  }, [days, signals, leads]);

  const maxCount = Math.max(1, ...counts.flatMap(c => [c.signalCount, c.leadCount]));
  const barHeight = (count) => Math.max(2, (count / maxCount) * 44);

  return (
    <div className="card-base h-full flex flex-col fade-in-up">
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-foreground">ביצועים שבועיים</h3>
        <div className="flex gap-3 text-[9px]">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-[2px] bg-foreground-muted/20 inline-block rounded-full" />
            <span className="text-foreground-muted">תובנות</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-[2px] bg-success/40 inline-block rounded-full" />
            <span className="text-foreground-muted">לידים</span>
          </div>
        </div>
      </div>
      <div className="p-5 flex-1">
        <div className="flex items-end justify-between gap-3 h-[72px]">
          {counts.map((day, i) => (
            <div key={i} className="flex flex-col items-center gap-1 flex-1">
              <div className="flex items-end gap-[3px]">
                <div className="w-1.5 rounded-t-sm transition-all duration-300" style={{ height: barHeight(day.signalCount), background: 'hsl(var(--foreground) / 0.06)' }} />
                <div className="w-1.5 rounded-t-sm transition-all duration-300" style={{ height: barHeight(day.leadCount), background: 'hsl(var(--success) / 0.25)' }} />
              </div>
              <span className="text-[9px] text-foreground-muted opacity-60">{day.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}