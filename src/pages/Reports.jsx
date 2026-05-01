import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { parseLLMJson } from '@/lib/utils';
import { toast } from 'sonner';
import {
  FileBarChart, Loader2, TrendingUp, TrendingDown, Minus,
  Star, Zap, AlertTriangle, CheckCircle, Target, Users, Printer, Download, Calendar,
} from 'lucide-react';

function exportCSV(filename, rows, headers) {
  const escape = v => {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const lines = [headers.join(','), ...rows.map(r => r.map(escape).join(','))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

import MonthCompareCards from '@/components/reports/MonthCompareCards';
import MonthlyGrowthChart from '@/components/reports/MonthlyGrowthChart';
import ConversionFunnel from '@/components/reports/ConversionFunnel';
import SentimentBreakdown from '@/components/reports/SentimentBreakdown';
import SignalCategoryChart from '@/components/reports/SignalCategoryChart';

const TABS = [
  { id: 'weekly',      label: 'שבועי',    icon: '📅' },
  { id: 'monthly',     label: 'חודשי',    icon: '📆' },
  { id: 'competitors', label: 'מתחרים',   icon: '⚔️' },
  { id: 'leads',       label: 'לידים',    icon: '🎯' },
  { id: 'full',        label: 'דוח מלא',  icon: '⭐' },
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
  const [weeklyReport, setWeeklyReport] = useState(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [fullReport, setFullReport] = useState(null);
  const [fullLoading, setFullLoading] = useState(false);
  const [monthlyReport, setMonthlyReport] = useState(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  // Date range filter — defaults to last 30 days
  const defaultTo = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo,   setDateTo]   = useState(defaultTo);

  const { data: signals = [] }     = useQuery({ queryKey: ['reportSignals', bpId],     queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId }, '-detected_at', 200), enabled: !!bpId });
  const { data: leads = [] }       = useQuery({ queryKey: ['reportLeads', bpId],       queryFn: () => base44.entities.Lead.filter({ linked_business: bpId }, '-created_date', 200), enabled: !!bpId });
  const { data: reviews = [] }     = useQuery({ queryKey: ['reportReviews', bpId],     queryFn: () => base44.entities.Review.filter({ linked_business: bpId }, '-created_date', 200), enabled: !!bpId });
  const { data: competitors = [] } = useQuery({ queryKey: ['reportCompetitors', bpId], queryFn: () => base44.entities.Competitor.filter({ linked_business: bpId }), enabled: !!bpId });

  // Date-filtered data for date-sensitive tabs
  const fromMs = new Date(dateFrom).getTime();
  const toMs   = new Date(dateTo + 'T23:59:59').getTime();
  const inRange = (isoStr) => { if (!isoStr) return true; const t = new Date(isoStr).getTime(); return t >= fromMs && t <= toMs; };
  const filteredLeads   = leads.filter(l  => inRange(l.created_date  || l.discovered_at));
  const filteredReviews = reviews.filter(r => inRange(r.created_date || r.review_date));
  const filteredSignals = signals.filter(s => inRange(s.detected_at  || s.created_date));

  const totalData = signals.length + leads.length + reviews.length;

  // Client-side lead stats — use filtered data when in leads tab, full data otherwise
  const displayLeads   = filteredLeads;
  const hotLeads       = displayLeads.filter(l => l.status === 'hot').length;
  const completedLeads = displayLeads.filter(l => l.status === 'completed').length;
  const coldLeads      = displayLeads.filter(l => l.status === 'cold').length;
  const conversionRate = displayLeads.length > 0 ? Math.round((completedLeads / displayLeads.length) * 100) : 0;
  const leadSources = displayLeads.reduce((acc, l) => {
    const src = l.source || 'אחר';
    acc[src] = (acc[src] || 0) + 1;
    return acc;
  }, {});
  const topSources = Object.entries(leadSources).sort((a, b) => b[1] - a[1]).slice(0, 5);

  async function handleGenerateMonthlyReport() {
    if (!bpId || monthlyLoading) return;
    setMonthlyLoading(true);
    try {
      const now = new Date();
      const monthName = now.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthLeads   = leads.filter(l  => new Date(l.created_date  || l.discovered_at || 0) >= new Date(monthStart));
      const monthReviews = reviews.filter(r => new Date(r.created_date || r.review_date   || 0) >= new Date(monthStart));
      const monthSignals = signals.filter(s => new Date(s.detected_at  || s.created_date  || 0) >= new Date(monthStart));
      const hotMonthLeads = monthLeads.filter(l => l.status === 'hot').length;
      const avgRating = monthReviews.length ? (monthReviews.reduce((s, r) => s + (r.rating || 0), 0) / monthReviews.length).toFixed(1) : null;
      const topSignal = monthSignals.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];

      const res = await base44.functions.invoke('invokeLLM', {
        model: 'haiku',
        response_json_schema: { type: 'object' },
        prompt: `אתה יועץ עסקי. צור דוח חודשי לחודש ${monthName} עבור העסק "${businessProfile?.name}" (${businessProfile?.category}, ${businessProfile?.city}).
נתוני החודש: לידים: ${monthLeads.length} (${hotMonthLeads} חמים), ביקורות: ${monthReviews.length}${avgRating ? ` (ממוצע ${avgRating})` : ''}, תובנות שוק: ${monthSignals.length}, מתחרים מזוהים: ${competitors.length}.
${topSignal ? `תובנה בולטת: ${topSignal.summary}` : ''}
JSON בלבד:
{
  "month_name": "${monthName}",
  "summary": "סיכום 2-3 משפטים לחודש",
  "highlights": ["הדגש 1 עם נתון", "הדגש 2"],
  "improvement": "תחום אחד לשיפור בחודש הבא",
  "next_action": "הפעולה האחת הכי חשובה לחודש הבא",
  "score": 7
}`,
      });
      const parsed = parseLLMJson(res?.data || res);
      setMonthlyReport({ ...parsed, _stats: { leads: monthLeads.length, hotLeads: hotMonthLeads, reviews: monthReviews.length, signals: monthSignals.length, avgRating } });
    } catch {
      toast.error('שגיאה ביצירת דוח חודשי');
    }
    setMonthlyLoading(false);
  }

  useEffect(() => {
    if (activeTab === 'monthly' && !monthlyReport && !monthlyLoading) {
      handleGenerateMonthlyReport();
    }
  }, [activeTab]);

  async function handleGenerateFullReport() {
    if (!bpId) return;
    setFullLoading(true);
    try {
      const positiveReviews = reviews.filter(r => r.sentiment === 'positive').length;
      const negativeReviews = reviews.filter(r => r.sentiment === 'negative').length;

      // Fetch social engagement data
      let posts = [], campaigns = [];
      try {
        [posts, campaigns] = await Promise.all([
          base44.entities.OrganicPost.filter({ linked_business: bpId }, null, 50),
          base44.entities.Campaign.filter({ linked_business: bpId }, null, 20),
        ]);
      } catch (_) {}
      const totalLikes    = posts.reduce((s, p) => s + (p.engagement_likes || 0), 0);
      const totalComments = posts.reduce((s, p) => s + (p.engagement_comments || 0), 0);
      const totalReach    = posts.reduce((s, p) => s + (p.reach || 0), 0);
      const socialContext = posts.length > 0
        ? `פעילות ברשתות חברתיות: ${posts.length} פוסטים, ${totalLikes} לייקים, ${totalComments} תגובות, ${totalReach} חשיפות.`
        : '';

      const res = await base44.integrations.Core.InvokeLLM({
        model: 'haiku',
        prompt: `אתה יועץ עסקי בכיר. הפק דוח ביצועים מקיף שיגרום למשתמש להרגיש ערך אמיתי מהמערכת.
עסק: "${businessProfile?.name}" (${businessProfile?.category}, ${businessProfile?.city}).
נתונים: לידים: ${leads.length} (${hotLeads} חמים, ${completedLeads} הושלמו, המרה: ${conversionRate}%), ביקורות: ${reviews.length} (${positiveReviews} חיוביות, ${negativeReviews} שליליות), מתחרים: ${competitors.length}, תובנות שוק: ${signals.length}. ${socialContext}

JSON בלבד:
{
  "executive_summary": "סיכום מנהלים 3-4 משפטים עם נתונים ספציפיים",
  "health_score": 7,
  "roi_estimate": "₪12,000",
  "roi_reasoning": "הסבר קצר לאומדן",
  "social_insight": "תובנה 1-2 משפטים על הפעילות ברשתות חברתיות ומה ניתן לשפר",
  "top_wins": ["הישג 1 עם נתון ספציפי", "הישג 2", "הישג 3"],
  "improvement_areas": ["שיפור 1", "שיפור 2"],
  "recommendation": "ההמלצה החשובה ביותר לחודש הבא"
}`,
      });
      const parsed = parseLLMJson(res);
      setFullReport({ ...parsed, _social: { posts: posts.length, likes: totalLikes, comments: totalComments, reach: totalReach } });
    } catch {
      toast.error('שגיאה ביצירת דוח — נסה שוב');
    }
    setFullLoading(false);
  }

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
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex-shrink-0 flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-[11px] font-medium transition-all ${
              activeTab === t.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Date range filter — shown for leads/competitors/full tabs */}
      {['leads', 'competitors', 'full'].includes(activeTab) && (
        <div className="flex items-center gap-2 flex-wrap">
          <Calendar className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          <span className="text-[11px] text-gray-500">מ:</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:border-indigo-400" />
          <span className="text-[11px] text-gray-500">עד:</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:border-indigo-400" />
          <button onClick={() => { setDateFrom(defaultFrom); setDateTo(defaultTo); }}
            className="text-[10px] text-indigo-500 hover:underline">אפס</button>
        </div>
      )}

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

      {/* ── TAB: Monthly Report ── */}
      {activeTab === 'monthly' && (
        <div className="space-y-4">
          {monthlyLoading && !monthlyReport ? (
            <div className="flex items-center justify-center py-16 gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
              <span className="text-[13px] text-gray-500">מייצר דוח חודשי...</span>
            </div>
          ) : !monthlyReport ? (
            <div className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 p-6 text-center">
              <button onClick={handleGenerateMonthlyReport} disabled={monthlyLoading}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-[13px] font-semibold hover:bg-indigo-700 transition-all disabled:opacity-70">
                {monthlyLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                {monthlyLoading ? 'מייצר...' : 'צור דוח חודשי'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[15px] font-bold text-gray-800">{monthlyReport.month_name}</p>
                  {monthlyReport.score != null && <ScoreBadge score={monthlyReport.score} />}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => {
                    exportCSV(`דוח-חודשי-${monthlyReport.month_name}.csv`,
                      [['לידים', 'לידים חמים', 'ביקורות', 'ממוצע דירוג', 'תובנות'],
                       [monthlyReport._stats.leads, monthlyReport._stats.hotLeads, monthlyReport._stats.reviews, monthlyReport._stats.avgRating || '', monthlyReport._stats.signals]],
                      ['מדד', 'ערך']);
                  }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-[11px] text-gray-500 hover:bg-gray-50 transition-colors">
                    <Download className="w-3.5 h-3.5" /> ייצא CSV
                  </button>
                  <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-[11px] text-gray-500 hover:bg-gray-50 transition-colors">
                    <Printer className="w-3.5 h-3.5" /> הדפס
                  </button>
                </div>
              </div>

              {/* Stats grid */}
              {monthlyReport._stats && (
                <div className="grid grid-cols-2 gap-2">
                  <MetricCard label="לידים החודש"  value={monthlyReport._stats.leads}    sub={`${monthlyReport._stats.hotLeads} חמים`} color="indigo" />
                  <MetricCard label="ביקורות"       value={monthlyReport._stats.reviews}  sub={monthlyReport._stats.avgRating ? `ממוצע ${monthlyReport._stats.avgRating}` : undefined} color="green" />
                  <MetricCard label="תובנות שוק"   value={monthlyReport._stats.signals}  color="amber" />
                  <MetricCard label="מתחרים"        value={competitors.length}            sub="מזוהים" color="gray" />
                </div>
              )}

              {/* Summary */}
              {monthlyReport.summary && (
                <div className="rounded-xl border border-gray-100 bg-white px-5 py-4">
                  <p className="text-[10px] text-gray-400 mb-1 font-medium uppercase tracking-wide">סיכום חודשי</p>
                  <p className="text-[12px] text-gray-700 leading-relaxed">{monthlyReport.summary}</p>
                </div>
              )}

              {/* Highlights */}
              {monthlyReport.highlights?.length > 0 && (
                <div className="rounded-xl border border-green-100 bg-green-50/50 px-5 py-4">
                  <p className="text-[12px] font-bold text-green-700 mb-2.5">הדגשי החודש</p>
                  <div className="space-y-1.5">
                    {monthlyReport.highlights.map((h, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                        <p className="text-[11px] text-green-800">{h}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Improvement + next action */}
              {monthlyReport.improvement && (
                <div className="rounded-xl border border-amber-100 bg-amber-50/50 px-5 py-4">
                  <p className="text-[10px] text-amber-500 font-medium mb-0.5">לשיפור</p>
                  <p className="text-[12px] text-amber-800">{monthlyReport.improvement}</p>
                </div>
              )}
              {monthlyReport.next_action && (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-5 py-4">
                  <p className="text-[10px] text-indigo-400 font-medium mb-0.5">פעולה לחודש הבא</p>
                  <p className="text-[13px] text-indigo-800 font-semibold">{monthlyReport.next_action}</p>
                </div>
              )}

              <button onClick={() => { setMonthlyReport(null); handleGenerateMonthlyReport(); }} disabled={monthlyLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-[12px] hover:bg-gray-50 transition-all disabled:opacity-50">
                {monthlyLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '↻'}
                {monthlyLoading ? 'מחדש...' : 'צור דוח מחדש'}
              </button>
            </div>
          )}
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
          {/* Export button */}
          <div className="flex justify-end">
            <button onClick={() => exportCSV('לידים.csv',
              displayLeads.map(l => [l.name || '', l.score || '', l.source || '', l.status || '', l.service_needed || '', l.created_date || l.discovered_at || '']),
              ['שם', 'ציון', 'מקור', 'סטטוס', 'שירות', 'תאריך'])}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-[11px] text-gray-500 hover:bg-gray-50 transition-colors">
              <Download className="w-3.5 h-3.5" /> ייצא CSV ({displayLeads.length})
            </button>
          </div>
          {/* Lead status metrics */}
          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="סך לידים"     value={displayLeads.length} color="indigo" />
            <MetricCard label="לידים חמים"   value={hotLeads}             sub="ממתינים לטיפול" color="red"   />
            <MetricCard label="הושלמו"        value={completedLeads}      sub="סגירות מוצלחות" color="green" />
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
              { label: 'חמים',    count: hotLeads,                                                       color: 'bg-red-400' },
              { label: 'פעילים',  count: displayLeads.filter(l => l.status === 'active').length,   color: 'bg-indigo-400' },
              { label: 'קרים',    count: coldLeads,                                                  color: 'bg-blue-300' },
              { label: 'הושלמו',  count: completedLeads,                                             color: 'bg-green-400' },
              { label: 'אבדו',    count: displayLeads.filter(l => l.status === 'lost').length,       color: 'bg-gray-300' },
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
            <ConversionFunnel leads={displayLeads} reviews={filteredReviews} />
          </div>
        </div>
      )}

      {/* ── TAB: Full Report ── */}
      {activeTab === 'full' && (
        <div className="space-y-4">
          {!fullReport ? (
            <div className="rounded-2xl border border-dashed border-purple-200 bg-purple-50/40 p-8 text-center">
              <p className="text-[14px] font-semibold text-gray-700 mb-1">דוח ביצועים מלא</p>
              <p className="text-[11px] text-gray-400 mb-5">לידים · ביקורות · מתחרים · הכנסות משוערות · המלצות</p>
              <button onClick={handleGenerateFullReport} disabled={fullLoading}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-purple-600 text-white rounded-xl text-[13px] font-semibold hover:bg-purple-700 transition-all disabled:opacity-70">
                {fullLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : '⭐'}
                {fullLoading ? 'מנתח...' : 'צור דוח מלא'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Header + print */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-[15px] font-bold text-gray-800">{businessProfile?.name}</span>
                  {fullReport.health_score != null && <ScoreBadge score={fullReport.health_score} />}
                </div>
                <button onClick={() => {
                  exportCSV('דוח-מלא.csv',
                    [['לידים', leads.length], ['לידים חמים', hotLeads], ['אחוז המרה', `${conversionRate}%`], ['ביקורות', reviews.length], ['מתחרים', competitors.length], ['ציון בריאות', fullReport.health_score ?? ''], ['הכנסה משוערת', fullReport.roi_estimate ?? '']],
                    ['מדד', 'ערך']);
                }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-[11px] text-gray-500 hover:bg-gray-50 transition-colors">
                  <Download className="w-3.5 h-3.5" /> ייצא CSV
                </button>
                <button onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-[11px] text-gray-500 hover:bg-gray-50 transition-colors">
                  <Printer className="w-3.5 h-3.5" /> הדפס
                </button>
              </div>

              {/* Executive summary */}
              {fullReport.executive_summary && (
                <div className="rounded-xl border border-gray-100 bg-white px-5 py-4">
                  <p className="text-[10px] text-gray-400 mb-1 font-medium uppercase tracking-wide">סיכום מנהלים</p>
                  <p className="text-[12px] text-gray-700 leading-relaxed">{fullReport.executive_summary}</p>
                </div>
              )}

              {/* ROI */}
              {fullReport.roi_estimate && (
                <div className="rounded-xl bg-green-50 border border-green-100 px-5 py-4">
                  <p className="text-[10px] text-green-500 font-medium mb-0.5">הכנסה משוערת מהמערכת</p>
                  <p className="text-[26px] font-bold text-green-700 leading-none">{fullReport.roi_estimate}</p>
                  {fullReport.roi_reasoning && <p className="text-[11px] text-green-600 mt-1">{fullReport.roi_reasoning}</p>}
                </div>
              )}

              {/* Metrics grid */}
              <div className="grid grid-cols-2 gap-2">
                <MetricCard label="סך לידים"    value={leads.length}      sub={`${hotLeads} חמים`}             color="indigo" />
                <MetricCard label="ביקורות"      value={reviews.length}    sub={`${reviews.filter(r=>r.sentiment==='positive').length} חיוביות`} color="green" />
                <MetricCard label="אחוז המרה"    value={`${conversionRate}%`} sub="לידים שנסגרו"              color="amber" />
                <MetricCard label="מתחרים"       value={competitors.length} sub="מזוהים"                       color="gray" />
              </div>

              {/* Social engagement */}
              {fullReport._social && (
                <div className="rounded-xl border border-blue-100 bg-blue-50/40 px-5 py-4">
                  <p className="text-[12px] font-bold text-blue-700 mb-3">פעילות ברשתות חברתיות</p>
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    <MetricCard label="פוסטים"   value={fullReport._social.posts}    color="indigo" />
                    <MetricCard label="לייקים"    value={fullReport._social.likes}    color="indigo" />
                    <MetricCard label="תגובות"    value={fullReport._social.comments} color="indigo" />
                    <MetricCard label="חשיפות"    value={fullReport._social.reach}    color="indigo" />
                  </div>
                  {fullReport.social_insight && (
                    <p className="text-[11px] text-blue-700 leading-relaxed">{fullReport.social_insight}</p>
                  )}
                </div>
              )}

              {/* Top wins */}
              {fullReport.top_wins?.length > 0 && (
                <div className="rounded-xl border border-gray-100 bg-white px-5 py-4">
                  <p className="text-[12px] font-bold text-gray-700 mb-2.5">הישגים מרכזיים</p>
                  <div className="space-y-1.5">
                    {fullReport.top_wins.map((w, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                        <p className="text-[11px] text-gray-600">{w}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Improvement areas */}
              {fullReport.improvement_areas?.length > 0 && (
                <div className="rounded-xl border border-amber-100 bg-amber-50/50 px-5 py-4">
                  <p className="text-[12px] font-bold text-amber-700 mb-2.5">תחומים לשיפור</p>
                  <div className="space-y-1.5">
                    {fullReport.improvement_areas.map((a, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                        <p className="text-[11px] text-amber-700">{a}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top recommendation */}
              {fullReport.recommendation && (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-5 py-4">
                  <p className="text-[10px] text-indigo-400 font-medium mb-1">המלצה מרכזית לחודש הבא</p>
                  <p className="text-[13px] text-indigo-800 font-semibold">{fullReport.recommendation}</p>
                </div>
              )}

              <button onClick={handleGenerateFullReport} disabled={fullLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-[12px] hover:bg-gray-50 transition-all disabled:opacity-50">
                {fullLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '↻'}
                {fullLoading ? 'מחדש...' : 'צור דוח מחדש'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
