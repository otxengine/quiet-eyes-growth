/**
 * dataforseo.ts — Google Reviews task functions (submitGoogleReviewsTask,
 * getGoogleReviewsTaskResult, hasDataForSeoCreds). Soft-fail contract mirrors
 * the existing live/sync functions (searchCompetitorsByKeyword, searchOrganic).
 */

const OLD_ENV = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...OLD_ENV, DATAFORSEO_LOGIN: 'user', DATAFORSEO_PASSWORD: 'pass' };
  global.fetch = jest.fn();
});

afterAll(() => { process.env = OLD_ENV; });

describe('hasDataForSeoCreds', () => {
  test('true when both env vars set', () => {
    const { hasDataForSeoCreds } = require('../lib/dataforseo');
    expect(hasDataForSeoCreds()).toBe(true);
  });

  test('false when creds missing', () => {
    process.env.DATAFORSEO_LOGIN = '';
    jest.resetModules();
    const { hasDataForSeoCreds } = require('../lib/dataforseo');
    expect(hasDataForSeoCreds()).toBe(false);
  });
});

describe('submitGoogleReviewsTask', () => {
  test('returns null taskId when creds missing (soft-fail, no fetch call)', async () => {
    process.env.DATAFORSEO_LOGIN = '';
    process.env.DATAFORSEO_PASSWORD = '';
    jest.resetModules();
    const { submitGoogleReviewsTask } = require('../lib/dataforseo');
    const result = await submitGoogleReviewsTask({ placeId: 'p1', postbackUrl: 'https://x/webhook', tag: 't1' });
    expect(result).toEqual({ taskId: null, costUsd: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('parses taskId and cost on status_code 20100 (Task Created)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ tasks: [{ id: 'task123', status_code: 20100, status_message: 'Task Created.', cost: 0.002 }] }),
    });
    const { submitGoogleReviewsTask } = require('../lib/dataforseo');
    const result = await submitGoogleReviewsTask({ placeId: 'p1', postbackUrl: 'https://x/webhook', tag: 't1' });
    expect(result).toEqual({ taskId: 'task123', costUsd: 0.002 });

    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.dataforseo.com/v3/business_data/google/reviews/task_post');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body)[0];
    expect(body).toMatchObject({ place_id: 'p1', postback_url: 'https://x/webhook', postback_data: 'advanced', tag: 't1' });
  });

  test('soft-fails on non-20100 status_code', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ tasks: [{ id: null, status_code: 40000, status_message: 'Bad Request', cost: 0 }] }),
    });
    const { submitGoogleReviewsTask } = require('../lib/dataforseo');
    const result = await submitGoogleReviewsTask({ placeId: 'p1', postbackUrl: 'https://x/webhook', tag: 't1' });
    expect(result.taskId).toBeNull();
  });

  test('soft-fails on network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network down'));
    const { submitGoogleReviewsTask } = require('../lib/dataforseo');
    const result = await submitGoogleReviewsTask({ placeId: 'p1', postbackUrl: 'https://x/webhook', tag: 't1' });
    expect(result).toEqual({ taskId: null, costUsd: 0 });
  });

  test('soft-fails on non-ok HTTP response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
    const { submitGoogleReviewsTask } = require('../lib/dataforseo');
    const result = await submitGoogleReviewsTask({ placeId: 'p1', postbackUrl: 'https://x/webhook', tag: 't1' });
    expect(result).toEqual({ taskId: null, costUsd: 0 });
  });

  test('soft-fails on malformed JSON', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => { throw new Error('bad json'); } });
    const { submitGoogleReviewsTask } = require('../lib/dataforseo');
    const result = await submitGoogleReviewsTask({ placeId: 'p1', postbackUrl: 'https://x/webhook', tag: 't1' });
    expect(result).toEqual({ taskId: null, costUsd: 0 });
  });
});

describe('getGoogleReviewsTaskResult', () => {
  test('returns empty immediately when taskId is empty', async () => {
    const { getGoogleReviewsTaskResult } = require('../lib/dataforseo');
    const result = await getGoogleReviewsTaskResult('');
    expect(result).toEqual({ items: [], costUsd: 0, statusCode: null });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('parses items, cost, and status_code on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ tasks: [{ result: [{ items: [{ review_text: 'hi' }] }], cost: 0.01, status_code: 20000 }] }),
    });
    const { getGoogleReviewsTaskResult } = require('../lib/dataforseo');
    const result = await getGoogleReviewsTaskResult('task123');
    expect(result).toEqual({ items: [{ review_text: 'hi' }], costUsd: 0.01, statusCode: 20000 });
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'https://api.dataforseo.com/v3/business_data/google/reviews/task_get/advanced/task123',
    );
  });

  test('soft-fails on network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('down'));
    const { getGoogleReviewsTaskResult } = require('../lib/dataforseo');
    const result = await getGoogleReviewsTaskResult('task123');
    expect(result).toEqual({ items: [], costUsd: 0, statusCode: null });
  });

  test('concatenates items across multiple result[] chunks (deep-depth pagination)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        tasks: [{
          status_code: 20000,
          cost: 0.5,
          result: [
            { items: [{ review_text: 'a' }, { review_text: 'b' }] },
            { items: [{ review_text: 'c' }] },
            { items: null },
          ],
        }],
      }),
    });
    const { getGoogleReviewsTaskResult } = require('../lib/dataforseo');
    const result = await getGoogleReviewsTaskResult('task123');
    expect(result.items).toEqual([{ review_text: 'a' }, { review_text: 'b' }, { review_text: 'c' }]);
  });
});
