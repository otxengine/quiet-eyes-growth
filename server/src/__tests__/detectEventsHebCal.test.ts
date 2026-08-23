import { fetchHebCalHolidays } from '../routes/functions/detectEvents';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

function hebcalResponse(items: object[]) {
  return Promise.resolve({
    ok: true,
    json: async () => ({ items }),
  });
}

describe('fetchHebCalHolidays', () => {
  afterEach(() => mockFetch.mockReset());

  it('maps holiday items and matches CALENDAR_EVENTS sectors', async () => {
    mockFetch.mockReturnValueOnce(
      hebcalResponse([
        { title: 'Yom Kippur', hebrew: 'יום כיפור', date: '2026-09-20', category: 'holiday' },
        { title: 'Rosh Hashana 5787', hebrew: 'ראש השנה', date: '2026-09-11', category: 'holiday' },
        { title: 'Parashat Nitzavim', date: '2026-09-12', category: 'parashat' }, // not a holiday → filtered
      ])
    );

    const result = await fetchHebCalHolidays(new Date('2026-09-01'), new Date('2026-10-01'));

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: 'יום כיפור', date: '2026-09-20', type: 'holiday' });
    expect(result[0].sectors.length).toBeGreaterThan(0); // matched CALENDAR_EVENTS entry
    expect(result[1]).toMatchObject({ name: 'ראש השנה', type: 'holiday' });
  });

  it('falls back to hardcoded holidays when HebCal fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'));

    const result = await fetchHebCalHolidays(new Date(), new Date(Date.now() + 120 * 86400000));

    expect(result.length).toBeGreaterThan(0);
    expect(result.every(e => e.type === 'holiday')).toBe(true);
  });

  it('falls back when HebCal returns non-200', async () => {
    mockFetch.mockReturnValueOnce(Promise.resolve({ ok: false, status: 503, json: async () => ({}) }));

    const result = await fetchHebCalHolidays(new Date(), new Date(Date.now() + 120 * 86400000));

    expect(result.every(e => e.type === 'holiday')).toBe(true);
  });
});
