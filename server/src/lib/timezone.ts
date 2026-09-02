const IL_TZ = 'Asia/Jerusalem';

/**
 * Converts a wall-clock date+time in Israel local time to the equivalent UTC
 * Date, handling DST correctly via Intl (round-trip: guess as UTC, see how
 * that instant reads in Asia/Jerusalem, correct by the difference).
 */
export function israelLocalToUTC(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: IL_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(guess).map(p => [p.type, p.value])) as Record<string, string>;
  const readAsUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return new Date(guess.getTime() + (guess.getTime() - readAsUTC));
}

/** Today's date (YYYY-MM-DD) in Israel local time, plus dayOffset days. */
export function israelDateOffset(dayOffset: number): string {
  const todayIL = new Intl.DateTimeFormat('en-CA', { timeZone: IL_TZ }).format(new Date());
  const [y, m, d] = todayIL.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dayOffset);
  return dt.toISOString().slice(0, 10);
}
