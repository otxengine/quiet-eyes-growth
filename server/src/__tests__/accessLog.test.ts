/**
 * /api access log — one JSON line per request with the route pattern, status, Clerk user and
 * business, and never the query string or a token from the path.
 */
jest.mock('@clerk/express', () => ({
  getAuth: (req: any) => ({ userId: req.headers['x-test-user'] ?? null }),
}));

import express from 'express';
import type { AddressInfo } from 'net';
import { accessLog } from '../middleware/accessLog';

const app = express();
app.use(express.json());
app.use('/api', accessLog);
const fns = express.Router();
fns.post('/:name', (_req, res) => { res.json({ ok: true }); });
const orgs = express.Router();
orgs.get('/join/:token', (_req, res) => { res.status(404).json({ error: 'invite_not_found' }); });
app.use('/api/functions', fns);
app.use('/api/orgs', orgs);
app.get('/api/health', (_req, res) => { res.json({ ok: true }); });

let base = '';
let server: ReturnType<typeof app.listen>;
beforeAll(done => { server = app.listen(0, () => { base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; done(); }); });
afterAll(done => { server.close(done); });

const log = jest.spyOn(console, 'log').mockImplementation(() => {});
async function accessLines() {
  for (let i = 0; i < 50 && !log.mock.calls.length; i++) await new Promise(r => setTimeout(r, 5));
  return log.mock.calls.map(c => String(c[0])).filter(l => l.includes('"type":"access"'));
}

test('logs route pattern with the function name, status, user and business; no query string', async () => {
  await fetch(`${base}/api/functions/getDashboard?secret=s3cr3t&businessProfileId=ignored-when-body-has-it`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': 'user_abc' },
    body: JSON.stringify({ businessProfileId: 'bp_1', note: 'body text' }),
  });
  const [line] = await accessLines();
  expect(JSON.parse(line)).toMatchObject({
    type: 'access', method: 'POST', route: '/api/functions/getDashboard', status: 200, user: 'user_abc', business: 'bp_1',
  });
  expect(line).not.toMatch(/\?|secret|s3cr3t|body text/);
});

test('keeps a token param as its pattern, signed-out user is null', async () => {
  await fetch(`${base}/api/orgs/join/9f2c4e7a1b3d5f60718293a4b5c6d7e8`);
  const [line] = await accessLines();
  expect(JSON.parse(line)).toMatchObject({ route: '/api/orgs/join/:token', status: 404, user: null, business: null });
  expect(line).not.toContain('9f2c4e7a');
});

test('unmatched path masks id-like segments', async () => {
  await fetch(`${base}/api/nope/0501234567/abc123def456ghi789?x=1`);
  const [line] = await accessLines();
  expect(JSON.parse(line).route).toBe('/api/nope/:id/:id');
});

test('health probes are not logged', async () => {
  await fetch(`${base}/api/health`);
  await new Promise(r => setTimeout(r, 30));
  expect(await accessLines()).toHaveLength(0);
});
