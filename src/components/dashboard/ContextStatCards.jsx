import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Users, Star, CheckCircle, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

const cardConfig = [
  { key: 'signals', label: 'תובנות', icon: Eye, path: '/signals', accent: 'primary' },
  { key: 'competitors', label: 'מתחרים', icon: Users, path: '/competitors', accent: 'warning' },
  { key: 'reviews', label: 'ביקורות', icon: Star, path: '/reviews', accent: 'danger' },
  { key: 'leads', label: 'לידים', icon: CheckCircle, path: '/leads', accent: 'success' },
  { key: 'revenue', label: 'הכנסות החודש', icon: TrendingUp, path: '/leads', accent: 'success' },
];

const accentColors = {
  primary: { bar: 'hsl(var(--primary))', icon: 'text-primary', number: 'text-primary' },
  success: { bar: 'hsl(var(--success))', icon: 'text-emerald-500', number: 'text-emerald-600' },
  warning: { bar: 'hsl(var(--warning))', icon: 'text-amber-500', number: 'text-foreground' },
  danger:  { bar: 'hsl(var(--danger))', icon: 'text-red-500', number: 'text-foreground' },
};

export default function ContextStatCards({ stats }) {
  const navigate = useNavigate();

  const getContext = (key) => {
    switch (key) {
      case 'signals': {
        const urgent = stats.highImpactSignals || 0;
        if (urgent > 0) return { text: `${urgent} דורשות תגובה`, color: 'text-red-500' };
        return { text: 'הכל נקרא ✓', color: 'text-emerald-600' };
      }
      case 'competitors': {
        const changes = stats.competitorChanges || 0;
        if (changes > 0) return { text: `${changes} שינו מחירים`, color: 'text-amber-600' };
        return { text: 'אין שינויים', color: 'text-foreground-muted' };
      }
      case 'reviews': {
        const neg = stats.negativeReviews || 0;
        const pending = stats.pendingReviews || 0;
        if (neg > 0) return { text: `${neg} שליליות ממתינות`, color: 'text-red-500' };
        if (pending > 0) return { text: `${pending} ממתינות לתגובה`, color: 'text-amber-600' };
        return { text: 'הכל טופל ✓', color: 'text-emerald-600' };
      }
      case 'leads': {
        const hot = stats.hotLeads || 0;
        const today = stats.newLeadsToday || 0;
        if (hot > 0 && today > 0) return { text: `${hot} חמים — ${today} חדשים היום`, color: 'text-emerald-600' };
        if (hot > 0) return { text: `${hot} חמים`, color: 'text-emerald-600' };
        return { text: 'אין לידים חמים', color: 'text-foreground-muted' };
      }
      case 'revenue': {
        const closed = stats.closedThisMonth || 0;
        if (closed > 0) return { text: `${closed} עסקאות סגורות`, color: 'text-emerald-600' };
        return { text: 'אין עסקאות החודש', color: 'text-foreground-muted' };
      }
      default: return { text: '', color: 'text-foreground-muted' };
    }
  };

  const getNumber = (key) => {
    switch (key) {
      case 'signals': return stats.unreadSignals || 0;
      case 'competitors': return stats.totalCompetitors || 0;
      case 'reviews': return stats.totalReviews || 0;
      case 'leads': return stats.totalLeads || 0;
      case 'revenue': return null;
      default: return 0;
    }
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
      {cardConfig.map((card, i) => {
        const Icon = card.icon;
        const ctx = getContext(card.key);
        const num = getNumber(card.key);
        const isRevenue = card.key === 'revenue';
        const revenueVal = stats.monthRevenue || 0;
        const colors = accentColors[card.accent] || accentColors.primary;

        return (
          <div
            key={card.key}
            onClick={() => navigate(card.path)}
            className={cn(
              'card-base px-4 py-4 cursor-pointer relative overflow-hidden group transition-all duration-200 hover:scale-[1.01] hover:shadow-md',
              `fade-in-up stagger-${i + 1}`
            )}
          >
            {/* Top accent border */}
            <div
              className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl transition-opacity duration-200 group-hover:opacity-100 opacity-80"
              style={{ background: colors.bar }}
            />

            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-medium text-foreground-muted">{card.label}</p>
              <Icon className={cn('w-3.5 h-3.5 opacity-40 group-hover:opacity-70 transition-opacity', colors.icon)} />
            </div>

            {isRevenue ? (
              <span className={cn('text-[20px] font-bold leading-none tracking-tight block', colors.number)}>
                {revenueVal > 0 ? `₪${revenueVal.toLocaleString()}` : '—'}
              </span>
            ) : (
              <span className="text-[28px] font-bold text-foreground leading-none tracking-tight block">{num}</span>
            )}

            <p className={cn('text-[10px] font-medium mt-1.5', ctx.color)}>{ctx.text}</p>
          </div>
        );
      })}
    </div>
  );
}
