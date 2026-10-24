/**
 * lib/safeFetch.ts: server-side fetches of user- or scrape-supplied URLs must not reach
 * internal addresses (learnFromWebsite fetched any URL from the request body).
 * submitSupportTicket: request fields went into the support email HTML unescaped.
 */
jest.mock('../lib/email', () => ({ sendEmail: jest.fn(() => Promise.resolve()) }));
jest.mock('../middleware/auth', () => ({ getUserId: jest.fn(() => 'user-a') }));
jest.mock('../lib/ownership', () => ({ getUserEmail: jest.fn(() => Promise.resolve('real@example.com')) }));

import { safeFetch, isBlockedAddress, BlockedUrlError } from '../lib/safeFetch';
import { submitSupportTicket } from '../routes/functions/submitSupportTicket';
import { sendEmail } from '../lib/email';
import { extractSocialLinksFromWebsite } from '../lib/extractSocialLinksFromWebsite';

describe('isBlockedAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '169.254.170.2',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1',
    '::7f00:1', '::ffff:0:7f00:1', '2002:7f00:1::', 'fec0::1', '192.0.2.1', '198.51.100.1'])(
    'blocks %s', a => expect(isBlockedAddress(a)).toBe(true));
  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'])(
    'allows %s', a => expect(isBlockedAddress(a)).toBe(false));
});

describe('safeFetch', () => {
  const realFetch = global.fetch;
  const fetchMock = jest.fn();
  beforeEach(() => { fetchMock.mockReset(); global.fetch = fetchMock as any; });
  afterAll(() => { global.fetch = realFetch; });

  it.each(['http://169.254.170.2/v2/credentials', 'http://localhost:3001/api/health', 'http://[::1]/',
    'http://0x7f000001/', 'http://2130706433/', 'file:///etc/passwd', 'ftp://example.com/x'])(
    'refuses %s without sending a request', async url => {
      await expect(safeFetch(url)).rejects.toBeInstanceOf(BlockedUrlError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

  it('re-checks every redirect hop', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }));
    await expect(safeFetch('http://93.184.216.34/')).rejects.toBeInstanceOf(BlockedUrlError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows public redirects, without letting fetch follow them itself', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/moved' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const res = await safeFetch('http://93.184.216.34/');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenLastCalledWith('http://93.184.216.34/moved', expect.objectContaining({ redirect: 'manual' }));
  });

  it('decodes a raw UTF-8 Location (headers arrive as latin1), e.g. /אודות', async () => {
    const raw = Buffer.from('/אודות', 'utf8').toString('latin1');
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: raw } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    await safeFetch('http://93.184.216.34/');
    expect(fetchMock).toHaveBeenLastCalledWith(`http://93.184.216.34${encodeURI('/אודות')}`, expect.anything());
  });

  it('only follows real redirects (not 300/304)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers: { location: '/elsewhere' } }));
    expect((await safeFetch('http://93.184.216.34/')).status).toBe(304);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a javascript: link out of facebook_url (it is stored and rendered as a link)', async () => {
    fetchMock.mockImplementation(async () => new Response(
      '<a href="javascript:alert(1)//facebook.com/x">a</a><a href="https://www.facebook.com/realpage">b</a>', { status: 200 }));
    const result = await extractSocialLinksFromWebsite('https://competitor.example/');
    expect(result.facebook_url).toBe('https://www.facebook.com/realpage');
  });
});

describe('safeFetch — DNS rebinding (real fetch, real socket)', () => {
  it('connects only to the checked address: a second, internal DNS answer is refused', async () => {
    const http = require('node:http');
    let hits = 0;
    const server = http.createServer((_req: any, res: any) => { hits++; res.end('internal'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { lookup } = require('node:dns/promises');
    (lookup as jest.Mock).mockClear();
    (lookup as jest.Mock)
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]) // the pre-check: public
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);    // the connection: internal
    try {
      const err = await safeFetch(`http://rebind.test:${server.address().port}/`).catch(e => e);
      // fetch() wraps connect errors (net re-creates the lookup error); our message in the
      // cause and a second lookup prove the pinned lookup ran, not an agent incompatibility.
      expect(String(err?.cause?.message)).toContain('Blocked address for rebind.test');
      expect(lookup).toHaveBeenCalledTimes(2);
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  });
});

describe('submitSupportTicket email', () => {
  it('escapes request fields and names the signed-in user, not the claimed address', async () => {
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() } as any;
    await submitSupportTicket({ body: {
      description: '<img src=x onerror=alert(1)>',
      userEmail: 'boss@company.com',
      businessId: '"><a href="https://evil.example">',
      transcript: [{ role: 'user', text: '<script>x</script>' }],
    } } as any, res);

    const { subject, html } = (sendEmail as jest.Mock).mock.calls[0][0];
    expect(html).not.toMatch(/<img src=x|<script>|<a href="https:\/\/evil/);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('real@example.com');
    expect(subject).toContain('real@example.com');
    expect(html).not.toContain('boss@company.com');
  });
});
