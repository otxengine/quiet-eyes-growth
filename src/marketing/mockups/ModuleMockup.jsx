import React from 'react';

/* Parameterized replica of a product screen: title bar, tab/stat chips and
   prioritized list rows. Coded (no screenshots) — crisp, RTL-native, themeable. */

const BADGE_TONES = {
  red: { color: '#DC2626', bg: '#FEF2F2' },
  amber: { color: '#D97706', bg: '#FFFBEB' },
  blue: { color: '#2563EB', bg: '#EFF6FF' },
  green: { color: '#059669', bg: '#ECFDF5' },
};

export default function ModuleMockup({ spec }) {
  return (
    <div
      className="mkt-card w-full max-w-xl p-5 shadow-[0_25px_70px_-30px_rgba(16,16,20,0.3)]"
      role="img"
      aria-label={`הדגמה של מסך ${spec.title} במוצר`}
    >
      {/* Window title bar */}
      <div className="flex items-center justify-between pb-4 border-b" style={{ borderColor: 'var(--mkt-border)' }}>
        <div className="font-bold text-[14.5px]" style={{ color: 'var(--mkt-ink)' }}>{spec.title}</div>
        <div className="flex gap-1.5" aria-hidden="true">
          {['#F8793A', '#EC1E63', '#C1257F'].map((c) => (
            <span key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c, opacity: 0.7 }} />
          ))}
        </div>
      </div>

      {/* Tabs / stat chips */}
      <div className="flex flex-wrap gap-2 mt-4" aria-hidden="true">
        {spec.chips.map((chip, i) => (
          <span
            key={chip}
            className="rounded-full px-3 py-1.5 text-[11.5px] font-bold"
            style={i === 0
              ? { background: 'var(--mkt-ink)', color: '#fff' }
              : { background: '#F4F4F6', color: 'var(--mkt-ink-2)' }}
          >
            {chip}
          </span>
        ))}
      </div>

      {/* Rows */}
      <div className="mt-4 space-y-2">
        {spec.rows.map((row) => {
          const tone = BADGE_TONES[row.badgeTone] || BADGE_TONES.blue;
          return (
            <div
              key={row.text}
              className="rounded-xl border bg-white p-3 flex items-center gap-3"
              style={{ borderColor: 'var(--mkt-border)' }}
            >
              <span className="text-[16px] leading-none shrink-0" aria-hidden="true">{row.icon}</span>
              <span className="flex-1 text-[12.5px] font-medium leading-snug" style={{ color: 'var(--mkt-ink-2)' }}>
                {row.text}
              </span>
              {row.badge && (
                <span className="text-[10.5px] font-bold rounded-full px-2 py-0.5 shrink-0" style={{ color: tone.color, background: tone.bg }}>
                  {row.badge}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
