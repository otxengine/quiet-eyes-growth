// Running ads: stored per competitor (not just counted) and treated as activity, so a day
// when competitors only keep ads running is not filed as an empty report.
let adRows: { active: any[]; fresh: any[] } = { active: [], fresh: [] };
jest.mock('../db', () => ({
  prisma: {
    $queryRawUnsafe: async (sql: string) => {
      if (sql.includes('FROM competitors')) return [{ id: 'c1', name: 'טאיזו', rating: null, review_count: null }];
      if (sql.includes('FROM competitor_ad_history')) return sql.includes('last_seen_at >=') ? adRows.active : adRows.fresh;
      return [];
    },
  },
}));

import { buildReportData, isEmptyReport } from '../lib/reportData';

const ad = (id: string, started: string) => ({
  id, competitor_id: 'c1', platform: 'instagram', title: null, body: `ad ${id}`, cta: 'Learn more',
  link: null, has_offer: false, analysis: null, media_url: null, video_url: null, started_at: started,
});
const day = (): Promise<any> =>
  buildReportData('bp1', 'daily', new Date('2026-11-07T22:00:00Z'), new Date('2026-11-08T22:00:00Z'));

describe('buildReportData — running ads', () => {
  it('lists up to 3 running ads launched before the period, counts all of them, and is not empty', async () => {
    const launchedToday = ad('a1', '2026-11-08T08:00:00Z');
    adRows = {
      fresh: [launchedToday],
      active: [launchedToday, ad('a2', '2026-11-01'), ad('a3', '2026-10-20'), ad('a4', '2026-10-02'), ad('a5', '2026-09-15')],
    };
    const data = await day();
    const ads = data.competitors[0].ads;
    expect(ads.new_count).toBe(1);
    expect(ads.active_count).toBe(5);
    expect(ads.active.map((a: any) => a.body)).toEqual(['ad a2', 'ad a3', 'ad a4']); // a1 is already under "new"
    expect(ads.active[0]).not.toHaveProperty('id');
    expect(data.totals.active_ads).toBe(5);
    expect(isEmptyReport(data)).toBe(false);
  });

  it('a day with only running ads still gets a report', async () => {
    adRows = { fresh: [], active: [ad('a2', '2026-11-01')] };
    const data = await day();
    expect(data.totals.new_ads).toBe(0);
    expect(isEmptyReport(data)).toBe(false);
  });

  it('a day with no ads and no other activity is empty', async () => {
    adRows = { fresh: [], active: [] };
    expect(isEmptyReport(await day())).toBe(true);
  });
});
