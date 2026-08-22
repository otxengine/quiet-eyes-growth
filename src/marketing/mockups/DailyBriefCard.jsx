import React from 'react';
import { SparkIcon } from '../ui/primitives.jsx';

/*
 * Replica of the product's DailyBriefPanel (src/components/dashboard/DailyBriefPanel.jsx):
 * 3 prioritized action rows — priority pill, emoji, one-line "why" with a concrete
 * number, minutes estimate and a CTA. Rows below are illustrative UI copy that
 * mirrors the real prompt rules (negative reviews are always priority 0).
 */

const PRIORITY = {
  urgent: { label: 'דחוף', color: '#DC2626', bg: '#FEF2F2' },
  today: { label: 'היום', color: '#D97706', bg: '#FFFBEB' },
  week: { label: 'השבוע', color: '#2563EB', bg: '#EFF6FF' },
};

const SAMPLE_ROWS = [
  {
    priority: 'urgent',
    emoji: '⭐',
    title: 'ביקורת 2 כוכבים חדשה בגוגל — טרם נענתה',
    why: 'תגובה בתוך שעות מצמצמת נזק — טיוטה כבר מוכנה לאישור',
    minutes: 3,
    cta: 'קרא ואשר תגובה',
  },
  {
    priority: 'today',
    emoji: '🏷️',
    title: 'מתחרה הוריד מחיר ב-12% על שירות מקביל',
    why: '3 לידים שאלו על מחיר השבוע — שווה לעדכן את ההצעה',
    minutes: 10,
    cta: 'צפה בהשוואה',
  },
  {
    priority: 'week',
    emoji: '🗓️',
    title: 'פסח בעוד 12 ימים — חלון קמפיין נפתח',
    why: 'טקסט מותאם לעסק כבר מוכן — נשאר לבחור תמונה',
    minutes: 15,
    cta: 'בנה קמפיין',
  },
];

export default function DailyBriefCard({ rows = SAMPLE_ROWS }) {
  return (
    <div
      className="mkt-card w-full max-w-xl p-5 md:p-6 shadow-[0_20px_60px_-30px_rgba(16,16,20,0.3)]"
      role="img"
      aria-label="הדגמה של הבריף היומי: שלוש פעולות מתועדפות עם אומדן זמן"
    >
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--mkt-ink)' }}>
          <SparkIcon size={16} />
        </span>
        <div>
          <div className="font-bold text-[15px]" style={{ color: 'var(--mkt-ink)' }}>בריף יומי</div>
          <div className="text-[12px]" style={{ color: 'var(--mkt-muted)' }}>3 פעולות להיום · לפי סדר חשיבות</div>
        </div>
      </div>

      <div className="mt-4 space-y-2.5">
        {rows.map((row, i) => {
          const p = PRIORITY[row.priority];
          return (
            <div
              key={row.title}
              className="rounded-xl border bg-white p-3.5 flex items-start gap-3"
              style={{ borderColor: 'var(--mkt-border)', borderInlineStartWidth: 3, borderInlineStartColor: p.color }}
            >
              <span className="text-[17px] leading-none mt-0.5" aria-hidden="true">{row.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-bold w-4 h-4 rounded-full inline-flex items-center justify-center" style={{ background: '#F4F4F6', color: 'var(--mkt-muted)' }}>
                    {i + 1}
                  </span>
                  <span className="font-bold text-[13.5px]" style={{ color: 'var(--mkt-ink)' }}>{row.title}</span>
                  <span className="text-[10.5px] font-bold rounded-full px-2 py-0.5" style={{ color: p.color, background: p.bg }}>
                    {p.label}
                  </span>
                </div>
                <div className="mt-1 text-[12px] leading-snug" style={{ color: 'var(--mkt-muted)' }}>{row.why}</div>
                <div className="mt-1.5 flex items-center gap-3 text-[11.5px] font-medium">
                  <span style={{ color: 'var(--mkt-muted)' }}>{row.minutes} דק׳</span>
                  <span style={{ color: 'var(--mkt-ink-2)' }}>{row.cta} ←</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 text-[11px] text-center" style={{ color: 'var(--mkt-muted)' }}>
        מופעל על ידי AI · מתעדכן כל בוקר
      </div>
    </div>
  );
}
