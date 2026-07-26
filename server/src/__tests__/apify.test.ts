import '../__tests__/testEnv';

process.env.APIFY_API_KEY = 'test-apify-key';

import { runApifyActor, hasApifyKey } from '../lib/apify';

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => mockFetch.mockReset());

describe('hasApifyKey', () => {
  it('returns true when key is set', () => {
    expect(hasApifyKey()).toBe(true);
  });
});

describe('runApifyActor — HTTP contract', () => {
  const startPayload    = { data: { id: 'run-123' } };
  const succeededStatus = { data: { status: 'SUCCEEDED', defaultDatasetId: 'ds-456' } };
  const items           = [{ title: 'video1' }];

  beforeEach(() => jest.useFakeTimers());
  afterEach(()  => jest.useRealTimers());

  async function runAndAdvance(maxWaitMs = 10_000) {
    const promise = runApifyActor('some~actor', { foo: 'bar' }, maxWaitMs);
    // advance past the 5 s poll delay
    await jest.advanceTimersByTimeAsync(6_000);
    return promise;
  }

  it('sends Authorization: Bearer header — never puts key in URL', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => startPayload })
      .mockResolvedValueOnce({ ok: true, json: async () => succeededStatus })
      .mockResolvedValueOnce({ ok: true, json: async () => items });

    await runAndAdvance();

    for (const [url, init] of mockFetch.mock.calls) {
      expect(url).not.toContain('test-apify-key');
      expect((init?.headers as any)?.['Authorization']).toBe('Bearer test-apify-key');
    }
  });

  it('calls start, status-poll, and items endpoints in order', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => startPayload })
      .mockResolvedValueOnce({ ok: true, json: async () => succeededStatus })
      .mockResolvedValueOnce({ ok: true, json: async () => items });

    const result = await runAndAdvance();

    const urls: string[] = mockFetch.mock.calls.map(([url]) => url);
    expect(urls[0]).toMatch(/\/acts\/some~actor\/runs$/);
    expect(urls[1]).toMatch(/\/actor-runs\/run-123$/);
    expect(urls[2]).toMatch(/\/datasets\/ds-456\/items/);
    expect(result).toEqual(items);
  });

  it('returns [] on failed start response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = runApifyActor('some~actor', {}, 10_000);
    await jest.advanceTimersByTimeAsync(100);
    expect(await result).toEqual([]);
  });

  it('returns [] when actor run fails', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => startPayload })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { status: 'FAILED' } }) });

    const result = await runAndAdvance();
    expect(result).toEqual([]);
  });
});
