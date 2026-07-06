/**
 * Tests for agentCost backward-compat logic (KAN-56).
 * planConfig.js is ESM/FE-only so we inline the logic here;
 * if the production function changes, update this test to match.
 */

// Mirrors AGENT_COSTS + agentCost() from src/lib/planConfig.js
const AGENT_COSTS: Record<string, number> = {
  runIntelligenceEngines: 0.06,
  collectWebSignals:      0.10,
  runFullScan:            0.40,
};
const LEGACY_AGENT_NAMES: Record<string, string> = { runMarketIntelligence: 'runIntelligenceEngines' };
function agentCost(name: string): number {
  return AGENT_COSTS[name] ?? AGENT_COSTS[LEGACY_AGENT_NAMES[name]] ?? 0.02;
}

describe('agentCost — KAN-56 backward-compat', () => {

  test('canonical key returns correct cost', () => {
    expect(agentCost('runIntelligenceEngines')).toBe(0.06);
  });

  test('legacy key runMarketIntelligence still resolves via alias', () => {
    expect(agentCost('runMarketIntelligence')).toBe(0.06);
  });

  test('unknown key falls back to default 0.02', () => {
    expect(agentCost('nonExistentAgent')).toBe(0.02);
  });

  test('canonical key is present in AGENT_COSTS, legacy key is not', () => {
    expect(AGENT_COSTS).toHaveProperty('runIntelligenceEngines');
    expect(AGENT_COSTS).not.toHaveProperty('runMarketIntelligence');
  });

});
