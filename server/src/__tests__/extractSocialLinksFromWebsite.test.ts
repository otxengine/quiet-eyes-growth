import { extractSocialLinksFromWebsite } from '../lib/extractSocialLinksFromWebsite';

function htmlResponse(html: string) {
  return { ok: true, text: () => Promise.resolve(html) };
}

const HOME_ALL_THREE = `
  <a href="https://instagram.com/pizzaroma">IG</a>
  <a href="https://www.facebook.com/pizzaroma">FB</a>
  <a href="https://tiktok.com/@pizzaroma">TikTok</a>
`;

const HOME_NOISE_ONLY = `
  <a href="https://instagram.com/p/123">post</a>
  <a href="https://instagram.com/accounts/login">login</a>
  <a href="https://facebook.com/sharer/sharer.php?u=x">share</a>
  <a href="https://tiktok.com/discover">discover</a>
`;

const EMPTY_HTML = `<html><body>no links here</body></html>`;

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue(htmlResponse(EMPTY_HTML)) as any;
});

describe('extractSocialLinksFromWebsite', () => {
  test('AC1/AC3: happy path extracts all three platforms from the homepage and short-circuits', async () => {
    global.fetch = jest.fn().mockResolvedValue(htmlResponse(HOME_ALL_THREE)) as any;

    const result = await extractSocialLinksFromWebsite('https://pizzaroma.com');

    expect(result.instagram_url).toBe('https://www.instagram.com/pizzaroma/');
    expect(result.facebook_url).toBe('https://www.facebook.com/pizzaroma');
    expect(result.tiktok_url).toBe('https://www.tiktok.com/@pizzaroma');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('AC2: rejects login/share/intent/reel noise', async () => {
    global.fetch = jest.fn().mockResolvedValue(htmlResponse(HOME_NOISE_ONLY)) as any;

    const result = await extractSocialLinksFromWebsite('https://pizzaroma.com');

    expect(result.instagram_url).toBeNull();
    expect(result.facebook_url).toBeNull();
    expect(result.tiktok_url).toBeNull();
  });

  test('AC1: falls back to a secondary page when the homepage has nothing', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(htmlResponse(EMPTY_HTML))
      .mockResolvedValueOnce(htmlResponse(HOME_ALL_THREE));
    global.fetch = fetchMock as any;

    const result = await extractSocialLinksFromWebsite('https://pizzaroma.com');

    expect(result.instagram_url).toBe('https://www.instagram.com/pizzaroma/');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://pizzaroma.com/contact');
  });

  test('AC1: fills platforms across multiple secondary pages and short-circuits once complete', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(htmlResponse('<a href="https://instagram.com/pizzaroma">IG</a>'))       // home
      .mockResolvedValueOnce(htmlResponse('<a href="https://facebook.com/pizzaroma">FB</a>'))         // /contact
      .mockResolvedValueOnce(htmlResponse('<a href="https://tiktok.com/@pizzaroma">TikTok</a>'));     // /about
    global.fetch = fetchMock as any;

    const result = await extractSocialLinksFromWebsite('https://pizzaroma.com');

    expect(result.instagram_url).toBe('https://www.instagram.com/pizzaroma/');
    expect(result.facebook_url).toBe('https://facebook.com/pizzaroma');
    expect(result.tiktok_url).toBe('https://www.tiktok.com/@pizzaroma');
    expect(fetchMock).toHaveBeenCalledTimes(3); // home + /contact + /about — /אודות never fetched
  });

  test('facebook.com/fb.com: first-encountered match wins in document order', async () => {
    global.fetch = jest.fn().mockResolvedValue(htmlResponse(`
      <a href="https://fb.com/handle1">FB1</a>
      <a href="https://facebook.com/handle2">FB2</a>
    `)) as any;

    const result = await extractSocialLinksFromWebsite('https://pizzaroma.com');

    expect(result.facebook_url).toBe('https://fb.com/handle1');
  });

  test('AC5: soft-fails to empties on fetch failure, never throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;

    const result = await extractSocialLinksFromWebsite('https://pizzaroma.com');

    expect(result).toEqual({ instagram_url: null, facebook_url: null, tiktok_url: null });
  });

  test('AC5: soft-fails to empties on timeout (abort), never throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError')) as any;

    const result = await extractSocialLinksFromWebsite('https://pizzaroma.com');

    expect(result).toEqual({ instagram_url: null, facebook_url: null, tiktok_url: null });
  });

  test('AC3: returns empties when nothing is found on the homepage or any secondary page', async () => {
    const fetchMock = jest.fn().mockResolvedValue(htmlResponse(HOME_NOISE_ONLY));
    global.fetch = fetchMock as any;

    const result = await extractSocialLinksFromWebsite('https://pizzaroma.com');

    expect(result).toEqual({ instagram_url: null, facebook_url: null, tiktok_url: null });
    expect(fetchMock).toHaveBeenCalledTimes(4); // home + /contact + /about + /אודות
  });

  test('AC4: only ever fetches the competitor\'s own site, never a social platform domain', async () => {
    const fetchMock = jest.fn().mockResolvedValue(htmlResponse(HOME_NOISE_ONLY));
    global.fetch = fetchMock as any;

    await extractSocialLinksFromWebsite('https://pizzaroma.com');

    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/pizzaroma\.com/);
    }
  });

  test('KAN-223 IL sampling: fills all three from a real IL business footer', async () => {
    global.fetch = jest.fn().mockResolvedValue(htmlResponse(`
      <html><body>
        <header><a href="/menu">תפריט</a></header>
        <footer>
          <p>פיצה רומא © 2026 - כל הזכויות שמורות</p>
          <a href="https://www.instagram.com/pizza_roma_il">אינסטגרם</a>
          <a href="https://www.facebook.com/pizzaromatlv">פייסבוק</a>
          <a href="https://www.tiktok.com/@pizzaromatlv">טיקטוק</a>
        </footer>
      </body></html>
    `)) as any;

    const result = await extractSocialLinksFromWebsite('https://pizza-roma.co.il');

    expect(result.instagram_url).toBe('https://www.instagram.com/pizza_roma_il/');
    expect(result.facebook_url).toBe('https://www.facebook.com/pizzaromatlv');
    expect(result.tiktok_url).toBe('https://www.tiktok.com/@pizzaromatlv');
  });

  test('malformed URL input resolves to empties without fetching', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    const result = await extractSocialLinksFromWebsite('not-a-url');

    expect(result).toEqual({ instagram_url: null, facebook_url: null, tiktok_url: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
