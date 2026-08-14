import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, Star, Zap, Shield, Target, TrendingUp, Plus } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/shared/PageHeader';
import StatCards from '@/components/shared/StatCards';
import DataTable from '@/components/shared/DataTable';
import AddCompetitorModal from '@/components/competitors/AddCompetitorModal';

const COLUMNS = [
  { key: 'name',     label: 'מתחרה' },
  { key: 'city',     label: 'מיקום' },
  { key: 'rating',   label: 'דירוג' },
  { key: 'ads',      label: 'פרסום ממומן' },
  { key: 'action',   label: 'פעולה' },
];

// ── Business DNA Panel ────────────────────────────────────────────────────────
// Shows the AI-scraped competitive profile of OUR business so we know
// what advantages to position against competitors.

function BusinessDnaPanel({ businessProfile }) {
  const dp = useMemo(() => {
    try { return JSON.parse(businessProfile?.business_deep_profile || '{}'); } catch { return {}; }
  }, [businessProfile?.business_deep_profile]);

  const missions = useMemo(() => {
    try { return JSON.parse(businessProfile?.agent_missions || '{}'); } catch { return {}; }
  }, [businessProfile?.agent_missions]);

  const usps   = dp.unique_selling_points   || [];
  const services = dp.actual_services       || [];
  const audience = dp.target_audience_detected;
  const adGapSummary = missions.competitor_watch_he;

  if (!usps.length && !services.length && !adGapSummary) return null;

  return (
    <div className="rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50 to-indigo-50 p-4 mb-2">
      <div className="flex items-center gap-2 mb-3">
        <Shield className="w-4 h-4 text-violet-600" />
        <span className="text-sm font-bold text-violet-700">פרופיל תחרותי — העסק שלך</span>
        <span className="text-[10px] text-violet-400 bg-violet-100 px-2 py-0.5 rounded-full">AI Intelligence</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {usps.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-violet-500 mb-1.5 uppercase tracking-wide">יתרונות ייחודיים</p>
            <div className="space-y-1">
              {usps.slice(0, 3).map((usp, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <Zap className="w-3 h-3 text-amber-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[11px] text-gray-700">{usp}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {services.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-violet-500 mb-1.5 uppercase tracking-wide">שירותים מאומתים</p>
            <div className="flex flex-wrap gap-1">
              {services.slice(0, 5).map((s, i) => (
                <span key={i} className="text-[10px] bg-white border border-violet-200 text-violet-700 px-2 py-0.5 rounded-full">{s}</span>
              ))}
            </div>
          </div>
        )}
        {(audience || adGapSummary) && (
          <div>
            {audience && (
              <>
                <p className="text-[10px] font-semibold text-violet-500 mb-1.5 uppercase tracking-wide">קהל יעד</p>
                <p className="text-[11px] text-gray-700">{audience}</p>
              </>
            )}
            {adGapSummary && (
              <p className="text-[10px] text-indigo-600 mt-1.5 flex items-center gap-1">
                <Target className="w-3 h-3" /> {adGapSummary}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Competitor Ad Intel Badge ─────────────────────────────────────────────────

function AdIntelBadge({ comp }) {
  if (!comp.sponsored_ads_detected) {
    return <span className="text-[10px] text-gray-300">—</span>;
  }
  const platforms = (comp.active_ad_platforms || '').split(',').map(p => p.trim()).filter(Boolean);
  const count = comp.active_ad_count || '?';
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <TrendingUp className="w-3 h-3 text-orange-500" />
        <span className="text-[10px] font-semibold text-orange-600">{count} מודעות</span>
      </div>
      {platforms.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {platforms.slice(0, 3).map(p => (
            <span key={p} className="text-[9px] bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded">{p}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function StarRating({ rating }) {
  const r = Math.round(Number(rating) || 0);
  return (
    <div className="flex items-center gap-1">
      {[1,2,3,4,5].map(i => (
        <Star key={i} className={`w-3 h-3 ${i <= r ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200 fill-gray-200'}`} />
      ))}
      <span className="text-xs text-foreground-secondary mr-1">{Number(rating || 0).toFixed(1)}</span>
    </div>
  );
}

async function fetchCompetitorChanges(bpId) {
  const [signals, alerts] = await Promise.all([
    base44.entities.MarketSignal.filter({ linked_business: bpId, category: 'competitor_move' }, '-detected_at', 20).catch(() => []),
    base44.entities.ProactiveAlert.filter(
      { linked_business: bpId, alert_type: { in: ['competitor_move', 'competitor_intel', 'competitor_attack'] }, is_dismissed: false },
      '-created_at', 10
    ).catch(() => []),
  ]);
  return [...signals.map(s => ({ id: s.id, title: s.title || s.summary || '', summary: s.summary || '', detected_at: s.detected_at, kind: 'signal' })),
          ...alerts.map(a => ({ id: a.id, title: a.title || '', summary: a.description || '', detected_at: a.created_at, kind: 'alert' }))].slice(0, 10);
}

export default function Competitors() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [scanning, setScanning] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  const { data: competitors = [], isLoading } = useQuery({
    queryKey: ['competitorsPage', bpId],
    queryFn: () => base44.entities.Competitor.filter({ linked_business: bpId }),
    enabled: !!bpId,
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['competitorsReviews', bpId],
    queryFn: () => base44.entities.Review.filter({ linked_business: bpId }),
    enabled: !!bpId,
  });

  const { data: changes = [] } = useQuery({
    queryKey: ['competitorChanges', bpId],
    queryFn: () => fetchCompetitorChanges(bpId),
    enabled: !!bpId,
  });

  const handleScan = async () => {
    setScanning(true);
    toast.info('מתחיל סריקת מתחרים...');
    try {
      await base44.functions.invoke('scanCompetitors', { businessProfileId: bpId });
      queryClient.invalidateQueries({ queryKey: ['competitorsPage', bpId] });
      queryClient.invalidateQueries({ queryKey: ['competitorChanges', bpId] });
      toast.success('סריקת מתחרים הושלמה');
    } catch { toast.error('שגיאה בסריקת מתחרים'); }
    setScanning(false);
  };

  const avgRating = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / reviews.length
    : null;

  const risingCount   = competitors.filter(c => c.trend === 'rising'   || c.trend_direction === 'up').length;
  const decliningCount= competitors.filter(c => c.trend === 'declining' || c.trend_direction === 'down').length;

  const statCards = [
    { count: competitors.length, label: 'סה"כ מתחרים',   borderColor: 'blue' },
    { count: risingCount,        label: 'מגמת עלייה',     borderColor: 'none' },
    { count: decliningCount,     label: 'מגמת ירידה',     borderColor: 'yellow' },
    { count: avgRating ? avgRating.toFixed(1) : '—', label: 'הדירוג שלי', borderColor: 'none' },
  ];

  // "מהלכי מתחרים" — top insight card + 3 activity cards
  const topChange = changes[0];
  const activityChanges = changes.slice(1, 4);

  return (
    <div className="space-y-5">
      <PageHeader
        count={competitors.length}
        title="מתחרים"
        actionLabel={scanning ? 'סורק...' : 'סרוק מתחרים'}
        actionIcon={scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        onAction={handleScan}
        secondaryLabel="הוסף מתחרה"
        secondaryIcon={<Plus className="w-4 h-4" />}
        onSecondaryAction={() => setShowAddModal(true)}
      />

      {showAddModal && (
        <AddCompetitorModal
          bpId={bpId}
          onClose={() => setShowAddModal(false)}
          onAdded={() => setShowAddModal(false)}
        />
      )}

      <StatCards cards={statCards} />

      <BusinessDnaPanel businessProfile={businessProfile} />

      {/* מהלכי מתחרים */}
      {(topChange || activityChanges.length > 0) && (
        <div className="mb-2">
          <h3 className="text-sm font-bold text-foreground-secondary mb-3 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500 inline-block" />
            מהלכי מתחרים
          </h3>
          <div className="space-y-3">
            {/* Large gradient insight card */}
            {topChange && (
              <div
                className="rounded-xl p-5"
                style={{ background: 'linear-gradient(135deg, #f3e5f5 0%, #e8eaf6 100%)' }}
              >
                <div className="text-xs font-semibold text-violet-600 mb-2">עדכון אחרון</div>
                <div className="font-semibold text-sm text-foreground mb-1">{topChange.title}</div>
                {topChange.summary && topChange.summary !== topChange.title && (
                  <div className="text-xs text-foreground-secondary">{topChange.summary}</div>
                )}
              </div>
            )}
            {/* 3 activity cards */}
            {activityChanges.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {activityChanges.map((c, i) => (
                  <div key={i} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
                    <div className="font-medium text-xs text-foreground line-clamp-2">{c.title}</div>
                    {c.summary && <div className="text-[10px] text-foreground-muted mt-1 line-clamp-1">{c.summary}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
        </div>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={competitors}
          emptyText="אין מתחרים — הוסף מתחרים ידנית או הפעל סריקה"
          renderCell={(comp, col) => {
            if (col.key === 'name') return (
              <div>
                <div className="font-semibold text-sm text-foreground">{comp.name}</div>
                {comp.weaknesses && (
                  <div className="text-[10px] text-rose-500 mt-0.5 line-clamp-1">⚠ {comp.weaknesses.slice(0, 60)}</div>
                )}
                {comp.website && (
                  <a href={comp.website} target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 hover:underline">
                    {comp.website.replace(/^https?:\/\//, '').slice(0, 30)}
                  </a>
                )}
              </div>
            );
            if (col.key === 'city') return (
              <div>
                <span className="text-xs text-foreground-secondary">{comp.city || comp.location || '—'}</span>
                {comp.ad_gaps && (
                  <div className="text-[10px] text-emerald-600 mt-0.5 line-clamp-1">💡 {comp.ad_gaps.slice(0, 50)}</div>
                )}
              </div>
            );
            if (col.key === 'rating') return (
              <div>
                <StarRating rating={comp.google_rating || comp.rating || 0} />
                {comp.review_count && (
                  <div className="text-[10px] text-foreground-muted mt-0.5">{comp.review_count} ביקורות</div>
                )}
                {comp.price_range && (
                  <div className="text-[10px] text-foreground-muted mt-0.5">{comp.price_range}</div>
                )}
              </div>
            );
            if (col.key === 'ads') return <AdIntelBadge comp={comp} />;
            if (col.key === 'action') return (
              <button className="text-[11px] font-semibold text-[#e8344d] border border-[#e8344d]/30 px-3 py-1 rounded-full hover:bg-red-50 transition-colors">
                גלה מעמיק
              </button>
            );
            return null;
          }}
        />
      )}
    </div>
  );
}
