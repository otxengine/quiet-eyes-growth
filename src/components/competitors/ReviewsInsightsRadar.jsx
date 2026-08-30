import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/components/competitors/socialShared';
import RadarComparisonChart, { normalizeRadarTopics } from '@/components/competitors/RadarComparisonChart';

const REVIEW_RADAR_TOPICS = [
  { key: 'rating',      label: 'דירוג ממוצע' },
  { key: 'reviewCount',  label: 'סה״כ ביקורות' },
  { key: 'reviews30d',  label: 'ביקורות (30 יום)' },
];

function avgOrNull(vals) {
  const nums = vals.filter(v => v != null);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

// Own vs. the average of tracked competitors, one axis per review topic.
// Rating/review_count come straight off the already-loaded Competitor and
// BusinessProfile rows — reviews_30d is the only piece that needs a query,
// since review velocity isn't stored as a scalar anywhere.
export default function ReviewsInsightsRadar({ businessProfile, competitors = [] }) {
  const bpId = businessProfile?.id;

  const { data: leaderboardData } = useQuery({
    queryKey: ['reviewsLeaderboard', bpId],
    queryFn:  () => apiFetch(`/competitors/reviews/leaderboard?businessProfileId=${bpId}`),
    enabled:  !!bpId,
  });

  const radarData = useMemo(() => {
    if (competitors.length === 0) return [];

    const countsByCompetitor = Object.fromEntries((leaderboardData?.leaderboard ?? []).map(l => [l.competitor_id, l.reviews_30d]));

    const own = {
      rating: businessProfile?.google_rating ?? null,
      reviewCount: businessProfile?.google_review_count ?? null,
      reviews30d: leaderboardData ? (leaderboardData.own?.reviews_30d ?? 0) : null,
    };
    const competitorAvg = {
      rating: avgOrNull(competitors.map(c => c.rating)),
      reviewCount: avgOrNull(competitors.map(c => c.review_count)),
      reviews30d: leaderboardData ? avgOrNull(competitors.map(c => countsByCompetitor[c.id] ?? 0)) : null,
    };

    return normalizeRadarTopics(REVIEW_RADAR_TOPICS, own, competitorAvg);
  }, [businessProfile, competitors, leaderboardData]);

  if (competitors.length === 0) return null;

  return (
    <RadarComparisonChart
      title="השוואת ביקורות"
      subtitle="העסק שלי מול ממוצע המתחרים"
      data={radarData}
    />
  );
}
