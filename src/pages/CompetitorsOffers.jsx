import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import {
  PLATFORM_LABELS, PLATFORM_COLORS, API_BASE, timeAgo,
  PostDetailModal, AdDetailModal, useDeepAnalysis,
} from '@/components/competitors/socialShared';

const OFFER_MECHANIC_LABELS = {
  percent_discount: '% הנחה', fixed_amount: 'הנחה קבועה', bogo: 'קנה קבל',
  free_shipping: 'משלוח חינם', bundle: 'באנדל', gift_with_purchase: 'מתנה בקנייה',
  free_trial: 'ניסיון חינם', giveaway: 'הגרלה', loyalty_perk: 'הטבת מועדון', other: 'אחר',
};
const AUDIENCE_INTENT_LABELS = {
  new_customer: 'לקוחות חדשים', retention: 'שימור לקוחות', reactivation: 'הפעלה מחדש',
  list_building: 'גיוס לרשימה', general: 'כללי',
};
const VALUE_FRAMING_LABELS = { relative: 'הנחה יחסית (%)', absolute: 'הנחה מוחלטת (₪)', both: 'יחסית ומוחלטת' };

function pctDelta(offerVal, regularVal) {
  if (offerVal == null || regularVal == null || regularVal === 0) return null;
  return Math.round(((offerVal - regularVal) / regularVal) * 100);
}

