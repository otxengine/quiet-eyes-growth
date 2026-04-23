import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { TrendingUp, TrendingDown, Minus, Loader2, RefreshCw } from 'lucide-react';
import LeadSourcesChart from '@/components/market-analysis/LeadSourcesChart';
import DemandTrendChart from '@/components/market-analysis/DemandTrendChart';
import CompetitorPricingChart from '@/components/market-analysis/CompetitorPricingChart';
import AiInsightBox from '@/components/ai/AiInsightBox';
import { SkeletonList } from '@/components/ui/SkeletonCard';

const TREND_ICONS = {
  growing:  { icon: TrendingUp,   color: 'text-green-600',  label: 'צמיחה' },
  stable:   { icon: Minus,        color: 'text-amber-500',  label: 'יציב'  },
  declining:{ icon: TrendingDown, color: 'text-red-500',    label: 'ירידה' },
};

const POSITION_LABELS = {
  leader:     { label: 'מוביל שוק',   color: 'bg-green-50 text-green-700 border-green-200'  },
  challenger: { label: 'מתחרה עיקרי', color: 'bg-blue-50 text-blue-700 border-blue-200'    },
  niche:      { label: 'נישה',         color: 'bg-purple-50 text-purple-700 border-purple-200' },
  new:        { label: 'עסק חדש',      color: 'bg-gray-50 text-gray-600 border-gray-200'    },
};

const SIZE_LABELS = { גדול: 'גדול', בינוני: 'בינוני', קטן: 'קטן' };

