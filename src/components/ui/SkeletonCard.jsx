import React from 'react';

/**
 * SkeletonCard — animated placeholder while content loads.
 * Replaces spinners for a less jarring loading experience.
 *
 * Props:
 *   lines  — number of text lines to show (default: 3)
 *   height — fixed height in px instead of lines (optional)
 */
export default function SkeletonCard({ lines = 3, height = null, className = '' }) {
  return (
    <div
      className={`rounded-xl border border-border bg-secondary animate-pulse ${className}`}
      style={height ? { height, minHeight: height } : { padding: '14px 16px' }}
    >
      {!height && Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="bg-border rounded mb-2"
          style={{
            height: 12,
            width: i === lines - 1 ? '60%' : i === 0 ? '85%' : '100%',
            marginBottom: i === lines - 1 ? 0 : 10,
          }}
        />
      ))}
    </div>
  );
}

/** Stack of skeleton cards for list-style loading states */
export function SkeletonList({ count = 3, lines = 3 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} lines={lines} />
      ))}
    </div>
  );
}
