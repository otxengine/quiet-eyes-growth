import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from 'recharts';

export const COLORS = { positive: '#10b981', neutral: '#c3c2b7', negative: '#e34948' };
const Y_AXIS_WIDTH = 80;

// recharts doesn't shrink the cursor rect for a right-oriented YAxis, so it
// bleeds into the label column (width=Y_AXIS_WIDTH) and covers the text — clip it.
function RowCursor({ x = 0, y = 0, width = 0, height = 0 }) {
  return <rect x={x} y={y} width={Math.max(width - Y_AXIS_WIDTH, 0)} height={height} fill="#f9fafb" />;
}

function CustomTooltip(props) {
  const { active, payload } = props || {};
  if (!active || !payload?.length) return null;
  const t = payload[0]?.payload;
  if (!t) return null;
  return (
    <div dir="rtl" className="bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-2 text-[11px] space-y-1">
      <div className="font-semibold text-foreground">{t.label}</div>
      <div style={{ color: COLORS.positive }}>חיובי: {t.positive}</div>
      <div className="text-foreground-muted">ניטרלי: {t.neutral}</div>
      <div style={{ color: COLORS.negative }}>שלילי: {t.negative}</div>
      <div className="text-foreground-muted">סה"כ: {t.total}</div>
    </div>
  );
}

export default function TopThemesChart({ topThemes = [], labelById = {} }) {
  const data = topThemes
    .slice(0, 8)
    .map(t => ({
      theme: t.theme,
      label: labelById[t.theme] || t.theme,
      positive: t.positive,
      neutral: t.neutral,
      negative: t.negative,
      total: t.total,
      negPct: (t.negative / t.total) * 100,
      neuPct: (t.neutral / t.total) * 100,
      posPct: (t.positive / t.total) * 100,
      net: (t.positive - t.negative) / t.total,
    }))
    .sort((a, b) => a.net - b.net);

  return (
    <div style={{ height: data.length * 34 + 20 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 32, bottom: 0, left: 0 }}>
          <XAxis type="number" domain={[0, 100]} hide />
          <YAxis
            type="category"
            dataKey="label"
            orientation="right"
            axisLine={false}
            tickLine={false}
            width={Y_AXIS_WIDTH}
            tick={{ fontSize: 12, fill: '#222' }}
          />
          <Tooltip content={<CustomTooltip />} cursor={<RowCursor />} />
          <Bar dataKey="negPct" stackId="s" fill={COLORS.negative} radius={[4, 0, 0, 4]} />
          <Bar dataKey="neuPct" stackId="s" fill={COLORS.neutral} radius={0} />
          <Bar dataKey="posPct" stackId="s" fill={COLORS.positive} radius={[0, 4, 4, 0]}>
            <LabelList dataKey="total" position="right" style={{ fontSize: 10, fill: '#9ca3af' }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
