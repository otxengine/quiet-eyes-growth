import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, Eye, CheckCircle } from 'lucide-react';

const actions = [
  { label: 'הגב לביקורת', icon: Star, path: '/reviews', cls: 'bg-primary/15 text-primary hover:bg-primary/25' },
  { label: 'צפה בתובנות', icon: Eye, path: '/signals', cls: 'bg-success/15 text-success hover:bg-success/25' },
  { label: 'צפה בלידים', icon: CheckCircle, path: '/leads', cls: 'bg-warning/15 text-warning hover:bg-warning/25' },
];

export default function QuickActions() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-wrap gap-3">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.label}
            onClick={() => navigate(action.path)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${action.cls}`}
          >
            <Icon className="w-4 h-4" />
            {action.label}
          </button>
        );
      })}
    </div>
  );
}