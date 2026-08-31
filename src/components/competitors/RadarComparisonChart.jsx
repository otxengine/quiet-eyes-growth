import { RadarChart, PolarGrid, PolarAngleAxis, Radar, Legend, Tooltip, ResponsiveContainer } from 'recharts';

// Validated categorical pair (dataviz skill, slots 1+2 of the fixed hue order):
// worst-case CVD ΔE 24.7 / normal-vision ΔE 33.6 on white — both well clear of
// the safety floors. Blue also matches the "own" highlight color already used
// elsewhere in this app (e.g. the comparison table's own-row styling).
export const RADAR_OWN_COLOR = '#2a78d6';
export const RADAR_COMPETITOR_COLOR = '#eb6834';

// "Grid only" style: concentric rings with no radial spoke lines (polarAngles={[]})
// and no radius-axis numbers, so the two overlapping shapes read at a glance
// without a wall of gridlines competing for attention.
export default function RadarComparisonChart({
  title, subtitle, data, ownLabel = 'העסק שלי', competitorsLabel = 'ממוצע מתחרים',
  captionText = 'כל ציר מנורמל בנפרד: 100% = הצד הגבוה יותר באותו נושא',
}) {
  if (data.length < 3) return null;
  return (
    <div className="card-base p-4">
      <h3 className="text-[13px] font-semibold text-[#222222] mb-1">{title}</h3>
      <p className="text-[10px] text-foreground-muted">{subtitle}</p>
      {captionText && <p className="text-[10px] text-foreground-muted mb-2">{captionText}</p>}
      <div className="h-[280px]" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="70%">
            <PolarGrid polarAngles={[]} stroke="#e5e7eb" />
            <PolarAngleAxis dataKey="topic" tick={{ fontSize: 10, fill: '#666' }} axisLine={false} />
            <Radar name={ownLabel} dataKey="own" stroke={RADAR_OWN_COLOR} fill={RADAR_OWN_COLOR} fillOpacity={0.12} strokeWidth={2} />
            <Radar name={competitorsLabel} dataKey="competitors" stroke={RADAR_COMPETITOR_COLOR} fill={RADAR_COMPETITOR_COLOR} fillOpacity={0.12} strokeWidth={2} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #f0f0f0' }}
              formatter={(v, name) => [`${v}%`, name]}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Normalizes an own-value/competitor-avg-value pair per topic to 0-100 against
// the larger of the two, so metrics on wildly different scales (followers in
// the thousands vs. post counts in single digits) plot on one shared axis.
export function normalizeRadarTopics(topics, ownValues, competitorAvgValues) {
  return topics.map(topic => {
    const ownVal = ownValues[topic.key];
    const compVal = competitorAvgValues[topic.key];
    if (ownVal == null || compVal == null) return null;
    const max = Math.max(ownVal, compVal) || 1;
    return {
      topic: topic.label,
      own: Math.round((ownVal / max) * 100),
      competitors: Math.round((compVal / max) * 100),
    };
  }).filter(Boolean);
}
