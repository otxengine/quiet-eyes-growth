import React from 'react';
import { useNavigate } from 'react-router-dom';

const ITEMS = [
  { key: 'signals',   label: 'סיגנלים',  icon: '📊', route: '/signals',     color: 'text-primary' },
  { key: 'reviews',   label: 'ביקורות',  icon: '⭐', route: '/reviews',     color: 'text-amber-600'  },
  { key: 'leads',     label: 'לידים',    icon: '🔥', route: '/leads',       color: 'text-orange-600' },
  { key: 'revenue',   label: 'הכנסה',    icon: '₪',  route: '/leads',       color: 'text-green-600'  },
];

function fmt(key, value) {
  if (key === 'revenue') return value > 0 ? `₪${value.toLocaleString('he-IL')}` : '—';
  return value > 0 ? String(value) : '0';
}

export default function KpiStrip({ stats }) {
  const navigate = useNavigate();
  const values = {
    signals: stats?.unreadSignals ?? 0,
    reviews: stats?.pendingReviews ?? 0,
    leads:   stats?.hotLeads ?? 0,
    revenue: stats?.monthRevenue ?? 0,
  };

  return (
    <div className="grid grid-cols-4 gap-2 mb-4">
      {ITEMS.map(item => (
        <button
          key={item.key}
          onClick={() => navigate(item.route)}
          className="card-base flex flex-col items-center justify-center py-3 px-2 hover:bg-secondary/40 transition-colors cursor-pointer group"
        >
          <span className={`text-[20px] font-bold leading-none ${item.color} group-hover:scale-110 transition-transform`}>
            {fmt(item.key, values[item.key])}
          </span>
          <span className="text-[10px] text-foreground-muted mt-1 flex items-center gap-1">
            <span>{item.icon}</span>
            {item.label}
          </span>
        </button>
      ))}
    </div>
  );
}
