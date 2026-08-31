import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/components/competitors/socialShared';
import { th } from '@/components/competitors/topicLabels';
import RadarComparisonChart from '@/components/competitors/RadarComparisonChart';

// Own vs. pooled-competitor sentiment per review topic — service, price,
// quality, cleanliness, etc. — extracted from real review text (same
// topic_sentiment data the "נושאים לפי רבעון" table above uses). Each axis
// is already a 0-100% positive-sentiment ratio, so it's passed straight
// through — no relative normalization needed, unlike the social radar's
// wildly-different-scale metrics (followers vs. post counts).
export default function ReviewsInsightsRadar({ businessProfile, competitors = [] }) {
  const bpId = businessProfile?.id;

  const { data } = useQuery({
    queryKey: ['reviewsTopicsComparison', bpId],
    queryFn:  () => apiFetch(`/competitors/reviews/topics-comparison?businessProfileId=${bpId}`),
    enabled:  !!bpId,
  });

  const radarData = useMemo(() => (data?.topics ?? []).map(t => ({
    topic: th(t.topic),
    own: t.own_pct,
    competitors: t.competitor_pct,
  })), [data]);

  if (competitors.length === 0) return null;

  return (
    <RadarComparisonChart
      title="השוואת נושאי ביקורות"
      subtitle="אחוז חוות דעת חיוביות בכל נושא — העסק שלי מול ממוצע המתחרים"
      captionText="כל ציר = % ביקורות חיוביות מתוך הביקורות שהזכירו את הנושא"
      data={radarData}
    />
  );
}