export default function MarketAnalysis() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const [analysisData, setAnalysisData] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);

  const { data: leads = [] } = useQuery({
    queryKey: ['marketLeads', bpId],
    queryFn: () => base44.entities.Lead.filter({ linked_business: bpId }, '-created_date', 200),
    enabled: !!bpId,
  });

  const { data: signals = [] } = useQuery({
    queryKey: ['marketSignals', bpId],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId }, '-detected_at', 200),
    enabled: !!bpId,
  });

  const { data: competitors = [] } = useQuery({
    queryKey: ['marketCompetitors', bpId],
    queryFn: () => base44.entities.Competitor.filter({ linked_business: bpId }),
    enabled: !!bpId,
  });

  // Quick local stats
  const hotLeads    = leads.filter(l => l.status === 'hot').length;
  const weekAgo     = new Date(Date.now() - 7 * 86400000).toISOString();
  const weekSignals = signals.filter(s => (s.detected_at || s.created_date) >= weekAgo).length;
  const opps        = signals.filter(s => s.category === 'opportunity').length;
  const threats     = signals.filter(s => s.category === 'threat').length;
  const totalLeads  = leads.length;
  const completedLeads = leads.filter(l => l.status === 'completed').length;
  const convRate    = totalLeads > 0 ? Math.round((completedLeads / totalLeads) * 100) : 0;

  async function loadAnalysis() {
    if (!bpId) return;
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const res = await base44.functions.invoke('generateMarketAnalysis', { businessProfileId: bpId });
      const data = res?.data || res;
      setAnalysisData(data);
    } catch (e) {
      setAnalysisError('שגיאה בטעינת ניתוח שוק');
    } finally {
      setAnalysisLoading(false);
    }
  }

  const analysis  = analysisData?.analysis;
  const metrics   = analysisData?.metrics;

  const trendMeta = TREND_ICONS[analysis?.market_trend] || TREND_ICONS.stable;
  const TrendIcon = trendMeta.icon;
  const posMeta   = POSITION_LABELS[analysis?.our_position] || POSITION_LABELS.new;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-[16px] font-bold text-foreground tracking-tight">ניתוח שוק</h1>
        <button
          onClick={loadAnalysis}
          disabled={analysisLoading}
          className="btn-subtle flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 transition-all disabled:opacity-50"
        >
          {analysisLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {analysisLoading ? 'מנתח...' : 'נתח שוק'}
        </button>
      </div>

      {/* 4 core metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'הזדמנויות', value: opps,        sub: `${threats} איומים` },
          { label: 'סיגנלים השבוע', value: weekSignals, sub: `סה"כ: ${signals.length}` },
          { label: 'המרת לידים',   value: `${convRate}%`,  sub: `${hotLeads} חמים כרגע` },
          { label: 'מתחרים',       value: competitors.length, sub: 'מזוהים' },
        ].map((card, i) => (
          <div key={card.label} className={`card-base p-5 fade-in-up stagger-${i + 1}`}>
            <p className="text-[11px] font-medium text-foreground-muted mb-1">{card.label}</p>
            <span className="text-[28px] font-bold text-foreground leading-none tracking-tight">{card.value}</span>
            {card.sub && <p className="text-[10px] text-foreground-muted mt-1">{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* LLM Market Analysis result */}
      {analysisLoading && <SkeletonList count={2} lines={4} />}

      {analysisError && (
        <div className="card-base px-4 py-3 border-red-100 bg-red-50">
          <p className="text-[12px] text-red-600">{analysisError}</p>
        </div>
      )}

      {analysis && !analysisLoading && (
        <div className="card-base p-5 space-y-4">
          {/* Header row */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-[14px] font-semibold text-foreground">ניתוח שוק — AI</h2>
            <div className="flex items-center gap-2">
              {analysis.market_trend && (
                <span className={`flex items-center gap-1 text-[11px] font-semibold ${trendMeta.color}`}>
                  <TrendIcon className="w-3.5 h-3.5" /> {trendMeta.label}
                </span>
              )}
              {analysis.our_position && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${posMeta.color}`}>
                  {posMeta.label}
                </span>
              )}
              {analysis.market_size_estimate && (
                <span className="text-[10px] text-foreground-muted">
                  שוק: {SIZE_LABELS[analysis.market_size_estimate] || analysis.market_size_estimate}
                </span>
              )}
            </div>
          </div>

          {/* Top opportunity + threat */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {analysis.top_opportunity && (
              <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3">
                <p className="text-[10px] font-semibold text-green-600 mb-1">🟢 הזדמנות מובילה</p>
                <p className="text-[12px] text-green-900">{analysis.top_opportunity}</p>
              </div>
            )}
            {analysis.biggest_threat && (
              <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                <p className="text-[10px] font-semibold text-red-600 mb-1">🔴 איום עיקרי</p>
                <p className="text-[12px] text-red-900">{analysis.biggest_threat}</p>
              </div>
            )}
          </div>

          {/* Focus + advantage */}
          {analysis.recommended_focus && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
              <p className="text-[10px] font-semibold text-indigo-600 mb-1">🎯 מוקד מומלץ</p>
              <p className="text-[13px] font-medium text-indigo-900">{analysis.recommended_focus}</p>
            </div>
          )}

          {/* Market gaps */}
          {analysis.market_gaps?.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-foreground-secondary mb-2">פערים שלא נוצלו</p>
              <div className="flex flex-wrap gap-2">
                {analysis.market_gaps.map((gap, i) => (
                  <span key={i} className="text-[11px] px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg">
                    {gap}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Competitive advantage */}
          {analysis.competitive_advantage && (
            <p className="text-[11px] text-foreground-muted">
              <span className="font-semibold text-foreground">היתרון שלך: </span>
              {analysis.competitive_advantage}
            </p>
          )}
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LeadSourcesChart leads={leads} />
        <CompetitorPricingChart competitors={competitors} />
      </div>

      <DemandTrendChart signals={signals} />

      <AiInsightBox
        title="חיזוי מגמות שוק וסימולציה אסטרטגית"
        prompt={`אתה חוקר שוק מומחה בתחום ${businessProfile?.category} ב${businessProfile?.city}, ישראל.
נתונים: ${signals.length} סיגנלים (${weekSignals} השבוע), ${opps} הזדמנויות, ${hotLeads} לידים חמים, ${competitors.length} מתחרים.
אותות אחרונים: ${signals.slice(0, 8).map(s => s.summary).join('; ')}.
מתחרים: ${competitors.slice(0, 5).map(c => `${c.name} (${c.rating || '?'})`).join(', ')}.
1) חזה 3 מגמות שוק לרבעון הקרוב 2) הצע סימולציה של "מה אם" (שינויי מחירים, כניסת מתחרים) 3) הצע אסטרטגיות ניצול הזדמנויות. בעברית, Markdown.`}
      />
    </div>
  );
}
