import React, { useState, useEffect } from 'react';

/**
 * LiveStreamCard — Action card for Dashboard "זרם חי"
 * Props:
 *   type        {string}   badge label e.g. "ליד חדש"
 *   typeBg      {string}   badge bg color class
 *   time        {string}   e.g. "לפני 2 דקות"
 *   description {string}
 *   ctaLabel    {string}   e.g. "צפיה ושליחה"
 *   onCta       {function}
 *   timerMinutes {number}  countdown display
 */
export default function LiveStreamCard({ type, typeBg = 'bg-blue-100 text-blue-700', time, description, ctaLabel, onCta, timerMinutes }) {
  const [seconds, setSeconds] = useState((timerMinutes || 2) * 60);

  useEffect(() => {
    const t = setInterval(() => setSeconds(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex flex-col gap-3 min-w-[220px] flex-shrink-0">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${typeBg}`}>{type}</span>
        <span className="text-[10px] text-foreground-muted">{time}</span>
      </div>
      <p className="text-xs text-foreground leading-relaxed line-clamp-2">{description}</p>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono text-foreground-muted bg-gray-50 px-2 py-0.5 rounded">
          {mins}:{String(secs).padStart(2, '0')} ד'
        </span>
        {ctaLabel && (
          <button
            onClick={onCta}
            className="text-xs font-semibold text-white bg-[#e8344d] px-3 py-1 rounded-lg hover:bg-[#c92b40] transition-colors"
          >
            {ctaLabel}
          </button>
        )}
      </div>
    </div>
  );
}
