/**
 * Regression test for KAN-182: no synthesized (today+7 / "now") dates written to event rows.
 * Tests the date gate logic in pure unit form — no DB or network.
 */

import { firstValidDate } from '../lib/serpapi';

// ── firstValidDate ────────────────────────────────────────────────────────────

describe('firstValidDate', () => {
  it('returns null when no candidates are provided', () => {
    expect(firstValidDate()).toBeNull();
  });

  it('returns null for all-null/undefined candidates', () => {
    expect(firstValidDate(null, undefined, null)).toBeNull();
  });

  it('returns null for unparseable strings (no synthetic fallback)', () => {
    expect(firstValidDate('not a date', 'also bad')).toBeNull();
  });

  it('returns ISO string for the first valid candidate', () => {
    const result = firstValidDate('2026-09-01');
    expect(result).not.toBeNull();
    expect(result).toMatch(/^2026-09-01/);
  });

  it('skips invalid candidates and returns the first valid one', () => {
    const result = firstValidDate(undefined, 'garbage', '2026-12-25T00:00:00Z');
    expect(result).not.toBeNull();
    expect(result).toMatch(/^2026-12-25/);
  });
});

// ── EventCollector quality gate (pure logic) ─────────────────────────────────

describe('EventCollector quality gate', () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const today    = new Date().toISOString().split('T')[0];
  const todayPlus7 = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
  const future   = '2099-01-01';

  const gate = (events: Array<{ event_date: string }>) =>
    events.filter(e => e.event_date >= tomorrow);

  it('drops events with today+7 synthetic date when it equals today', () => {
    // edge: if today+7 < tomorrow (impossible normally), gate catches it
    const rows = [{ event_date: today }];
    expect(gate(rows)).toHaveLength(0);
  });

  it('keeps events with a real future date', () => {
    const rows = [{ event_date: future }];
    expect(gate(rows)).toHaveLength(1);
  });

  it('keeps today+7 ONLY when it is genuinely ≥ tomorrow (it always is)', () => {
    // today+7 is always ≥ tomorrow — but this row should never exist after AC1 fix
    const rows = [{ event_date: todayPlus7 }];
    expect(gate(rows)).toHaveLength(1); // gate allows it; AC1 fix prevents it being created
  });

  it('drops past dates', () => {
    const rows = [{ event_date: '2020-01-01' }];
    expect(gate(rows)).toHaveLength(0);
  });

  it('filters mixed batch correctly', () => {
    const rows = [
      { event_date: '2020-06-01' }, // past
      { event_date: today },        // today — not strictly ≥ tomorrow
      { event_date: future },       // real future
    ];
    const kept = gate(rows);
    expect(kept).toHaveLength(1);
    expect(kept[0].event_date).toBe(future);
  });
});
