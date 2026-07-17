import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, Star } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/shared/PageHeader';
import StatCards from '@/components/shared/StatCards';
import DataTable from '@/components/shared/DataTable';
import GoogleCompareWidget from '@/components/competitors/GoogleCompareWidget';
import BattlecardPanel from '@/components/competitors/BattlecardPanel';

const COLUMNS = [
  { key: 'name',     label: 'מתחרה' },
  { key: 'category', label: 'קטגוריה' },
  { key: 'city',     label: 'מיקום' },
  { key: 'rating',   label: 'דירוג וביקורות' },
  { key: 'action',   label: 'פעולה' },
];

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
  const [selectedCompetitor, setSelectedCompetitor] = useState(null);

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
      />

      <StatCards cards={statCards} />

      <GoogleCompareWidget
        businessProfileId={bpId}
        businessName={businessProfile?.name}
      />

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
                {comp.website && (
                  <a href={comp.website} target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 hover:underline">
                    {comp.website.replace(/^https?:\/\//, '').slice(0, 30)}
                  </a>
                )}
              </div>
            );
            if (col.key === 'category') return (
              <span className="text-xs bg-gray-100 text-foreground-secondary px-2 py-0.5 rounded-full">
                {comp.category || '—'}
              </span>
            );
            if (col.key === 'city') return (
              <span className="text-xs text-foreground-secondary">{comp.city || comp.location || '—'}</span>
            );
            if (col.key === 'rating') return (
              <div>
                <StarRating rating={comp.google_rating || comp.rating || 0} />
                {comp.review_count && (
                  <div className="text-[10px] text-foreground-muted mt-0.5">{comp.review_count} ביקורות</div>
                )}
              </div>
            );
            if (col.key === 'action') return (
              <button
                onClick={() => setSelectedCompetitor(prev => prev?.id === comp.id ? null : comp)}
                className={`text-xs font-semibold px-3 py-1 rounded-lg transition-colors ${selectedCompetitor?.id === comp.id ? 'bg-violet-600 text-white' : 'text-violet-600 hover:text-violet-800 bg-violet-50'}`}
              >
                ניתוח מעמיק
              </button>
            );
            return null;
          }}
        />
      )}

      {selectedCompetitor && (
        <div className="mt-2">
          <div dir="rtl" className="px-1 mb-2 text-[12px] font-semibold text-foreground-secondary">
            ניתוח מעמיק — {selectedCompetitor.name}
          </div>
          <BattlecardPanel
            competitor={selectedCompetitor}
            businessProfile={businessProfile}
          />
        </div>
      )}
    </div>
  );
}
