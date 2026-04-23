import React, { useState } from 'react';
import { Globe, Plus, X, ExternalLink } from 'lucide-react';

export default function UrlsSection({ urls, onSave }) {
  const [items, setItems] = useState(urls);
  const [newItem, setNewItem] = useState('');
  const [dirty, setDirty] = useState(false);

  // Sync with updated prop after server save (only when no unsaved local edits)
  React.useEffect(() => {
    if (!dirty) setItems(urls);
  }, [urls]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const getDomain = (url) => {
    try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
  };

  return (
    <div className="card-base p-5 fade-in-up stagger-2">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" />
          <h3 className="text-[13px] font-semibold text-foreground">מקורות מידע (URLs)</h3>
          <span className="text-[10px] text-foreground-muted">({items.length})</span>
        </div>
        {dirty && (
          <button onClick={handleSave} className="px-3 py-1.5 rounded-md text-[11px] font-medium bg-primary text-white hover:opacity-90 transition-all">
            שמור שינויים
          </button>
        )}
      </div>
      <p className="text-[11px] text-foreground-muted mb-3">אתרים, פורומים ודפי חדשות שהסוכנים יסרקו באופן קבוע</p>

      <div className="space-y-2 mb-3">
        {items.map((url, idx) => (
          <div key={idx} className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-secondary border border-border group">
            <Globe className="w-3.5 h-3.5 text-foreground-muted flex-shrink-0" />
            <span className="text-[11px] text-foreground-secondary flex-1 truncate" dir="ltr">{getDomain(url)}</span>
            <a href={url} target="_blank" rel="noopener noreferrer" className="opacity-0 group-hover:opacity-100 transition-opacity">
              <ExternalLink className="w-3 h-3 text-foreground-muted hover:text-primary" />
            </a>
            <button onClick={() => handleRemove(idx)} className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-danger/10">
              <X className="w-3 h-3 text-foreground-muted hover:text-danger" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="https://example.com/forum"
          className="flex-1 bg-secondary border border-border rounded-lg px-3 py-2 text-[12px] text-foreground placeholder-foreground-muted focus:outline-none focus:border-primary/30"
          dir="ltr"
        />
        <button onClick={handleAdd} className="px-3 py-2 rounded-lg bg-secondary border border-border hover:bg-secondary/80 transition-colors">
          <Plus className="w-4 h-4 text-foreground-muted" />
        </button>
      </div>
    </div>
  );
}