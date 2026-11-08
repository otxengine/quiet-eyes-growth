import { reportPeriod } from '../lib/reportPeriod';

const iso = (p: { start: Date; end: Date }) => [p.start.toISOString(), p.end.toISOString()];

describe('reportPeriod', () => {
  it('daily = yesterday in Israel time (winter, UTC+2)', () => {
    expect(iso(reportPeriod('daily', new Date('2026-11-08T10:00:00Z'))))
      .toEqual(['2026-11-06T22:00:00.000Z', '2026-11-07T22:00:00.000Z']);
  });

  it('daily uses the Israel date, not the UTC date, just after IL midnight', () => {
    // 2026-11-07T22:30Z is already 00:30 on Nov 8 in Israel → yesterday = Nov 7
    expect(iso(reportPeriod('daily', new Date('2026-11-07T22:30:00Z'))))
      .toEqual(['2026-11-06T22:00:00.000Z', '2026-11-07T22:00:00.000Z']);
  });

  it('daily spans 25h on the DST-end day (2026-10-25)', () => {
    const p = reportPeriod('daily', new Date('2026-10-26T10:00:00Z'));
    expect(iso(p)).toEqual(['2026-10-24T21:00:00.000Z', '2026-10-25T22:00:00.000Z']);
    expect((p.end.getTime() - p.start.getTime()) / 3600000).toBe(25);
  });

  it('weekly = last Sunday–Saturday when run on Sunday', () => {
    expect(iso(reportPeriod('weekly', new Date('2026-11-08T10:30:00Z'))))
      .toEqual(['2026-10-31T22:00:00.000Z', '2026-11-07T22:00:00.000Z']);
  });

  it('weekly mid-week still returns the last completed week', () => {
    expect(iso(reportPeriod('weekly', new Date('2026-11-11T10:30:00Z'))))
      .toEqual(['2026-10-31T22:00:00.000Z', '2026-11-07T22:00:00.000Z']);
  });

  it('monthly = previous calendar month across the DST change', () => {
    expect(iso(reportPeriod('monthly', new Date('2026-11-01T11:00:00Z'))))
      .toEqual(['2026-09-30T21:00:00.000Z', '2026-10-31T22:00:00.000Z']);
  });

  it('monthly rolls back over the year boundary', () => {
    expect(iso(reportPeriod('monthly', new Date('2027-01-01T11:00:00Z'))))
      .toEqual(['2026-11-30T22:00:00.000Z', '2026-12-31T22:00:00.000Z']);
  });
});
