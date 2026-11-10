import { localToUTC } from './timezone';

export type ReportType = 'daily' | 'weekly' | 'monthly';
export const REPORT_TYPES: ReportType[] = ['daily', 'weekly', 'monthly'];

/** YYYY-MM-DD of `now` in `tz` local time. */
function localDate(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The most recently completed calendar period before `now` in `tz` (Israel time by default):
 * daily = yesterday, weekly = last Sunday–Saturday, monthly = last calendar month.
 * Returned as UTC instants, `end` exclusive. Calendar (not rolling) periods so
 * re-runs land on the same row and back-to-back periods never overlap or gap.
 */
export function reportPeriod(type: ReportType, now: Date = new Date(), tz = 'Asia/Jerusalem'): { start: Date; end: Date } {
  const today = localDate(now, tz);
  let startYmd: string;
  let endYmd: string;
  if (type === 'daily') {
    endYmd = today;
    startYmd = addDays(today, -1);
  } else if (type === 'weekly') {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
    endYmd = addDays(today, -dow); // this week's Sunday
    startYmd = addDays(endYmd, -7);
  } else {
    const [y, m] = today.split('-').map(Number);
    endYmd = `${today.slice(0, 7)}-01`;
    startYmd = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
  }
  return { start: localToUTC(startYmd, '00:00', tz), end: localToUTC(endYmd, '00:00', tz) };
}
