import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function LocationComparison({ businessProfileId }) {
  const [expanded, setExpanded] = useState(false);

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', businessProfileId],
    queryFn: () => base44.entities.BusinessLocation.filter({ linked_business: businessProfileId }),
    enabled: !!businessProfileId,
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['locationLeads', businessProfileId],
    queryFn: () => base44.entities.Lead.filter({ linked_business: businessProfileId }),
    enabled: !!businessProfileId && locations.length > 0,
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['locationReviews', businessProfileId],
    queryFn: () => base44.entities.Review.filter({ linked_business: businessProfileId }),
    enabled: !!businessProfileId && locations.length > 0,
  });

  const { data: signals = [] } = useQuery({
    queryKey: ['locationSignals', businessProfileId],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: businessProfileId }),
    enabled: !!businessProfileId && locations.length > 0,
  });

  if (locations.length < 2) return null;

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const stats = locations.map(loc => {
    const locLeads = leads.filter(l => l.linked_location === loc.id);
    const locReviews = reviews.filter(r => r.linked_location === loc.id);
    const locSignals = signals.filter(s => s.linked_location === loc.id);
    const weekLeads = locLeads.filter(l => (l.created_at || l.created_date) >= weekAgo);
    const avgRating = locReviews.length > 0 ? locReviews.reduce((s, r) => s + (r.rating || 0), 0) / locReviews.length : 0;
    return { ...loc, leads: weekLeads.length, reviews: locReviews.length, signals: locSignals.length, avgRating };
  });

  return (
    <div className="card-base overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full px-5 py-3 flex items-center justify-between hover:bg-secondary/30 transition-colors">
        <span className="text-[12px] font-semibold text-foreground">השוואת סניפים</span>
        {expanded ? <ChevronUp className="w-4 h-4 text-foreground-muted" /> : <ChevronDown className="w-4 h-4 text-foreground-muted" />}
      </button>
      {expanded && (
        <div className="px-5 pb-4">
          <table className="w-full">
            <thead>
              <tr className="text-[10px] text-foreground-muted">
                <th className="text-right pb-2 font-medium">סניף</th>
                <th className="text-center pb-2 font-medium">דירוג</th>
                <th className="text-center pb-2 font-medium">לידים (שבוע)</th>
                <th className="text-center pb-2 font-medium">תובנות</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(loc => (
                <tr key={loc.id} className="border-t border-border">
                  <td className="py-2 text-[12px] font-medium text-foreground">{loc.name}</td>
                  <td className="py-2 text-[12px] text-center text-foreground-secondary">{loc.avgRating ? loc.avgRating.toFixed(1) : '—'}</td>
                  <td className="py-2 text-[12px] text-center text-foreground-secondary">{loc.leads}</td>
                  <td className="py-2 text-[12px] text-center text-foreground-secondary">{loc.signals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}