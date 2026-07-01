import { getCollectorMetrics, checkAndAlertFailureRate } from '../lib/collectorMetrics';
import { prisma } from '../db';
import * as email from '../lib/email';

jest.mock('../db', () => ({ prisma: { $queryRawUnsafe: jest.fn() } }));
jest.mock('../lib/email', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));

const mockRows = (agents: any[], costs: any[]) => {
  (prisma.$queryRawUnsafe as jest.Mock)
    .mockResolvedValueOnce(agents)
    .mockResolvedValueOnce(costs);
};

describe('getCollectorMetrics', () => {
  afterEach(() => jest.clearAllMocks());

  test('computes error_rate and skip_rate correctly', async () => {
    mockRows(
      [{ automation_name: 'collectWebSignals', total: '10', failed: '3', skipped: '2' }],
      [],
    );
    const result = await getCollectorMetrics(24);
    expect(result.agents[0].error_rate).toBeCloseTo(0.3);
    expect(result.agents[0].skip_rate).toBeCloseTo(0.2);
  });

  test('returns zero rates when total is 0', async () => {
    mockRows(
      [{ automation_name: 'collectReviews', total: '0', failed: '0', skipped: '0' }],
      [],
    );
    const result = await getCollectorMetrics(24);
    expect(result.agents[0].error_rate).toBe(0);
    expect(result.agents[0].skip_rate).toBe(0);
  });
});

describe('checkAndAlertFailureRate', () => {
  const OLD_ENV = process.env;
  beforeEach(() => { process.env = { ...OLD_ENV, OPS_ALERT_EMAIL: 'ops@test.com', COLLECTOR_ERROR_RATE_THRESHOLD: '0.20' }; });
  afterEach(() => { process.env = OLD_ENV; jest.clearAllMocks(); });

  test('sends email when failure rate exceeds threshold', async () => {
    mockRows(
      [{ automation_name: 'collectWebSignals', total: '10', failed: '3', skipped: '0' }],
      [],
    );
    await checkAndAlertFailureRate();
    expect(email.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ops@test.com',
      subject: expect.stringContaining('Collector failure rate exceeded'),
    }));
  });

  test('does not send email when failure rate is below threshold', async () => {
    mockRows(
      [{ automation_name: 'collectWebSignals', total: '10', failed: '1', skipped: '0' }],
      [],
    );
    await checkAndAlertFailureRate();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  test('does not send email when total runs < 5', async () => {
    mockRows(
      [{ automation_name: 'collectWebSignals', total: '3', failed: '3', skipped: '0' }],
      [],
    );
    await checkAndAlertFailureRate();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  test('skips alert check when OPS_ALERT_EMAIL is not set', async () => {
    delete process.env.OPS_ALERT_EMAIL;
    await checkAndAlertFailureRate();
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
