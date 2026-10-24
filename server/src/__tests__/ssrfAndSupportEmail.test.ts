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

describe('isBlockedAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '169.254.170.2',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])(
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
