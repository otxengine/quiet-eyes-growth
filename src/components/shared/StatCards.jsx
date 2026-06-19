import React from 'react';

/**
 * StatCards — 4-card row with colored left borders
 * Props:
 *   cards: Array of { count, label, borderColor? }
 *   borderColor options: 'blue' | 'red' | 'yellow' | 'green' | 'none'
 */
const BORDER_COLORS = {
  blue:   'border-r-blue-500',
  red:    'border-r-[#e8344d]',
  yellow: 'border-r-yellow-400',
  green:  'border-r-green-500',
  none:   'border-r-gray-200',
};

export default function StatCards({ cards = [] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {cards.map((card, i) => {
        const borderClass = BORDER_COLORS[card.borderColor] || BORDER_COLORS.none;
        return (
          <div
            key={i}
            className={`bg-white rounded-xl p-4 border-r-4 ${borderClass} shadow-sm flex flex-col gap-1`}
          >
            <span className="text-2xl font-bold text-foreground">{card.count ?? '—'}</span>
            <span className="text-xs text-foreground-secondary font-medium leading-tight">{card.label}</span>
          </div>
        );
      })}
    </div>
  );
}
