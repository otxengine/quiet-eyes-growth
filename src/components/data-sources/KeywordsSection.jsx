import React, { useState } from 'react';
import { Hash, Plus, X } from 'lucide-react';

export default function KeywordsSection({ keywords, onSave }) {
  const [items, setItems] = useState(keywords);
  const [newItem, setNewItem] = useState('');
  const [dirty, setDirty] = useState(false);

  // Sync with updated prop after server save (only when no unsaved local edits)
  React.useEffect(() => {
    if (!dirty) setItems(keywords);
  }, [keywords]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = () => {
    const val = newItem.trim();
    if (!val || items.includes(val)) return;
    const updated = [...items, val];
    setItems(updated);
    setNewItem('');
    setDirty(true);
  };

  const handleRemove = (idx) => {
    const updated = items.filter((_, i) => i !== idx);
    setItems(updated);
    setDirty(true);
  };

  const handleSave = () => {
    onSave(items);
    setDirty(false);
  };

  return (
    <div className="card-base p-5 fade-in-up">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Hash className="w-4 h-4 text-primary" />
          <h3 className="text-[13px] font-semibold text-foreground">מילות מפתח</h3>
          <span className="text-[10px] text-foreground-muted">({items.length})</span>
        </div>
        {dirty && (
          <button onClick={handleSave} className="px-3 py-1.5 rounded-md text-[11px] font-medium bg-primary text-white hover:opacity-90 transition-all">
            שמור שינויים
          </button>
        )}
      </div>
      <p className="text-[11px] text-foreground-muted mb-3">הסוכנים ישתמשו במילות המפתח האלה כדי לחפש מידע רלוונטי לעסק שלך</p>

      <div className="flex flex-wrap gap-2 mb-3">
        {items.map((kw, idx) => (
          <span key={idx} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-secondary text-[11px] text-foreground-secondary border border-border group">
            {kw}
            <button onClick={() => handleRemove(idx)} className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-danger/10">
              <X className="w-3 h-3 text-foreground-muted hover:text-danger" />
            </button>
          </span>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="הוסף מילת מפתח..."
          className="flex-1 bg-secondary border border-border rounded-lg px-3 py-2 text-[12px] text-foreground placeholder-foreground-muted focus:outline-none focus:border-primary/30"
        />
        <button onClick={handleAdd} className="px-3 py-2 rounded-lg bg-secondary border border-border hover:bg-secondary/80 transition-colors">
          <Plus className="w-4 h-4 text-foreground-muted" />
        </button>
      </div>
    </div>
  );
}