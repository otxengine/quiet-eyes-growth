import React from 'react';
import { Clock, AlertCircle } from 'lucide-react';

/**
 * Shows how fresh data is with visual indicator.
 * dateStr: ISO date string
 * maxAgeHours: number - after which data is considered stale
 */
export default function DataFreshnessBadge({ dateStr, maxAgeHours = 48, label }) {
  if (!dateStr) {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-[#f9f9f9] text-[#999999] border border-[#f0f0f0]">
        <AlertCircle className="w-3 h-3" /> אין נתונים
      </span>
    );
  }

  const ageMs = Date.now() - new Date(dateStr).getTime();
  const ageHours = ageMs / 3600000;

  let color, text;
  if (ageHours < 1) {
    color = 'text-[#10b981] bg-[#f0fdf8] border-[#d1fae5]';
    text = 'עדכני';
  } else if (ageHours < 24) {
    color = 'text-[#10b981] bg-[#f0fdf8] border-[#d1fae5]';
    text = `לפני ${Math.floor(ageHours)} שעות`;
  } else if (ageHours < maxAgeHours) {
    color = 'text-[#d97706] bg-[#fffbeb] border-[#fef3c7]';
    text = `לפני ${Math.floor(ageHours / 24)} ימים`;
  } else {
    color = 'text-[#dc2626] bg-[#fef2f2] border-[#fecaca]';
    text = `מיושן (${Math.floor(ageHours / 24)} ימים)`;
  }

  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${color}`}>
      <Clock className="w-3 h-3" />
      {label && <span>{label}:</span>}
      {text}
    </span>
  );
}