import { BarChart, Bar, XAxis, YAxis, ReferenceLine, Tooltip, ResponsiveContainer } from 'recharts';

const COLORS = { positive: '#4ade80', neutral: '#fcd34d', negative: '#fb7185' };
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
      <div className="text-green-600">חיובי: {t.positive}</div>
      <div className="text-amber-600">ניטרלי: {t.neutral}</div>
      <div className="text-rose-600">שלילי: {t.negative}</div>
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
      neg: -(t.negative / t.total) * 100,
      neuLeft: -(t.neutral / t.total / 2) * 100,
      neuRight: (t.neutral / t.total / 2) * 100,
      pos: (t.positive / t.total) * 100,
      net: (t.positive - t.negative) / t.total,
    }))
    .sort((a, b) => a.net - b.net);

  return (
    <div style={{ height: data.length * 34 + 20 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
          <XAxis type="number" domain={[-100, 100]} hide />
          <YAxis
            type="category"
            dataKey="label"
            orientation="right"
            axisLine={false}
            tickLine={false}
            width={Y_AXIS_WIDTH}
            tick={{ fontSize: 12, fill: '#222' }}
          />
          <ReferenceLine x={0} stroke="#e5e7eb" />
          <Tooltip content={<CustomTooltip />} cursor={<RowCursor />} />
          <Bar dataKey="neg" stackId="s" fill={COLORS.negative} radius={[4, 0, 0, 4]} />
          <Bar dataKey="neuLeft" stackId="s" fill={COLORS.neutral} />
          <Bar dataKey="neuRight" stackId="s" fill={COLORS.neutral} />
          <Bar dataKey="pos" stackId="s" fill={COLORS.positive} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
