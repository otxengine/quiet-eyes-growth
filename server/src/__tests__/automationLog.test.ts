import { writeAutomationLogDual } from '../lib/automationLog';

jest.mock('../db', () => ({
  prisma: { automationLog: { create: jest.fn() } },
}));

const { prisma } = require('../db');
const mockCreate = prisma.automationLog.create as jest.Mock;

const BIZ = 'biz-123';
const START = '2026-07-07T00:00:00.000Z';

beforeEach(() => mockCreate.mockResolvedValue(undefined));
afterEach(() => {
  jest.clearAllMocks();
  delete process.env.DUAL_WRITE_AUTOMATION_LOG;
});

describe('writeAutomationLogDual — KAN-58 dual-write', () => {
  it('writes only canonical when flag is off', async () => {
    await writeAutomationLogDual('synthesizeMarketInsights', 'runMarketIntelligence', BIZ, START, 3);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0].data.automation_name).toBe('synthesizeMarketInsights');
  });

  it('writes canonical + legacy when DUAL_WRITE_AUTOMATION_LOG=true', async () => {
    process.env.DUAL_WRITE_AUTOMATION_LOG = 'true';
    await writeAutomationLogDual('synthesizeMarketInsights', 'runMarketIntelligence', BIZ, START, 3);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const names = mockCreate.mock.calls.map((c: any) => c[0].data.automation_name);
    expect(names).toContain('synthesizeMarketInsights');
    expect(names).toContain('runMarketIntelligence');
  });

  it('same behavior for runIntelligenceEngines', async () => {
    process.env.DUAL_WRITE_AUTOMATION_LOG = 'true';
    await writeAutomationLogDual('runIntelligenceEngines', 'runMarketIntelligence', BIZ, START, 5);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const names = mockCreate.mock.calls.map((c: any) => c[0].data.automation_name);
    expect(names).toContain('runIntelligenceEngines');
    expect(names).toContain('runMarketIntelligence');
  });
});
