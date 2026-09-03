import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2 } from 'lucide-react';
import StatCards from '@/components/shared/StatCards';
import TopThemesChart from '@/components/reputation/TopThemesChart';
import LeadSourcesChart from '@/components/market-analysis/LeadSourcesChart';
import { TOPIC_HE } from '@/components/competitors/topicLabels';

const SENTIMENT_LABEL = { positive: 'חיובי', negative: 'שלילי', neutral: 'ניטרלי', mixed: 'מעורב' };

/**
 * Real customer-data insights: sentiment/pain-point themes from actual
 * reviews (via analyzeSentiment → computeThemeRollup) and lead-source
 * breakdown from actual leads — as opposed to AudienceSegments.jsx's
 * AI-generated ad-targeting profiles.
 */
export default function AudienceInsights({ businessProfileId: bpId }) {
  const { data: sentiment, isLoading: loadingSentiment } = useQuery({
    queryKey: ['audienceSentiment', bpId],
    queryFn: async () => {
      const res = await base44.functions.invoke('analyzeSentiment', { businessProfileId: bpId });
      return res?.data || res;
    },
    enabled: !!bpId,
  });

  const { data: leads = [], isLoading: loadingLeads } = useQuery({
    queryKey: ['leadsForAudience', bpId],
    queryFn: () => base44.entities.Lead.filter({ linked_business: bpId }, '-created_date', 200),
    enabled: !!bpId,
  });

  if (loadingSentiment || loadingLeads) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-foreground-muted" /></div>;
  }

  const statCards = [
    { count: SENTIMENT_LABEL[sentiment?.overall] || '—', label: 'סנטימנט כללי', borderColor: 'blue' },
    { count: sentiment?.positive_count ?? 0, label: 'ביקורות חיוביות', borderColor: 'green' },
    { count: sentiment?.negative_count ?? 0, label: 'ביקורות שליליות', borderColor: 'red' },
    { count: sentiment?.sample_size ?? 0, label: 'סה"כ ביקורות שנותחו', borderColor: 'none' },
  ];

  return (
    <div className="space-y-5">
      <StatCards cards={statCards} />

      {sentiment?.key_insight && (
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-[13px] font-semibold text-foreground mb-1">💡 {sentiment.key_insight}</p>
          {sentiment.recommendations?.length > 0 && (
            <ul className="text-[12px] text-foreground-muted list-disc pr-4 space-y-0.5 mt-2">
              {sentiment.recommendations.map((rec, i) => <li key={i}>{rec}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-[13px] font-semibold text-foreground mb-3">נושאים מרכזיים אצל הלקוחות שלך</p>
        {sentiment?.top_themes?.length > 0 ? (
          <TopThemesChart topThemes={sentiment.top_themes} labelById={TOPIC_HE} />
        ) : (
          <p className="text-[12px] text-foreground-muted text-center py-8">אין מספיק ביקורות לניתוח נושאים עדיין</p>
        )}
      </div>

      <LeadSourcesChart leads={leads} />
    </div>
  );
}
