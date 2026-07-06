import { LEGACY_STAGE_MAP, PipelineStage } from '../models';

describe('KAN-59: engine_analysis stage rename', () => {
  it('LEGACY_STAGE_MAP maps market_intelligence → engine_analysis', () => {
    expect(LEGACY_STAGE_MAP['market_intelligence']).toBe('engine_analysis');
  });

  it('engine_analysis is a valid PipelineStage (type check via assignment)', () => {
    const stage: PipelineStage = 'engine_analysis';
    expect(stage).toBe('engine_analysis');
  });

  it('market_intelligence is NOT a valid key in LEGACY_STAGE_MAP target values', () => {
    const values = Object.values(LEGACY_STAGE_MAP);
    expect(values).not.toContain('market_intelligence');
  });
});
