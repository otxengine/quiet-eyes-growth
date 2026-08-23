const REPLY_STATUS_OPTIONS = [
  { value: 'pending', label: 'ממתין למענה' },
  { value: 'suggested', label: 'טיוטת AI' },
  { value: 'auto_responded', label: 'נענה אוטומטית' },
  { value: 'responded', label: 'נענה' },
  { value: 'published', label: 'פורסם' },
];

export default function ReviewsFilterBar({ topicSet = [], labelById = {}, filters, onChange }) {
  const toggleTopic = (id) => {
    onChange({
      ...filters,
      topics: filters.topics.includes(id) ? filters.topics.filter(t => t !== id) : [...filters.topics, id],
    });
  };

  const toggleReplyStatus = (value) => {
    onChange({
      ...filters,
      replyStatuses: filters.replyStatuses.includes(value)
        ? filters.replyStatuses.filter(s => s !== value)
        : [...filters.replyStatuses, value],
    });
  };

  return (
    <div dir="rtl" className="space-y-4">
      {topicSet.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-foreground-muted mb-1.5">נושא</p>
          <div className="flex flex-wrap gap-1">
            {topicSet.map(t => (
              <button key={t.id} type="button" onClick={() => toggleTopic(t.id)}
                className={`text-[10px] px-2 py-1 rounded-full font-medium border transition-colors ${
                  filters.topics.includes(t.id)
                    ? 'bg-foreground text-background border-foreground'
                    : 'bg-white text-foreground-muted border-border hover:bg-secondary'
                }`}>
                {labelById[t.id] || t.label_he}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-[11px] font-semibold text-foreground-muted mb-1.5">טווח תאריכים</p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-foreground-muted">מ:</span>
          <input type="date" value={filters.dateFrom} onChange={e => onChange({ ...filters, dateFrom: e.target.value })}
            className="border border-border rounded-lg px-2 py-1 text-[11px] flex-1 focus:outline-none focus:border-foreground/40" />
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[11px] text-foreground-muted">עד:</span>
          <input type="date" value={filters.dateTo} onChange={e => onChange({ ...filters, dateTo: e.target.value })}
            className="border border-border rounded-lg px-2 py-1 text-[11px] flex-1 focus:outline-none focus:border-foreground/40" />
        </div>
      </div>

      <div>
        <p className="text-[11px] font-semibold text-foreground-muted mb-1.5">טווח דירוג</p>
        <div className="flex items-center gap-2">
          <select value={filters.ratingMin} onChange={e => onChange({ ...filters, ratingMin: Number(e.target.value) })}
            className="border border-border rounded-lg px-2 py-1 text-[11px] flex-1">
            {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} כוכבים</option>)}
          </select>
          <span className="text-[11px] text-foreground-muted">עד</span>
          <select value={filters.ratingMax} onChange={e => onChange({ ...filters, ratingMax: Number(e.target.value) })}
            className="border border-border rounded-lg px-2 py-1 text-[11px] flex-1">
            {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} כוכבים</option>)}
          </select>
        </div>
      </div>

      <div>
        <p className="text-[11px] font-semibold text-foreground-muted mb-1.5">סטטוס מענה</p>
        <div className="space-y-1">
          {REPLY_STATUS_OPTIONS.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 text-[11px] text-foreground cursor-pointer">
              <input type="checkbox" checked={filters.replyStatuses.includes(opt.value)} onChange={() => toggleReplyStatus(opt.value)} />
              {opt.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
