/**
 * 5xx responses go out as a generic message (details only in the server log); 4xx validation
 * messages and 2xx bodies pass through unchanged. Covers handlers and the error middleware.
 */
import express from 'express';
import type { AddressInfo } from 'net';
import { hideServerErrors } from '../middleware/hideServerErrors';

const app = express();
app.use(hideServerErrors);
app.get('/prisma', (_req, res) => { res.status(500).json({ error: 'Invalid `prisma.lead.findMany()`', code: 'P2022', hint: 'column x' }); });
app.get('/graph', (_req, res) => { res.status(502).send({ error: 'Graph failed', detail: { fbtrace_id: 'abc' } }); });
app.get('/thrown', () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432'); });
app.get('/validation', (_req, res) => { res.status(400).json({ error: 'Missing url' }); });
app.get('/ok', (_req, res) => { res.json({ ok: true }); });
app.use((err: any, _req: any, res: any, _next: any) => { res.status(500).json({ error: err.message }); });

let base = '';
let server: any;
beforeAll(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));

const get = async (path: string) => {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
};

test.each(['/prisma?token=secret', '/graph', '/thrown'])('%s answers with a generic 5xx and logs the detail', async (path) => {
  const { status, body } = await get(path);
  expect(status).toBeGreaterThanOrEqual(500);
  expect(body).toEqual({ error: 'Internal server error' });
  const logged = (console.error as jest.Mock).mock.calls.flat().join(' ');
  expect(logged).toContain(path.split('?')[0]);
  expect(logged).not.toContain('secret');
});

test('4xx and 2xx bodies are untouched', async () => {
  expect(await get('/validation')).toEqual({ status: 400, body: { error: 'Missing url' } });
  expect(await get('/ok')).toEqual({ status: 200, body: { ok: true } });
});
