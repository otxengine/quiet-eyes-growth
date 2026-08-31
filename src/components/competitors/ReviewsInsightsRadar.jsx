import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/components/competitors/socialShared';
import RadarComparisonChart, { normalizeRadarTopics } from '@/components/competitors/RadarComparisonChart';

const REVIEW_RADAR_TOPICS = [
  { key: 'rating',        label: 'דירוג ממוצע' },
  { key: 'reviewCount',   label: 'סה״כ ביקורות' },
  { key: 'reviewsRecent', label: 'ביקורות (שנה אחרונה)' },
];

function avgOrNull(vals) {
  const nums = vals.filter(v => v != null);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

// Own vs. the average of tracked competitors, one axis per review topic.
// Competitor rating/review_count come straight off the already-loaded
// Competitor rows. Own rating/review_count prefer BusinessProfile's
// google_rating/google_review_count, but those are frequently unset (only
// populated via a specific Google sync) — the backend falls back to
// computing them from the business's actual review rows, so this just
// applies the same preference client-side once that data has loaded.
export default function ReviewsInsightsRadar({ businessProfile, competitors = [] }) {
  const bpId = businessProfile?.id;

  const { data: leaderboardData } = useQuery({
    queryKey: ['reviewsLeaderboard', bpId],
    queryFn:  () => apiFetch(`/competitors/reviews/leaderboard?businessProfileId=${bpId}`),
    enabled:  !!bpId,
  });

  const radarData = useMemo(() => {
    if (competitors.length === 0) return [];

    const countsByCompetitor = Object.fromEntries((leaderboardData?.leaderboard ?? []).map(l => [l.competitor_id, l.reviews_recent]));

    const own = {
      rating: businessProfile?.google_rating ?? (leaderboardData ? leaderboardData.own?.rating ?? null : null),
      reviewCount: businessProfile?.google_review_count ?? (leaderboardData ? leaderboardData.own?.review_count ?? null : null),
      reviewsRecent: leaderboardData ? (leaderboardData.own?.reviews_recent ?? 0) : null,
    };
    const competitorAvg = {
      rating: avgOrNull(competitors.map(c => c.rating)),
      reviewCount: avgOrNull(competitors.map(c => c.review_count)),
      reviewsRecent: leaderboardData ? avgOrNull(competitors.map(c => countsByCompetitor[c.id] ?? 0)) : null,
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
