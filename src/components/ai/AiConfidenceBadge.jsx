import React from 'react';
import { ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react';

/**
 * Shows an AI confidence indicator badge.
 * confidence: 0-100 or null
 * source: string describing where the data came from
 */
export default function AiConfidenceBadge({ confidence, source, compact = false }) {
  if (confidence === null || confidence === undefined) return null;

  let color, icon, label;
  if (confidence >= 80) {
    color = 'text-[#10b981] bg-[#f0fdf8] border-[#d1fae5]';
    icon = <ShieldCheck className="w-3 h-3" />;
    label = 'ביטחון גבוה';
  } else if (confidence >= 50) {
    color = 'text-[#d97706] bg-[#fffbeb] border-[#fef3c7]';
    icon = <ShieldAlert className="w-3 h-3" />;
    label = 'ביטחון בינוני';
  } else {
    color = 'text-[#dc2626] bg-[#fef2f2] border-[#fecaca]';
    icon = <AlertTriangle className="w-3 h-3" />;
    label = 'ביטחון נמוך — יש לאמת';
  }

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${color}`}>
        {icon} {confidence}%
      </span>
    );
  }

  return (
    <div className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-md border ${color}`}>
      {icon}
      <span>{label} ({confidence}%)</span>
      {source && <span className="opacity-60">· {source}</span>}
    </div>
  );
}