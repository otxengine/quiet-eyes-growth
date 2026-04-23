import React from 'react';

export default function WeeklyScoreRing({ score = null, size = 80 }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;

  // FIX 3: null means no data yet — show empty ring with "—"
  const hasData = score !== null && score !== undefined;
  const percentage = hasData ? Math.min(score / 10, 1) : 0;
  const offset = circumference * (1 - percentage);
  const color = !hasData ? '#d1d5db' : score > 7 ? '#10b981' : score >= 5 ? '#d97706' : '#dc2626';

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="#f0f0f0" strokeWidth="4" />
        <circle
          cx={size/2} cy={size/2} r={radius} fill="none"
          stroke={color} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {hasData ? (
          <>
            <span className="text-[20px] font-bold leading-none" style={{ color }}>{score.toFixed(1)}</span>
            <span className="text-[8px] text-foreground-muted">/10</span>
          </>
        ) : (
          <span className="text-[14px] font-medium text-foreground-muted">—</span>
        )}
      </div>
    </div>
  );
}