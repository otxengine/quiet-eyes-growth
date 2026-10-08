export const COLORS = { positive: '#10b981', neutral: '#c3c2b7', negative: '#e34948' };

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
    <div className="space-y-2">
      {data.map(row => (
        <div key={row.theme} dir="rtl" className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[12px] leading-tight text-[#222] text-right">{row.label}</span>
          <span className="w-8 shrink-0 text-[10px] text-gray-400 text-right">{row.total}</span>
          <div className="group relative flex-1">
            <div dir="ltr" className="h-[20px] rounded-full overflow-hidden flex bg-gray-100">
              {row.negPct > 0 && <div style={{ width: `${row.negPct}%`, background: COLORS.negative }} />}
              {row.neuPct > 0 && <div style={{ width: `${row.neuPct}%`, background: COLORS.neutral }} />}
              {row.posPct > 0 && <div style={{ width: `${row.posPct}%`, background: COLORS.positive }} />}
            </div>
            <div
              dir="rtl"
              className="pointer-events-none absolute right-0 top-full z-10 mt-1 hidden whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] shadow-sm group-hover:block"
            >
              <div className="font-semibold text-foreground">{row.label}</div>
              <div style={{ color: COLORS.positive }}>חיובי: {row.positive}</div>
              <div className="text-foreground-muted">ניטרלי: {row.neutral}</div>
              <div style={{ color: COLORS.negative }}>שלילי: {row.negative}</div>
              <div className="text-foreground-muted">סה"כ: {row.total}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
