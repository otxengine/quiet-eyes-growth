import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Zap, DollarSign, Target, Loader2, RefreshCw } from 'lucide-react';

function StatBox({ label, value, sub, color = 'indigo' }) {
  const colors = {
    indigo: 'bg-indigo-50 border-indigo-100 text-indigo-700',
    green:  'bg-green-50  border-green-100  text-green-700',
    amber:  'bg-amber-50  border-amber-100  text-amber-700',
    gray:   'bg-gray-50   border-gray-100   text-gray-700',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${colors[color]}`}>
      <p className="text-[10px] text-gray-400 mb-0.5">{label}</p>
      <p className={`text-[18px] font-bold`}>{value ?? '—'}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function MonthBar({ month, total, system, max }) {
  const totalPct  = max > 0 ? Math.round((total  / max) * 100) : 0;
  const systemPct = max > 0 ? Math.round((system / max) * 100) : 0;
  return (
    <div className="flex items-end gap-1 flex-col w-full">
      <div className="w-full flex items-end gap-1" style={{ height: 60 }}>
        <div className="flex-1 flex items-end gap-0.5 h-full">
          <div
            className="flex-1 rounded-t bg-indigo-200"
            style={{ height: `${totalPct}%`, minHeight: totalPct > 0 ? 4 : 0 }}
            title={`סה"כ: ₪${total.toLocaleString()}`}
          />
          <div
            className="flex-1 rounded-t bg-indigo-500"
            style={{ height: `${systemPct}%`, minHeight: systemPct > 0 ? 4 : 0 }}
            title={`מיוחס מערכת: ₪${system.toLocaleString()}`}
          />
        </div>
      </div>
      <span className="text-[9px] text-gray-400 text-center w-full">{month}</span>
    </div>
  );
}

export default function ROICard({ businessProfileId }) {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['calculateROI', businessProfileId],
    queryFn: () =>
      base44.functions.invoke('calculateROI', { businessProfileId }).then(r => r?.data || r),
    enabled: !!businessProfileId,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white px-5 py-8 shadow-sm flex items-center justify-center gap-3">
        <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
        <span className="text-[12px] text-gray-400">מחשב ROI...</span>
      </div>
    );
  }

  if (!data?.summary) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white px-5 py-6 shadow-sm text-center">
        <DollarSign className="w-8 h-8 text-gray-200 mx-auto mb-2" />
        <p className="text-[12px] text-gray-400">אין עדיין נתוני ROI</p>
        <p className="text-[10px] text-gray-300 mt-1">ה-ROI מחושב לאחר סגירת עסקאות ראשונות</p>
      </div>
    );
  }

  const { summary, monthly_breakdown = [] } = data;
  const maxMonthTotal = Math.max(...monthly_breakdown.map(m => m.total), 1);

  const roiColor = summary.roi_percent >= 100 ? 'text-green-600' : summary.roi_percent >= 30 ? 'text-amber-600' : 'text-red-500';

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-indigo-500" />
          <span className="text-[13px] font-bold text-gray-800">ROI — תשואה על השקעה</span>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          title="רענן"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-gray-400 ${isRefetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* ROI hero number */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-gray-400 mb-1">ROI מוערך</p>
            <p className={`text-[32px] font-black ${roiColor}`}>{summary.roi_percent}%</p>
            {summary.payback_days && (
              <p className="text-[10px] text-gray-400">החזר השקעה תוך ~{summary.payback_days} ימים</p>
            )}
          </div>
          <div className="text-left">
            <p className="text-[10px] text-gray-400 mb-1">השפעת הכנסה</p>
            <p className="text-[20px] font-bold text-gray-800">₪{summary.total_system_impact.toLocaleString()}</p>
            <p className="text-[10px] text-gray-400">עלות חודשית: ₪{summary.subscription_cost_monthly}</p>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2">
          <StatBox label="הכנסה מיוחסת מערכת" value={`₪${summary.system_attributed_revenue.toLocaleString()}`} color="green" />
          <StatBox label="הכנסה מ-AutoActions"  value={`₪${summary.auto_action_revenue.toLocaleString()}`}       color="indigo" />
          <StatBox label="לידים שנסגרו"         value={summary.closed_leads}  sub={`מתוך ${summary.total_leads}`} color="amber" />
          <StatBox label="ייחוס מערכת"           value={`${summary.attribution_rate}%`} sub="מסך הלידים"         color="gray" />
        </div>

        {/* Monthly chart */}
        {monthly_breakdown.length > 0 && (
          <div>
            <p className="text-[10px] text-gray-400 mb-2">פילוח חודשי (6 חודשים אחרונים)</p>
            <div className="flex items-end gap-1.5" style={{ height: 80 }}>
              {monthly_breakdown.map((m, i) => (
                <MonthBar key={i} month={m.month} total={m.total} system={m.system} max={maxMonthTotal} />
              ))}
            </div>
            <div className="flex items-center gap-3 mt-2">
              <span className="flex items-center gap-1 text-[9px] text-gray-400"><span className="w-2 h-2 rounded-sm bg-indigo-200 inline-block" /> סה"כ הכנסה</span>
              <span className="flex items-center gap-1 text-[9px] text-gray-400"><span className="w-2 h-2 rounded-sm bg-indigo-500 inline-block" /> מיוחס מערכת</span>
            </div>
          </div>
        )}

        {/* Toggle details */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full text-[11px] text-indigo-500 hover:text-indigo-700 py-1"
        >
          {expanded ? 'הסתר פרטים ▲' : 'פרטים נוספים ▼'}
        </button>

        {expanded && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <StatBox label="ממוצע עסקה"       value={`₪${summary.avg_deal_size}`}       color="gray" />
            <StatBox label="שיעור המרה"         value={`${summary.conversion_rate}%`}      color="indigo" />
            <StatBox label="לידים ממערכת"       value={summary.system_leads}               color="green" />
            <StatBox label={'סה"כ הכנסה (כל הזמן)'} value={`₪${summary.total_revenue.toLocaleString()}`} color="amber" />
          </div>
        )}
      </div>
    </div>
  );
}
