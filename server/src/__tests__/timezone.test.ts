import { isWithinIsraelHours } from '../lib/timezone';

describe('isWithinIsraelHours', () => {
  it('compares against Israel wall-clock, not the UTC server clock', () => {
    // Summer (IDT, UTC+3): 18:30Z is 21:30 in Israel — after closing.
    expect(isWithinIsraelHours('09:00', '20:00', new Date('2026-07-01T18:30:00Z'))).toBe(false);
    // 06:30Z is 09:30 in Israel — open (a UTC clock would say closed).
    expect(isWithinIsraelHours('09:00', '20:00', new Date('2026-07-01T06:30:00Z'))).toBe(true);
    // Winter (IST, UTC+2): 17:30Z is 19:30 in Israel — open.
    expect(isWithinIsraelHours('09:00', '20:00', new Date('2026-01-15T17:30:00Z'))).toBe(true);
  });

  it('respects minutes and overnight windows', () => {
    // 20:15 Israel, closes 20:30
    expect(isWithinIsraelHours('09:00', '20:30', new Date('2026-07-01T17:15:00Z'))).toBe(true);
    // 20:00–02:00: 01:00 Israel is open, 12:00 Israel is closed
    expect(isWithinIsraelHours('20:00', '02:00', new Date('2026-07-01T22:00:00Z'))).toBe(true);
    expect(isWithinIsraelHours('20:00', '02:00', new Date('2026-07-01T09:00:00Z'))).toBe(false);
  });
});
