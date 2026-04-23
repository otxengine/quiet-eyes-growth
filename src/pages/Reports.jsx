import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import {
  FileBarChart, Loader2, TrendingUp, TrendingDown, Minus,
  Star, Zap, AlertTriangle, CheckCircle, Target, Users,
} from 'lucide-react';

import MonthCompareCards from '@/components/reports/MonthCompareCards';
import MonthlyGrowthChart from '@/components/reports/MonthlyGrowthChart';
import ConversionFunnel from '@/components/reports/ConversionFunnel';
import SentimentBreakdown from '@/components/reports/SentimentBreakdown';
import SignalCategoryChart from '@/components/reports/SignalCategoryChart';

const TABS = [
  { id: 'weekly',      label: 'דוח שבועי',   icon: '📅' },
  { id: 'competitors', label: 'מתחרים',       icon: '⚔️' },
  { id: 'leads',       label: 'לידים',        icon: '🎯' },
];

const TREND_ICON = {
  up:     <TrendingUp  className="w-4 h-4 text-green-500" />,
  down:   <TrendingDown className="w-4 h-4 text-red-500" />,
  stable: <Minus        className="w-4 h-4 text-gray-400" />,
};

function ScoreBadge({ score }) {
  const color = score >= 7 ? 'text-green-600 bg-green-50 border-green-200'
              : score >= 4 ? 'text-amber-600 bg-amber-50 border-amber-200'
              :              'text-red-600 bg-red-50 border-red-200';
  return (
    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full border text-[13px] font-bold ${color}`}>
      {score}/10
    </span>
  );
}

function MetricCard({ label, value, sub, color = 'gray' }) {
  const bg = { indigo: 'bg-indigo-50 border-indigo-100', green: 'bg-green-50 border-green-100', amber: 'bg-amber-50 border-amber-100', red: 'bg-red-50 border-red-100', gray: 'bg-gray-50 border-gray-100' }[color];
  const txt = { indigo: 'text-indigo-700', green: 'text-green-700', amber: 'text-amber-700', red: 'text-red-700', gray: 'text-gray-700' }[color];
  return (
    <div className={`rounded-xl border px-4 py-3 ${bg}`}>
      <p className="text-[10px] text-gray-400 mb-0.5">{label}</p>
      <p className={`text-[18px] font-bold ${txt}`}>{value ?? '—'}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function Reports() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;

  const [activeTab, setActiveTab] = useState('weekly');
  const [weeklyReport, setWeeklyReport] = useState(null); // { report, stats }
  const [weeklyLoading, setWeeklyLoading] = useState(false);

  const { data: signals = [] }     = useQuery({ queryKey: ['reportSignals', bpId],     queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId }, '-detected_at', 200), enabled: !!bpId });
  const { data: leads = [] }       = useQuery({ queryKey: ['reportLeads', bpId],       queryFn: () => base44.entities.Lead.filter({ linked_business: bpId }, '-created_date', 200), enabled: !!bpId });
  const { data: reviews = [] }     = useQuery({ queryKey: ['reportReviews', bpId],     queryFn: () => base44.entities.Review.filter({ linked_business: bpId }, '-created_date', 200), enabled: !!bpId });
  const { data: competitors = [] } = useQuery({ queryKey: ['reportCompetitors', bpId], queryFn: () => base44.entities.Competitor.filter({ linked_business: bpId }), enabled: !!bpId });

  const totalData = signals.length + leads.length + reviews.length;

  // Client-side lead stats (used in leads tab)
  const hotLeads       = leads.filter(l => l.status === 'hot').length;
  const completedLeads = leads.filter(l => l.status === 'completed').length;
  const coldLeads      = leads.filter(l => l.status === 'cold').length;
  const conversionRate = leads.length > 0 ? Math.round((completedLeads / leads.length) * 100) : 0;
  const leadSources = leads.reduce((acc, l) => {
    const src = l.source || 'אחר';
    acc[src] = (acc[src] || 0) + 1;
    return acc;
  }, {});
  const topSources = Object.entries(leadSources).sort((a, b) => b[1] - a[1]).slice(0, 5);

  async function handleGenerateWeeklyReport() {
    if (!bpId) return;
    setWeeklyLoading(true);
    try {
      const res  = await base44.functions.invoke('generateWeeklyReport', { businessProfileId: bpId });
      const data = res?.data || res;
      setWeeklyReport(data);
    } catch {
      toast.error('שגיאה ביצירת דוח — נסה שוב');
    }
    setWeeklyLoading(false);
  }

  if (totalData === 0) {
    return (
      <div className="space-y-5">
        <h1 className="text-[16px] font-bold text-foreground tracking-tight">דוחות וניתוח</h1>
        <div className="card-base py-20 text-center">
          <FileBarChart className="w-12 h-12 text-foreground-muted opacity-20 mx-auto mb-3" />
          <p className="text-[13px] text-foreground-muted mb-1">עוד אין מספיק נתונים להצגת דוחות</p>
          <p className="text-[11px] text-foreground-muted opacity-50">הדוחות יופיעו אוטומטית ברגע שהמערכת תאסוף מידע</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5" style={{ direction: 'rtl' }}>
      <h1 className="text-[16px] font-bold text-foreground tracking-tight">דוחות וניתוח</h1>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-medium transition-all ${
              activeTab === t.id
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* ── TAB: Weekly Report ── */}
      {activeTab === 'weekly' && (
        <div className="space-y-4">
          {/* Generate button */}
          {!weeklyReport && (
            <div className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 p-6 text-center">
              <p className="text-[13px] text-gray-600 mb-3">
                דוח AI שבועי — סיכום ביצועים, הדגשת נקודת מפתח ופעולה לשבוע הבא
              </p>
              <button
                onClick={handleGenerateWeeklyReport}
                disabled={weeklyLoading}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-[13px] font-semibold hover:bg-indigo-700 transition-all disabled:opacity-70"
              >
                {weeklyLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                {weeklyLoading ? 'מנתח...' : 'צור דוח שבועי'}
              </button>
            </div>
          )}

          {/* Report result */}
          {weeklyReport && (() => {
            const { report, stats } = weeklyReport;
            return (
              <div className="space-y-3">
                {/* Score + summary */}
                <div className="rounded-2xl border border-gray-100 bg-white px-5 py-4 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[13px] font-bold text-gray-800">סיכום שבועי</p>
                    {report?.score != null && <ScoreBadge score={report.score} />}
                  </div>
                  {report?.summary && (
                    <p className="text-[12px] text-gray-700 leading-relaxed mb-3">{report.summary}</p>
                  )}
                  {report?.score_reason && (
                    <p className="text-[10px] text-gray-400">{report.score_reason}</p>
                  )}
                </div>

                {/* Highlight + next action */}
                <div className="grid grid-cols-1 gap-3">
                  {report?.highlight && (
                    <div className="flex items-start gap-3 rounded-xl bg-green-50 border border-green-100 px-4 py-3">
                      <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[10px] text-green-500 mb-0.5 font-medium">הדגש השבוע</p>
                        <p className="text-[12px] text-green-800">{report.highlight}</p>
                      </div>
                    </div>
                  )}
                  {report?.next_week_action && (
                    <div className="flex items-start gap-3 rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3">
                      <Target className="w-4 h-4 text-indigo-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[10px] text-indigo-500 mb-0.5 font-medium">פעולה לשבוע הבא</p>
                        <p className="text-[12px] text-indigo-800 font-medium">{report.next_week_action}</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Stats grid */}
                {stats && (
                  <div className="grid grid-cols-2 gap-2">
                    <MetricCard label="תובנות השבוע"    value={stats.week_signals}    sub={`${stats.opportunities || 0} הזדמנויות`} color="indigo" />
                    <MetricCard label="לידים השבוע"     value={stats.week_leads}       sub={`${stats.hot_leads || 0} חמים`}          color="green"  />
                    <MetricCard label="אחוז המרה"        value={`${stats.conversion_rate || 0}%`} sub="מסך כל הלידים"              color="amber"  />
                    <MetricCard label="שינויי מתחרים"   value={stats.competitor_changes} sub="אירועים השבוע"                        color="gray"   />
                  </div>
                )}

                {/* Regenerate */}
                <button
                  onClick={handleGenerateWeeklyReport}
                  disabled={weeklyLoading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-[12px] hover:bg-gray-50 transition-all disabled:opacity-50"
                >
                  {weeklyLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '↻'}
                  {weeklyLoading ? 'מחדש...' : 'צור דוח מחדש'}
                </button>
              </div>
            );
          })()}

          {/* Charts */}
          <div className="space-y-4 pt-2">
            <MonthCompareCards signals={signals} leads={leads} reviews={reviews} competitors={competitors} />
            <MonthlyGrowthChart signals={signals} leads={leads} reviews={reviews} />
            <SignalCategoryChart signals={signals} />
          </div>
        </div>
      )}

      {/* ── TAB: Competitors ── */}
      {activeTab === 'competitors' && (
        <div className="space-y-3">
          {competitors.length === 0 ? (
            <div className="text-center py-12 text-[12px] text-gray-400">
              <span className="text-3xl block mb-2">⚔️</span>
              אין מתחרים מזוהים עדיין — הפעל זיהוי מתחרים
            </div>
          ) : (
            <>
              {/* Metric summary */}
              <div className="grid grid-cols-3 gap-2">
                <MetricCard label="מתחרים מזוהים" value={competitors.length} color="indigo" />
                <MetricCard label="מגמת עלייה"    value={competitors.filter(c => c.trend_direction === 'up').length}   sub="מתחרים" color="red"   />
                <MetricCard label="שינויי מתחרים" value={signals.filter(s => s.category === 'competitor_move').length} sub="השבוע"   color="amber" />
              </div>

              {/* Competitor list */}
              <div className="space-y-2">
                {competitors.map((c, i) => (
                  <div key={c.id || i} className="rounded-xl border border-gray-100 bg-white px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-[12px] font-bold text-gray-500">
                        {(c.name || '?')[0]}
                      </div>
                      <div>
                        <p className="text-[12px] font-semibold text-gray-800">{c.name}</p>
                        {c.strengths && (
                          <p className="text-[10px] text-gray-400 truncate max-w-[180px]">{c.strengths}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {c.rating && (
                        <div className="flex items-center gap-0.5">
                          <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                          <span className="text-[11px] font-medium text-gray-700">{c.rating}</span>
                        </div>
                      )}
                      {TREND_ICON[c.trend_direction] || TREND_ICON.stable}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Sentiment chart */}
          <div className="pt-2">
            <SentimentBreakdown reviews={reviews} />
          </div>
        </div>
      )}

      {/* ── TAB: Leads Breakdown ── */}
      {activeTab === 'leads' && (
        <div className="space-y-3">
          {/* Lead status metrics */}
          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="סך לידים"     value={leads.length}   color="indigo" />
            <MetricCard label="לידים חמים"   value={hotLeads}        sub="ממתינים לטיפול" color="red"   />
            <MetricCard label="הושלמו"        value={completedLeads} sub="סגירות מוצלחות" color="green" />
            <MetricCard label="אחוז המרה"    value={`${conversionRate}%`} sub="לידים שהפכו ללקוחות" color="amber" />
          </div>

          {/* Lead sources breakdown */}
          {topSources.length > 0 && (
            <div className="rounded-2xl border border-gray-100 bg-white px-5 py-4">
              <p className="text-[12px] font-bold text-gray-700 mb-3">מקורות לידים</p>
              <div className="space-y-2">
                {topSources.map(([src, count]) => {
                  const pct = Math.round((count / leads.length) * 100);
                  return (
                    <div key={src}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[11px] text-gray-600">{src}</span>
                        <span className="text-[11px] font-semibold text-gray-700">{count} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className="bg-indigo-500 h-1.5 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Status breakdown */}
          <div className="rounded-2xl border border-gray-100 bg-white px-5 py-4">
            <p className="text-[12px] font-bold text-gray-700 mb-3">סטטוס לידים</p>
            {[
              { label: 'חמים',    count: hotLeads,                                              color: 'bg-red-400' },
              { label: 'פעילים',  count: leads.filter(l => l.status === 'active').length,       color: 'bg-indigo-400' },
              { label: 'קרים',    count: coldLeads,                                              color: 'bg-blue-300' },
              { label: 'הושלמו',  count: completedLeads,                                         color: 'bg-green-400' },
              { label: 'אבדו',    count: leads.filter(l => l.status === 'lost').length,          color: 'bg-gray-300' },
            ].filter(s => s.count > 0).map(s => (
              <div key={s.label} className="flex items-center gap-3 mb-2">
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.color}`} />
                <span className="text-[11px] text-gray-600 flex-1">{s.label}</span>
                <span className="text-[11px] font-semibold text-gray-700">{s.count}</span>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div className="pt-2 space-y-4">
            <ConversionFunnel leads={leads} reviews={reviews} />
          </div>
        </div>
      )}
    </div>
  );
}
