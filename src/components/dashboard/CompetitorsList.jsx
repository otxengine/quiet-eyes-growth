import React from 'react';
import { Users, TrendingUp, TrendingDown, Minus } from 'lucide-react';

function Sparkline({ trend }) {
  const heights = trend === 'up' 
    ? [3, 4, 5, 6, 8, 10, 12]
    : trend === 'down'
    ? [12, 10, 8, 6, 5, 4, 3]
    : [6, 7, 6, 7, 6, 7, 6];

  const color = trend === 'up' ? 'bg-success' : trend === 'down' ? 'bg-danger' : 'bg-foreground-muted';

  return (
    <div className="flex items-end gap-[2px]">
      {heights.map((h, i) => (
        <div key={i} className={`w-[3px] rounded-t ${color}`} style={{ height: h }} />
      ))}
    </div>
  );
}

function ratingColor(rating) {
  if (rating >= 4.3) return 'text-success';
  if (rating >= 4) return 'text-warning';
  return 'text-danger';
}

export default function CompetitorsList({ competitors = [], business }) {
  const TrendIcon = ({ direction }) => {
    if (direction === 'up') return <TrendingUp className="w-3.5 h-3.5 text-success" />;
    if (direction === 'down') return <TrendingDown className="w-3.5 h-3.5 text-danger" />;
    return <Minus className="w-3.5 h-3.5 text-foreground-muted" />;
  };

  // Calculate business avg rating from reviews (placeholder)
  const businessRating = 4.2;

  return (
    <div className="bg-background-card rounded-lg border border-border">
      <div className="p-4 border-b border-border flex items-center gap-2">
        <Users className="w-4 h-4 text-info" />
        <h3 className="font-semibold text-foreground">מתחרים מובילים</h3>
      </div>
      <div className="divide-y divide-border">
        {/* Your business */}
        {business && (
          <div className="p-3 flex items-center gap-3 border-r-4 border-primary">
            <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center text-primary text-sm font-bold flex-shrink-0">
              {business.name?.substring(0, 2)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground truncate">{business.name}</span>
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-primary/15 text-primary rounded">אתה</span>
              </div>
              <span className="text-xs text-foreground-muted">{business.category}</span>
            </div>
            <span className={`text-lg font-bold ${ratingColor(businessRating)}`}>{businessRating}</span>
          </div>
        )}

        {/* Competitors */}
        {competitors.slice(0, 4).map((comp) => {
          const initials = comp.name?.substring(0, 2) || '??';
          const colors = ['bg-info/15 text-info', 'bg-warning/15 text-warning', 'bg-success/15 text-success', 'bg-danger/15 text-danger'];
          const colorIdx = comp.name?.charCodeAt(0) % 4 || 0;
          
          return (
            <div key={comp.id} className="p-3 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 ${colors[colorIdx]}`}>
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[13px] font-medium text-foreground block truncate">{comp.name}</span>
                <span className="text-xs text-foreground-muted">{comp.category || comp.review_count ? `${comp.review_count || 0} ביקורות` : ''}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Sparkline trend={comp.trend_direction} />
                <TrendIcon direction={comp.trend_direction} />
                <span className={`text-lg font-bold ${ratingColor(comp.rating)}`}>
                  {comp.rating?.toFixed(1)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}