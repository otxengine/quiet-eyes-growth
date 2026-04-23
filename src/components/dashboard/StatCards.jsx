import React from 'react';
import { Eye, Users, Star, CheckCircle } from 'lucide-react';

const cards = [
  { key: 'signals', label: 'תובנות חדשות', icon: Eye },
  { key: 'competitors', label: 'מתחרים במעקב', icon: Users },
  { key: 'reviews', label: 'ביקורות ממתינות', icon: Star },
  { key: 'leads', label: 'לידים חמים', icon: CheckCircle },
];

export default function StatCards({ stats, mentionCount = 0 }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((card, i) => {
        const Icon = card.icon;
        const value = stats[card.key] ?? 0;
        return (
          <div 
            key={card.key}
            className={`card-base px-5 py-4 fade-in-up stagger-${i + 1} group`}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-medium text-foreground-muted tracking-wide">{card.label}</p>
              <Icon className="w-3.5 h-3.5 text-foreground-muted opacity-30 group-hover:opacity-60 transition-opacity" />
            </div>
            <span className="text-[28px] font-bold text-foreground leading-none tracking-tight">{value}</span>
            {card.key === 'signals' && mentionCount > 0 && (
              <p className="text-[9px] text-foreground-muted mt-1">כולל {mentionCount} אזכורים</p>
            )}
          </div>
        );
      })}
    </div>
  );
}