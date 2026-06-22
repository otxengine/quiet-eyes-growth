import React from 'react';

/**
 * StatCards — 4-card row with colored right borders
 * Props:
 *   cards: Array of { count, label, borderColor?, change?, changeColor? }
 *   borderColor options: 'blue' | 'red' | 'yellow' | 'green' | 'none'
 *   change: optional text shown below the number (e.g. "+12% מהחודש שעבר")
 *   changeColor: optional Tailwind text color class (e.g. 'text-green-600', 'text-red-500')
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
            {card.change && (
              <span className={`text-[10px] font-semibold mt-0.5 ${card.changeColor || 'text-foreground-muted'}`}>{card.change}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
