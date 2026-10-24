/**
 * Raw-SQL inserts into jsonb / timestamptz columns must cast explicitly.
 * Prisma sends string[] as text[] and strings as text; Postgres rejects both
 * for jsonb / timestamptz columns with 42804 (otx_decisions.tags,
 * otx_opportunities.source_*_ids + expected_window_*, otx_threats.signal_ids,
 * trend_scan_checkpoint timestamps).
 */

jest.mock('../db', () => ({
  prisma: {
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    $queryRawUnsafe:   jest.fn().mockResolvedValue([{ id: 'opp_1', is_new: true }]),
  },
}));

import { prisma } from '../db';
import { DecisionRepository } from '../repositories/DecisionRepository';
import { opportunityRepository, threatRepository } from '../repositories/OpportunityRepository';
import { saveCheckpoint } from '../lib/trendMemory';

const exec  = prisma.$executeRawUnsafe as jest.Mock;
const query = prisma.$queryRawUnsafe as jest.Mock;

/** Maps each `$N::type` cast in the SQL to the param passed for it. */
function castedParams(sql: string, params: unknown[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const [, n, type] of sql.matchAll(/\$(\d+)::(\w+)/g)) {
    (out[type] ??= []).push(params[Number(n) - 1]);
  }
  return out;
}

describe('otx raw inserts', () => {
  it('saveDecision sends tags as a jsonb string and fills NOT NULL decision_type/title', async () => {
    await new DecisionRepository().saveDecision({
      id: 'dec_1', business_id: 'biz', insight_id: 'ins', trace_id: 'tr',
      action_type: 'post_content', title: 'Post a promo', reasoning: 'why',
      priority: 6, score: 70, expected_roi: 0.5, confidence: 0.6,
      score_breakdown: {}, execution_mode: 'suggest', tags: ['post_content', 'urgency:high'],
      context_snapshot: '{}', expires_at: '2026-10-21T00:00:00.000Z',
    } as any);

    const [sql, ...params] = exec.mock.calls[0];
    expect(sql).not.toContain('text[]');
    expect(castedParams(sql, params).jsonb).toContain(JSON.stringify(['post_content', 'urgency:high']));
    expect(sql).toMatch(/decision_type, title, score\)/);
    expect(params).toContain('Post a promo');
  });

  it('saveDecision also writes score (getRecentDecisions orders by it)', async () => {
    await new DecisionRepository().saveDecision({ id: 'dec_2', business_id: 'biz', action_type: 'x', score: 100 } as any);

    const [sql, ...params] = exec.mock.calls[0];
    expect(sql).toMatch(/title, score\)/);
    expect(sql).toMatch(/\$16,\$8::numeric\)/);
    expect(params[7]).toBe(100);
  });

  it('saveFusedInsight writes the real otx_fused_insights columns, incl. NOT NULL summary', async () => {
    await new DecisionRepository().saveFusedInsight({
      id: 'ins_1', business_id: 'biz', trace_id: 'tr', top_summary: 'Headline', top_opportunity: 'long',
      urgency: 'high', confidence: 0.8, expected_business_impact: '+10%', expected_impact: '+10%',
      contributing_items: [{ type: 'signal', id: 's1', label: 'l', score: 1 }], contributing_signals: ['s1'],
      suggested_action_types: ['content'], created_at: '2026-10-20T00:00:00.000Z',
    } as any);

    const [sql, ...params] = exec.mock.calls[0];
    expect(sql).toMatch(/\(id, business_id, trace_id, urgency, confidence, summary,\s+key_signals, recommended_actions, predicted_impact, created_at\)/);
    expect(sql).not.toMatch(/top_opportunity|explanation|contributing_signal_ids|raw_signals_count|trends_count/);
    expect(params[5]).toBe('Headline');
    expect(castedParams(sql, params).jsonb).toEqual([JSON.stringify([{ type: 'signal', id: 's1', label: 'l', score: 1 }]), '["content"]']);
  });

  it('updateTaskStatus sets error_message (there is no error column)', async () => {
    await new DecisionRepository().updateTaskStatus('task_1', 'failed', 'boom');

    const [sql, ...params] = exec.mock.calls[0];
    expect(sql).toMatch(/error_message = \$3/);
    expect(params).toEqual(['task_1', 'failed', 'boom']);
  });

  it('opportunity upsert sends id arrays as jsonb strings and windows as timestamptz', async () => {
    await opportunityRepository.upsert({
      id: 'opp_1', business_id: 'biz', type: 'demand_spike',
      source_signal_ids: ['s1'], source_event_ids: [], source_forecast_ids: ['f1'],
      opportunity_score: 0.7, urgency: 'high', confidence: 0.6,
      expected_window_start: '2026-10-24T00:00:00.000Z', expected_window_end: null,
      explanation: 'x', dedup_key: 'k', status: 'detected',
      created_at: '2026-10-20T00:00:00.000Z', updated_at: '2026-10-20T00:00:00.000Z',
    } as any);

    const [sql, ...params] = query.mock.calls[0];
    const casts = castedParams(sql, params);
    expect(casts.jsonb).toEqual(['["s1"]', '[]', '["f1"]']);
    expect(casts.timestamptz).toEqual(expect.arrayContaining(['2026-10-24T00:00:00.000Z', null]));
    expect(params.some(Array.isArray)).toBe(false);
  });

  it('threat upsert writes the real signal_ids jsonb column', async () => {
    await threatRepository.upsert({
      id: 'thr_1', business_id: 'biz', type: 'negative_review_spike', source_signal_ids: ['s1'],
      risk_score: 0.6, urgency: 'high', confidence: 0.7, explanation: 'x', dedup_key: 'k',
      status: 'detected', created_at: '2026-10-20T00:00:00.000Z', updated_at: '2026-10-20T00:00:00.000Z',
    } as any);

    const [sql, ...params] = query.mock.calls[0];
    expect(sql).toMatch(/\(id, business_id, type, signal_ids,/);
    expect(castedParams(sql, params).jsonb).toEqual(['["s1"]']);
  });

  it('trend checkpoint casts ISO timestamps to timestamptz', async () => {
    await saveCheckpoint({ _key: 'k', lastScanAt: null, scannedIds: new Set(['a']), scannedUrls: new Set(), meta: {} });

    const [sql, ...params] = exec.mock.calls[0];
    const ts = castedParams(sql, params).timestamptz;
    expect(ts).toHaveLength(3);
    ts.forEach(v => expect(v).toMatch(/^\d{4}-\d\d-\d\dT/));
  });
});
