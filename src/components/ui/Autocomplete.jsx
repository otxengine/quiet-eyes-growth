import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

export default function Autocomplete({ value, onChange, placeholder, suggestions = [] }) {
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef(null);

  const filtered = value ? suggestions.filter(s => s.includes(value) && s !== value) : [];
  const showDropdown = open && filtered.length > 0;

  useEffect(() => {
    const handleClickOutside = (e) => { if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => { setHighlightIndex(-1); }, [value]);

  const handleKeyDown = (e) => {
    if (!showDropdown) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIndex(prev => Math.min(prev + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIndex(prev => Math.max(prev - 1, 0)); }
    else if (e.key === 'Enter' && highlightIndex >= 0) { e.preventDefault(); onChange(filtered[highlightIndex]); setOpen(false); }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2.5 text-[13px] text-[#111111] placeholder-[#cccccc] focus:outline-none focus:border-[#dddddd]"
      />
      {showDropdown && (
        <div className="absolute z-50 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-[10px] border border-[#f0f0f0] bg-white">
          {filtered.map((item, i) => (
            <button key={item} type="button"
              className={cn("w-full text-right px-3 py-2 text-sm transition-colors", i === highlightIndex ? "bg-[#f5f5f5] text-[#111111]" : "text-[#444444] hover:bg-[#fafafa]")}
              onMouseDown={() => { onChange(item); setOpen(false); }}>{item}</button>
          ))}
        </div>
      )}
    </div>
  );
}