function CompetitorOfferInsights({ competitor, bpId }) {
  const { analysis, loading, error, generate } = useDeepAnalysis(competitor, bpId);
  const stats = analysis?.offer_stats;

  return (
    <div className="border-t border-border pt-3 mt-1 space-y-2">
      {!analysis && !loading && (
        <button
          onClick={generate}
          className="w-full py-1.5 text-[11px] border border-dashed border-border rounded-lg hover:bg-muted/50 text-muted-foreground transition-colors"
        >
          ✨ נתח תזמון ומבצעים
        </button>
      )}
      {loading && (
        <div className="flex items-center gap-2 py-2 justify-center text-[11px] text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> מנתח...
        </div>
      )}
      {error && <p className="text-[11px] text-destructive text-center py-1">{error}</p>}
      {analysis && (
        <div className="space-y-1.5">
          {stats && (
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              {stats.mechanic_breakdown[0] && (
                <span className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  🏷️ {OFFER_MECHANIC_LABELS[stats.mechanic_breakdown[0].value] || stats.mechanic_breakdown[0].value} ({stats.mechanic_breakdown[0].count}/{stats.total_offers})
                </span>
              )}
              {stats.peak_day && (
                <span className="px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                  📅 {stats.peak_day} ({stats.peak_day_count}/{stats.total_offers})
                </span>
              )}
              {stats.avg_interval_days != null && (
                <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                  ⏱️ כל ~{stats.avg_interval_days} ימים
                </span>
              )}
              {stats.urgency_pct > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
                  ⚡ {stats.urgency_pct}% דחיפות
                </span>
              )}
              {stats.conditions_pct > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">
                  ⚠️ {stats.conditions_pct}% עם תנאים
                </span>
              )}
              {stats.value_framing_breakdown[0] && (
                <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                  💰 {VALUE_FRAMING_LABELS[stats.value_framing_breakdown[0].value] || stats.value_framing_breakdown[0].value}
                </span>
              )}
              {stats.in_image_pct > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                  🖼️ {stats.in_image_pct}% מוצג בתמונה
                </span>
              )}
              {stats.redemption_breakdown[0] && (
                <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                  📍 {stats.redemption_breakdown[0].value}
                </span>
              )}
              {stats.audience_intent_breakdown[0] && (
                <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                  🎯 {AUDIENCE_INTENT_LABELS[stats.audience_intent_breakdown[0].value] || stats.audience_intent_breakdown[0].value}
                </span>
              )}
            </div>
          )}
          {stats?.performance && (stats.performance.avg_likes_offer_posts != null || stats.performance.avg_likes_regular_posts != null) && (
            <div className="bg-muted/40 rounded-lg p-2 space-y-0.5">
              <p className="text-[10px] font-semibold text-muted-foreground">📈 ביצועי מבצעים לעומת פוסטים רגילים</p>
              <p className="text-[11px] leading-relaxed">
                ❤️ {stats.performance.avg_likes_offer_posts ?? '—'} לעומת {stats.performance.avg_likes_regular_posts ?? '—'} לייקים בממוצע
                {(() => { const d = pctDelta(stats.performance.avg_likes_offer_posts, stats.performance.avg_likes_regular_posts); return d != null ? ` (${d > 0 ? '+' : ''}${d}%)` : ''; })()}
                {' • '}
                💬 {stats.performance.avg_comments_offer_posts ?? '—'} לעומת {stats.performance.avg_comments_regular_posts ?? '—'} תגובות בממוצע
              </p>
            </div>
          )}
          {analysis.promotion_pattern && (
            <div className="bg-muted/40 rounded-lg p-2 space-y-0.5">
              <p className="text-[10px] font-semibold text-muted-foreground">🏷️ תזמון ותדירות מבצעים</p>
              <p className="text-[11px] leading-relaxed">{analysis.promotion_pattern}</p>
            </div>
          )}
          {analysis.offer_recommendation && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[11px] text-amber-900">
              💡 {analysis.offer_recommendation}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button onClick={generate} className="text-[10px] text-muted-foreground underline">רענן ניתוח</button>
            {(analysis.analyzed_at || competitor.social_deep_analysis_at) && (
              <span className="text-[10px] text-muted-foreground">
                עודכן {timeAgo(analysis.analyzed_at || competitor.social_deep_analysis_at)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function offerDate(item) {
  return item.source === 'post' ? (item.posted_at || item.first_seen_at) : item.last_seen_at;
}

function offerDetails(raw) {
  if (!raw) return null;
  try {
    const a = JSON.parse(raw);
    return a?.offer_details || a?.topic || null;
  } catch {
    return null;
  }
}

function OfferCard({ item, onSelect }) {
  const thumb = item.media_url || item.video_url || null;
  const details = offerDetails(item.analysis);

  return (
    <div
      onClick={() => onSelect(item)}
      className="shrink-0 w-40 rounded-xl border border-border bg-background overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
    >
      {thumb ? (
        <img
          src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(thumb)}`}
          alt=""
          className="w-full h-40 object-cover"
          loading="lazy"
          onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex'; }}
        />
      ) : null}
      <div className={`w-full h-40 bg-muted items-center justify-center text-muted-foreground text-xs ${thumb ? 'hidden' : 'flex'}`}>
        {PLATFORM_LABELS[item.platform] || item.platform}
      </div>
      <div className="p-2 space-y-1">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className={`px-1 py-0.5 rounded ${PLATFORM_COLORS[item.platform] || 'bg-gray-100 text-gray-700'}`}>
            {PLATFORM_LABELS[item.platform] || item.platform}
          </span>
          <span className="mr-auto">{timeAgo(offerDate(item))}</span>
        </div>
        <p className="text-[11px] font-medium text-amber-800 bg-amber-50 rounded px-1.5 py-1 leading-snug line-clamp-3">
          🏷️ {details || 'מבצע זוהה'}
        </p>
      </div>
    </div>
  );
}

function CompetitorOffersSection({ competitor, offers, bpId, onSelectPost, onSelectAd }) {
  return (
    <div className="border border-border rounded-xl bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-sm flex-1">{competitor.name}</span>
        <span className="text-[10px] text-muted-foreground">{offers.length} מבצעים</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
        {offers.map(item => (
          <OfferCard
            key={`${item.source}-${item.id}`}
            item={item}
            onSelect={i => (i.source === 'post' ? onSelectPost(i) : onSelectAd(i))}
          />
        ))}
      </div>
      <CompetitorOfferInsights competitor={competitor} bpId={bpId} />
    </div>
  );
}

export default function CompetitorsOffers() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const [selectedPost, setSelectedPost] = useState(null);
  const [selectedAd,   setSelectedAd]   = useState(null);

  const { data: competitors = [], isLoading: loadingComps } = useQuery({
    queryKey: ['offersCompetitors', bpId],
    queryFn:  () => base44.entities.Competitor.filter({ linked_business: bpId, is_dismissed: { not: true }, not_relevant: { not: true } }),
    enabled:  !!bpId,
  });

  const compIds = competitors.map(c => c.id);

  const { data: offerPosts = [], isLoading: loadingPosts } = useQuery({
    queryKey: ['offerPosts', bpId, compIds],
    queryFn:  () => base44.entities.CompetitorPost.filter({ competitor_id: { in: compIds }, has_offer: true }, '-posted_at', 300),
    enabled:  !!bpId && compIds.length > 0,
  });

  const { data: offerAds = [], isLoading: loadingAds } = useQuery({
    queryKey: ['offerAds', bpId, compIds],
    queryFn:  () => base44.entities.CompetitorAdHistory.filter({ competitor_id: { in: compIds }, has_offer: true }, '-last_seen_at', 300),
    enabled:  !!bpId && compIds.length > 0,
  });

  const loading = loadingComps || loadingPosts || loadingAds;

  const allOffers = [
    ...offerPosts.map(p => ({ ...p, source: 'post' })),
    ...offerAds.map(a => ({ ...a, source: 'ad' })),
  ];

  const groups = competitors
    .map(c => ({
      competitor: c,
      offers: allOffers
        .filter(o => o.competitor_id === c.id)
        .sort((a, b) => new Date(offerDate(b)) - new Date(offerDate(a))),
    }))
    .filter(g => g.offers.length > 0);

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <PageHeader title="מבצעי מתחרים" />

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : groups.length === 0 ? (
        <p className="text-center text-muted-foreground py-12 text-sm">
          לא זוהו מבצעים אצל מתחרים עדיין — נסה לרענן ולנתח את הפיד במסך תחרות סושיאל
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map(({ competitor, offers }) => (
            <CompetitorOffersSection
              key={competitor.id}
              competitor={competitor}
              offers={offers}
              bpId={bpId}
              onSelectPost={setSelectedPost}
              onSelectAd={setSelectedAd}
            />
          ))}
        </div>
      )}

      <PostDetailModal post={selectedPost} onClose={() => setSelectedPost(null)} />
      <AdDetailModal   ad={selectedAd}    onClose={() => setSelectedAd(null)} />
    </div>
  );
}
