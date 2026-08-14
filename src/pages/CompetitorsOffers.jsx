import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import {
  PLATFORM_LABELS, PLATFORM_COLORS, API_BASE, timeAgo,
  PostDetailModal, AdDetailModal,
} from '@/components/competitors/socialShared';

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

function CompetitorOffersSection({ competitor, offers, onSelectPost, onSelectAd }) {
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
