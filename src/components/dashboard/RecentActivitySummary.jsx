import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { ChevronLeft } from 'lucide-react';
import StatCards from '@/components/shared/StatCards';

/**
 * RecentActivitySummary — real "what happened in the last 24 hours" counts
 * across reviews, competitor posts/ads, and insights (signals + alerts).
 * Replaces the old "בזמן שישנת" block, which only covered leads and had a
 * hardcoded churn value.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function isWithinLast24h(dateStr) {
  if (!dateStr) return false;
  const t = new Date(dateStr).getTime();
  return !Number.isNaN(t) && Date.now() - t < DAY_MS;
}

export default function RecentActivitySummary({ businessProfile }) {
  const navigate = useNavigate();
  const bpId = businessProfile?.id;

  const { data: reviews = [] } = useQuery({
    queryKey: ['recentActivityReviews', bpId],
    queryFn: () => base44.entities.Review.filter({ linked_business: bpId }, '-created_date', 100),
    enabled: !!bpId,
  });

  const { data: competitorPosts = [] } = useQuery({
    queryKey: ['recentActivityCompetitorPosts', bpId],
    queryFn: () => base44.entities.CompetitorPost.filter({ linked_business: bpId }, '-first_seen_at', 100),
    enabled: !!bpId,
  });

  const { data: competitorAds = [] } = useQuery({
    queryKey: ['recentActivityCompetitorAds', bpId],
    queryFn: () => base44.entities.CompetitorAdHistory.filter({ linked_business: bpId }, '-first_seen_at', 100),
    enabled: !!bpId,
  });

  const { data: signals = [] } = useQuery({
    queryKey: ['recentActivitySignals', bpId],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId }, '-detected_at', 100),
    enabled: !!bpId,
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['recentActivityAlerts', bpId],
    queryFn: () => base44.entities.ProactiveAlert.filter({ linked_business: bpId }, '-created_at', 100),
    enabled: !!bpId,
  });

  const newReviews    = reviews.filter(r => isWithinLast24h(r.created_date));
  const newPosts      = competitorPosts.filter(p => isWithinLast24h(p.first_seen_at));
  const newAds        = competitorAds.filter(a => isWithinLast24h(a.first_seen_at));
  const newSignals    = signals.filter(s => isWithinLast24h(s.detected_at));
  const newAlerts     = alerts.filter(a => isWithinLast24h(a.created_at));
  const newInsights   = newSignals.length + newAlerts.length;

  const statCards = [
    { count: newReviews.length,     label: 'ביקורות חדשות',              borderColor: 'blue' },
    { count: newPosts.length,       label: 'פוסטים חדשים ממתחרים',       borderColor: 'yellow' },
    { count: newAds.length,         label: 'מודעות חדשות ממתחרים',       borderColor: 'none' },
    { count: newInsights,           label: 'תובנות חדשות',               borderColor: 'green' },
  ];

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between mb-4">
        <button onClick={() => navigate('/insights')} className="text-[12px] font-semibold text-[#e8344d] flex items-center gap-0.5 mt-1">
          כל התובנות <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <div className="text-right">
          <h3 className="text-[15px] font-bold text-gray-900">פעילות ב-24 השעות האחרונות</h3>
          <p className="text-[11px] text-gray-400 mt-0.5">כל מה שהתגלה ונאסף עבור העסק שלך ביממה האחרונה</p>
        </div>
      </div>
      <StatCards cards={statCards} />
    </div>
  );
}
