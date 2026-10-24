// Sets env vars needed by module-level constants before modules are loaded.
process.env.GOOGLE_PLACES_API_KEY = 'test-places-key';
process.env.GOOGLE_CLIENT_ID      = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET  = 'test-client-secret';

// lib/safeFetch resolves every host before fetching: answer locally so no suite depends on real DNS.
jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(async (host: string) => [{ address: host === 'localhost' ? '127.0.0.1' : '93.184.216.34', family: 4 }]),
}));
