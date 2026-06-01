import React from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Clock, TrendingUp, Calendar, Loader2, Info } from 'lucide-react';

const DAY_LABEL = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

function HourBadge({ hour, label }) {
  return (
    <div className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2">
      <Clock className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
      <div>
        <p className="text-[13px] font-bold text-indigo-700">{String(hour).padStart(2, '0')}:00</p>
        {label && <p className="text-[9px] text-indigo-400">{label}</p>}
      </div>
    </div>
  );
}

function DayBar({ day, day_short, count, max }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  const isActive = pct >= 60;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-full flex items-end justify-center" style={{ height: 48 }}>
        <div
          className={`w-full rounded-t transition-all ${isActive ? 'bg-indigo-500' : 'bg-indigo-100'}`}
          style={{ height: `${Math.max(pct, 4)}%` }}
          title={`${day}: ${count} לידים`}
        />
      </div>
      <span className={`text-[10px] font-medium ${isActive ? 'text-indigo-600' : 'text-gray-400'}`}>{day_short}</span>
      {count > 0 && <span className="text-[9px] text-gray-300">{count}</span>}
    </div>
  );
}

export default function SmartSchedulerPanel({ businessProfileId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['smartScheduler', businessProfileId],
    queryFn: () =>
      base44.functions.invoke('smartScheduler', { businessProfileId }).then(r => r?.data || r),
    enabled: !!businessProfileId,
    staleTime: 30 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white px-5 py-6 shadow-sm flex items-center justify-center gap-3">
        <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
        <span className="text-[12px] text-gray-400">מנתח דפוסי פעילות...</span>
      </div>
    );
  }

  if (!data) return null;

  const {
    has_data, peak_lead_hours = [], peak_review_hours = [],
    recommended_windows = [], day_of_week_distribution = [],
    scan_stats = {}, peak_day,
  } = data;

  const maxDayCount = Math.max(...day_of_week_distribution.map(d => d.count), 1);

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-indigo-500" />
          <span className="text-[13px] font-bold text-gray-800">תזמון חכם</span>
        </div>
        {!has_data && (
          <span className="flex items-center gap-1 text-[10px] text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full">
            <Info className="w-3 h-3" /> נתונים מוגבלים
          </span>
        )}
      </div>

      <div className="px-5 py-4 space-y-5">
        {/* Recommended scan windows */}
        {recommended_windows.length > 0 && (
          <div>
            <p className="text-[10px] text-gray-400 mb-2 font-medium">חלונות סריקה מומלצים</p>
            <div className="flex gap-2 flex-wrap">
              {recommended_windows.map((w, i) => (
                <div key={i} className="flex-1 min-w-[140px] bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Clock className="w-3.5 h-3.5 text-indigo-500" />
                    <span className="text-[14px] font-bold text-indigo-700">{w.label}</span>
                  </div>
                  <p className="text-[10px] text-indigo-500">{w.reason}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Peak hours */}
        <div className="grid grid-cols-2 gap-3">
          {peak_lead_hours.length > 0 && (
            <div>
              <p className="text-[10px] text-gray-400 mb-2">שיא לידים (שעה)</p>
              <div className="flex flex-wrap gap-1.5">
                {peak_lead_hours.map(h => (
                  <HourBadge key={h} hour={h} />
                ))}
              </div>
            </div>
          )}
          {peak_review_hours.length > 0 && (
            <div>
              <p className="text-[10px] text-gray-400 mb-2">שיא ביקורות (שעה)</p>
              <div className="flex flex-wrap gap-1.5">
                {peak_review_hours.map(h => (
                  <HourBadge key={h} hour={h} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Day of week chart */}
        {day_of_week_distribution.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] text-gray-400 font-medium">פילוח לידים לפי יום</p>
              {peak_day && (
                <span className="text-[10px] text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">יום {peak_day} — שיא</span>
              )}
            </div>
            <div className="flex items-end gap-1.5" style={{ height: 64 }}>
              {day_of_week_distribution.map((d, i) => (
                <DayBar key={i} {...d} max={maxDayCount} />
              ))}
            </div>
          </div>
        )}

        {/* Scan stats */}
        {scan_stats.total_scans > 0 && (
          <div className="bg-gray-50 rounded-xl px-3 py-2.5">
            <p className="text-[10px] text-gray-400 mb-1.5 font-medium">סטטיסטיקת סריקות</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[13px] font-bold text-gray-700">{scan_stats.total_scans}</p>
                <p className="text-[9px] text-gray-400">סריקות</p>
              </div>
              <div>
                <p className="text-[13px] font-bold text-gray-700">{scan_stats.avg_interval_hours ?? '—'}h</p>
                <p className="text-[9px] text-gray-400">מרווח ממוצע</p>
              </div>
              <div>
                <p className="text-[13px] font-bold text-gray-700">{scan_stats.hours_since_last_scan != null ? `${scan_stats.hours_since_last_scan}h` : '—'}</p>
                <p className="text-[9px] text-gray-400">מסריקה אחרונה</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
