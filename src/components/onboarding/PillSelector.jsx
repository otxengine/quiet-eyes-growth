import React, { useState } from 'react';
import { Search } from 'lucide-react';

export default function PillSelector({
  options,              // [{ value, label, sub? }]
  selected,             // string (single) | string[] (multi)
  onSelect,             // (value) => void — called on each click
  multi = false,
  showSearch = false,
  searchPlaceholder = 'חיפוש...',
  className = '',
}) {
  const [query, setQuery] = useState('');

  const isSelected = (val) =>
    multi ? (Array.isArray(selected) && selected.includes(val)) : selected === val;

  const visible = query
    ? options.filter(o => o.label.includes(query))
    : options;

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap gap-2">
        {visible.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            className={`px-4 py-2 rounded-full text-[13px] border transition-all duration-150 ${
              isSelected(opt.value)
                ? 'border-[#e8344d] bg-[#fce4ec] text-[#e8344d] font-medium'
                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {showSearch && (
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-white border border-gray-200 rounded-full pr-10 pl-4 py-2 text-[13px] outline-none focus:border-[#e8344d] transition-colors"
          />
        </div>
      )}
    </div>
  );
}
