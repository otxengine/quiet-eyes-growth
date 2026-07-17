import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import GoogleCompareWidget from '@/components/competitors/GoogleCompareWidget';
import TopicTimelineWidget from '@/components/competitors/TopicTimelineWidget';
import CompetitorReviewInsightsPanel from '@/components/competitors/CompetitorReviewInsightsPanel';

export default function ReviewsCompare() {
  // @ts-ignore
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const [selectedId, setSelectedId] = useState(null);

  const lsKey = bpId ? `compare-set-${bpId}` : null;
  // ponytail: read comparison set inline — same key as GoogleCompareWidget (R3-3)
  const storedIds = (() => { try { return JSON.parse(localStorage.getItem(lsKey) ?? 'null'); } catch { return null; } })();

  const { data: competitors = [] } = useQuery({
    queryKey: ['competitors', bpId],
    queryFn: () => base44.entities.Competitor.filter({ linked_business: bpId }),
    enabled: !!bpId,
  });

  // null stored → show all; [] → user explicitly cleared set
  const activeIds = storedIds ?? competitors.map(c => c.id);
  const listed = competitors.filter(c => activeIds.includes(c.id));
  const selectedComp = competitors.find(c => c.id === selectedId);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3" dir="rtl">
        <Link to="/reviews" className="flex items-center gap-1 text-[12px] text-foreground-muted hover:text-foreground transition-colors">
          <ArrowRight className="w-4 h-4" />
          חזרה למוניטין
        </Link>
        <span className="text-lg font-semibold text-foreground">השוואת Google</span>
      </div>
      <GoogleCompareWidget businessProfileId={bpId} businessName={businessProfile?.name} />
      <TopicTimelineWidget businessProfileId={bpId} businessName={businessProfile?.name} />

      {/* AC1: competitor list visible on Comparison page */}
      {listed.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide" dir="rtl">
            תובנות ביקורות — מתחרים
          </p>
          <div className="flex flex-wrap gap-2" dir="rtl">
            {listed.map(c => (
              <button
                key={c.id}
                onClick={() => setSelectedId(id => id === c.id ? null : c.id)}
                className={`text-[12px] px-3 py-1.5 rounded-lg border transition-colors ${
                  selectedId === c.id
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'border-border text-foreground-secondary hover:border-violet-400 hover:text-foreground'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
          {/* AC2: insights panel — read-only, no reply/publish actions (AC3 handled in component) */}
          {selectedComp && (
            <CompetitorReviewInsightsPanel competitor={selectedComp} businessProfileId={bpId} />
          )}
        </div>
      )}
    </div>
  );
}
