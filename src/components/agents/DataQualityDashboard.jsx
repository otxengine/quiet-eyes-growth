import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Database, AlertTriangle, CheckCircle, Clock, TrendingUp } from 'lucide-react';

function qualityScore(entities) {
  if (!entities || entities.length === 0) return { score: 0, label: 'אין נתונים', color: '#999999' };
  
  let filled = 0;
  let total = 0;
  
  for (const entity of entities) {
    const keys = Object.keys(entity).filter(k => !['id', 'created_date', 'updated_date', 'created_by'].includes(k));
    total += keys.length;
    filled += keys.filter(k => entity[k] !== null && entity[k] !== undefined && entity[k] !== '').length;
  }
  
  const ratio = total > 0 ? Math.round((filled / total) * 100) : 0;
  
  if (ratio >= 80) return { score: ratio, label: 'מצוין', color: '#10b981' };
  if (ratio >= 60) return { score: ratio, label: 'טוב', color: '#d97706' };
  return { score: ratio, label: 'דורש שיפור', color: '#dc2626' };
}

function freshnessCheck(entities, dateField = 'created_date') {
  if (!entities || entities.length === 0) return { stale: 0, fresh: 0, total: 0 };
  
  const weekAgo = Date.now() - 7 * 24 * 3600000;
  let stale = 0;
  let fresh = 0;
  
  for (const e of entities) {
    const date = new Date(e[dateField] || e.created_date).getTime();
    if (date < weekAgo) stale++;
    else fresh++;
  }
  
  return { stale, fresh, total: entities.length };
}

export default function DataQualityDashboard({ bpId }) {
  const { data: quality, isLoading } = useQuery({
    queryKey: ['dataQuality', bpId],
    queryFn: async () => {
      const [profiles, competitors, leads, reviews, signals] = await Promise.all([
        base44.entities.BusinessProfile.filter({ id: bpId }),
        base44.entities.Competitor.filter({ linked_business: bpId }),
        base44.entities.Lead.filter({ linked_business: bpId }, '-created_date', 50),
        base44.entities.Review.filter({ linked_business: bpId }, '-created_date', 50),
        base44.entities.MarketSignal.filter({ linked_business: bpId }, '-detected_at', 50),
      ]);
      
      return {
        profile: qualityScore(profiles),
        competitors: qualityScore(competitors),
        leads: qualityScore(leads),
        reviews: qualityScore(reviews),
        signals: qualityScore(signals),
        leadsFreshness: freshnessCheck(leads, 'created_at'),
        signalsFreshness: freshnessCheck(signals, 'detected_at'),
        competitorsFreshness: freshnessCheck(competitors, 'last_scanned'),
      };
    },
    enabled: !!bpId,
  });

  if (isLoading || !quality) return null;

  const items = [
    { name: 'פרופיל עסקי', ...quality.profile, icon: Database },
    { name: 'מתחרים', ...quality.competitors, freshness: quality.competitorsFreshness, icon: TrendingUp },
    { name: 'לידים', ...quality.leads, freshness: quality.leadsFreshness, icon: TrendingUp },
    { name: 'ביקורות', ...quality.reviews, icon: CheckCircle },
    { name: 'תובנות שוק', ...quality.signals, freshness: quality.signalsFreshness, icon: TrendingUp },
  ];

  const overallScore = Math.round(items.reduce((s, i) => s + i.score, 0) / items.length);

  return (
    <div className="card-base p-5">
      <div className="flex items-center gap-2 mb-4">
        <Database className="w-4 h-4 text-primary" />
        <h3 className="text-[13px] font-semibold text-foreground">איכות נתונים</h3>
        <span className="mr-auto text-[20px] font-bold" style={{ color: overallScore >= 70 ? '#10b981' : overallScore >= 50 ? '#d97706' : '#dc2626' }}>
          {overallScore}%
        </span>
      </div>
      
      <div className="space-y-2.5">
        {items.map(item => {
          const Icon = item.icon;
          return (
            <div key={item.name} className="flex items-center gap-2">
              <span className="text-[11px] text-foreground-secondary w-24 flex-shrink-0">{item.name}</span>
              <div className="flex-1 h-2 bg-[#f0f0f0] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${item.score}%`, background: item.color }} />
              </div>
              <span className="text-[10px] font-medium flex-shrink-0 w-8 text-left" style={{ color: item.color }}>{item.score}%</span>
              {item.freshness && item.freshness.stale > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[9px] text-[#d97706]">
                  <Clock className="w-2.5 h-2.5" /> {item.freshness.stale} ישנים
                </span>
              )}
            </div>
          );
        })}
      </div>

      {overallScore < 60 && (
        <div className="mt-3 flex items-start gap-2 px-3 py-2 bg-[#fffbeb] border border-[#fef3c7] rounded-lg">
          <AlertTriangle className="w-3.5 h-3.5 text-[#d97706] mt-0.5 flex-shrink-0" />
          <p className="text-[10px] text-[#d97706]">
            איכות הנתונים נמוכה. מומלץ להשלים פרטי עסק, להוסיף מתחרים ולהפעיל סריקות.
          </p>
        </div>
      )}
    </div>
  );
}