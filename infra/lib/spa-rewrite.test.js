// Self-check for the CloudFront viewer-request function: `node infra/lib/spa-rewrite.test.js`
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'spa-rewrite.js'), 'utf8');
assert(src.includes('var GEO_ROUTING = false;'), 'qe-stack.ts replaces this exact text for prod');
const load = on => new Function(src.replace('var GEO_ROUTING = false;', `var GEO_ROUTING = ${on};`) + '; return handler;')();
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
const run = (handler, uri, country, { agent = BROWSER, cookies = {} } = {}) => handler({
  request: {
    uri, cookies,
    headers: { ...(country ? { 'cloudfront-viewer-country': { value: country } } : {}), ...(agent ? { 'user-agent': { value: agent } } : {}) },
  },
});
const to = r => (r.statusCode === 302 ? `-> ${r.headers.location.value}` : r.uri);
const prod = load(true);

// Israel: the English landing page and sign-up go to the Hebrew home; everything else is served.
for (const uri of ['/en', '/en/', '/en/start']) assert.strictEqual(to(run(prod, uri, 'IL')), '-> /', uri);
assert.strictEqual(to(run(prod, '/', 'IL')), '/index.html');
assert.strictEqual(to(run(prod, '/pricing', 'IL')), '/pricing/index.html');
assert.strictEqual(to(run(prod, '/dashboard', 'IL')), '/index.html');
assert.strictEqual(to(run(prod, '/enterprise', 'IL')), '/index.html'); // only starts with "en"
// The English legal pages are served everywhere, as prerendered pages.
for (const c of ['IL', 'US']) for (const uri of ['/en/terms', '/en/privacy']) assert.strictEqual(to(run(prod, uri, c)), uri + '/index.html', uri);
// An English customer travelling in Israel still reaches the account.
assert.strictEqual(to(run(prod, '/en/briefing', 'IL')), '/index.html');

// Elsewhere: the Hebrew product pages go to /en; the English site is served.
for (const uri of ['/', '/home', '/pricing', '/features', '/features/reputation', '/about', '/how-it-works']) {
  assert.strictEqual(to(run(prod, uri, 'US')), '-> /en', uri);
}
assert.strictEqual(to(run(prod, '/en', 'US')), '/en/index.html');
assert.strictEqual(to(run(prod, '/en/start', 'GB')), '/index.html');
// Pages with no English version, the app and files are never routed.
for (const [uri, served] of [['/privacy', '/privacy/index.html'], ['/data-deletion', '/data-deletion/index.html'], ['/terms', '/terms/index.html'],
  ['/contact', '/contact/index.html'], ['/blog', '/blog/index.html'], ['/blog/some-post', '/blog/some-post/index.html'],
  ['/sign-in', '/index.html'], ['/sign-up', '/index.html'], ['/dashboard', '/index.html'], ['/assets/app.js', '/assets/app.js'], ['/sitemap.xml', '/sitemap.xml']]) {
  assert.strictEqual(to(run(prod, uri, 'US')), served, uri);
}

// A signed-in user is never sent away from "/" (their dashboard), wherever they are.
assert.strictEqual(to(run(prod, '/', 'US', { cookies: { __session: { value: 'jwt' } } })), '/index.html');
assert.strictEqual(to(run(prod, '/', 'US', { cookies: { __client_uat: { value: '1794300000' } } })), '/index.html');
assert.strictEqual(to(run(prod, '/', 'US', { cookies: { __client_uat: { value: '0' } } })), '-> /en'); // signed out

// Crawlers and link previews see every page.
for (const agent of ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'facebookexternalhit/1.1', 'WhatsApp/2.23', 'Mozilla/5.0 (compatible; bingbot/2.0)']) {
  assert.strictEqual(to(run(prod, '/', 'US', { agent })), '/index.html', agent);
  assert.strictEqual(to(run(prod, '/en', 'IL', { agent })), '/en/index.html', agent);
}
// No country or no user agent: nothing is routed.
assert.strictEqual(to(run(prod, '/', undefined)), '/index.html');
assert.strictEqual(to(run(prod, '/en', undefined)), '/en/index.html');
assert.strictEqual(to(run(prod, '/', 'US', { agent: null })), '/index.html');

// Staging (flag off) never routes by country.
const staging = load(false);
assert.strictEqual(to(run(staging, '/en', 'IL')), '/en/index.html');
assert.strictEqual(to(run(staging, '/', 'US')), '/index.html');
console.log('spa-rewrite ok');
