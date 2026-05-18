import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

/**
 * RatingTrendChart — shows average rating per week over the last 12 weeks.
 * Uses only the reviews already loaded on the page (no extra API call).
 */
export default function RatingTrendChart({ reviews = [] }) {
  const { points, trend, delta, minY, maxY } = useMemo(() => {
    if (reviews.length === 0) return { points: [], trend: 'stable', delta: 0, minY: 1, maxY: 5 };

    // Group by ISO week (Mon-based), last 12 weeks
    const now = Date.now();
    const WEEK = 7 * 24 * 3600 * 1000;
    const weeks = 12;
    const buckets = Array.from({ length: weeks }, (_, i) => ({
      label: i,
      ratings: [],
    }));

    for (const r of reviews) {
      const d = new Date(r.created_at || r.created_date || 0);
      if (isNaN(d.getTime())) continue;
      const weeksAgo = Math.floor((now - d.getTime()) / WEEK);
      if (weeksAgo >= 0 && weeksAgo < weeks) {
        buckets[weeks - 1 - weeksAgo].ratings.push(r.rating || 0);
      }
    }

    const pts = buckets.map((b, i) => {
      if (b.ratings.length === 0) return null;
      const avg = b.ratings.reduce((s, v) => s + v, 0) / b.ratings.length;
      return { x: i, y: avg, count: b.ratings.length };
    });

    // Fill gaps with interpolated or carry-forward values
    const filled = [];
    let lastVal = null;
    for (const p of pts) {
      if (p !== null) { lastVal = p.y; filled.push(p); }
      else if (lastVal !== null) filled.push({ x: pts.indexOf(p), y: lastVal, count: 0, phantom: true });
      else filled.push(null);
    }

    const validPts = filled.filter(Boolean);
    if (validPts.length < 2) return { points: validPts, trend: 'stable', delta: 0, minY: 1, maxY: 5 };

    const first = validPts[0].y;
    const last = validPts[validPts.length - 1].y;
    const delta = +(last - first).toFixed(2);
    const trend = delta > 0.1 ? 'up' : delta < -0.1 ? 'down' : 'stable';

    const ys = validPts.map(p => p.y);
    const minY = Math.max(1, Math.min(...ys) - 0.3);
    const maxY = Math.min(5, Math.max(...ys) + 0.3);

    return { points: validPts, trend, delta, minY, maxY };
  }, [reviews]);

  if (points.length < 2) return null;

  const W = 320, H = 80, padL = 28, padR = 8, padT = 8, padB = 24;
  const iW = W - padL - padR;
  const iH = H - padT - padB;

  const toX = (i) => padL + (i / (points.length - 1)) * iW;
  const toY = (v) => padT + iH - ((v - minY) / (maxY - minY)) * iH;

  const pathD = points
    .filter(Boolean)
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.y).toFixed(1)}`)
    .join(' ');

  const areaD = points.filter(Boolean).length > 0
    ? `${pathD} L ${toX(points.length - 1).toFixed(1)} ${(padT + iH).toFixed(1)} L ${toX(0).toFixed(1)} ${(padT + iH).toFixed(1)} Z`
    : '';

  const color = trend === 'up' ? '#10b981' : trend === 'down' ? '#ef4444' : '#6b7280';
  const lastRating = points[points.length - 1]?.y;

  const yTicks = [Math.ceil(minY * 2) / 2, 3, Math.floor(maxY * 2) / 2].filter(v => v >= minY && v <= maxY);

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-[13px] font-semibold text-foreground">מגמת דירוג — 12 שבועות</h3>
          <p className="text-[10px] text-foreground-muted mt-0.5">ממוצע ביקורות לפי שבוע</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[22px] font-bold" style={{ color }}>
            {lastRating?.toFixed(1)}
          </span>
          <div className="flex flex-col items-center">
            {trend === 'up'   && <TrendingUp className="w-4 h-4" style={{ color }} />}
            {trend === 'down' && <TrendingDown className="w-4 h-4" style={{ color }} />}
            {trend === 'stable' && <Minus className="w-4 h-4 text-gray-400" />}
            <span className="text-[9px]" style={{ color }}>
              {delta > 0 ? '+' : ''}{delta !== 0 ? delta.toFixed(2) : 'יציב'}
            </span>
          </div>
        </div>
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        <defs>
          <linearGradient id="ratingGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.15" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Y-axis gridlines */}
        {yTicks.map(v => (
          <g key={v}>
            <line
              x1={padL} y1={toY(v)} x2={W - padR} y2={toY(v)}
              stroke="#f0f0f0" strokeWidth="1"
            />
            <text x={padL - 4} y={toY(v) + 3.5} textAnchor="end" fontSize="7" fill="#aaa">
              {v.toFixed(1)}
            </text>
          </g>
        ))}

        {/* Area fill */}
        {areaD && <path d={areaD} fill="url(#ratingGrad)" />}

        {/* Line */}
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* Dots for non-phantom points */}
        {points.map((p, i) => p && !p.phantom && (
          <circle key={i} cx={toX(i)} cy={toY(p.y)} r="3" fill={color} stroke="white" strokeWidth="1.5">
            <title>{p.y.toFixed(2)}★ ({p.count} ביקורות)</title>
          </circle>
        ))}

        {/* X-axis week labels — show first, middle, last */}
        {[0, Math.floor(points.length / 2), points.length - 1].map(i => (
          <text key={i} x={toX(i)} y={H - 4} textAnchor="middle" fontSize="7" fill="#bbb">
            {i === points.length - 1 ? 'השבוע' : i === 0 ? `לפני ${points.length} שב'` : ''}
          </text>
        ))}
      </svg>
    </div>
  );
}
