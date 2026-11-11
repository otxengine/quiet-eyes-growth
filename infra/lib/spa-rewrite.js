// CloudFront viewer-request function (cloudfront-js-2.0). Mirrors the Render routes in render.yaml:
// prerendered marketing pages live at /<route>/index.html; any other path without a file
// extension is a client-side route and gets the SPA shell.
var MARKETING = ['/home', '/features', '/blog', '/pricing', '/about', '/contact', '/how-it-works', '/terms', '/privacy', '/refund-policy', '/data-deletion', '/en', '/en/terms', '/en/privacy'];

// ── Country routing (prod only: qe-stack.ts flips GEO_ROUTING; staging stays open for testing) ──
// Visitors in Israel get the Hebrew site, everyone else the English one (/en): the English product
// is not sold in Israel and the Hebrew app is not sold outside it.
//   Israel      + /en or /en/start            -> /
//   not Israel  + a Hebrew product page        -> /en
// Never redirected:
//   - signed-in users (Clerk cookies): "/" is their dashboard wherever they are, and a customer
//     travelling abroad must still reach it; /en/briefing (the English account) is not routed at all
//   - crawlers and link previews: Google crawls from the US and would drop the Hebrew pages
//   - blog, contact and legal pages, in either language (Meta and Paddle reviewers open /privacy
//     and /data-deletion from outside Israel; /en/terms and /en/privacy are linked from emails)
//   - a request with no country (the header needs CloudFront-Viewer-Country in the behaviour's
//     origin request policy)
var GEO_ROUTING = false;
var HEBREW_PRODUCT_PAGES = ['/', '/home', '/features', '/pricing', '/about', '/how-it-works'];
var CRAWLER = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|lighthouse|pagespeed|headless/i;

function redirectTo(location) {
  return { statusCode: 302, statusDescription: 'Found', headers: { location: { value: location }, 'cache-control': { value: 'no-store' } } };
}

function geoRedirect(request, uri) {
  var country = request.headers['cloudfront-viewer-country'];
  if (!country || !country.value) return null;
  var agent = request.headers['user-agent'];
  if (!agent || CRAWLER.test(agent.value)) return null;

  if (country.value === 'IL') return uri === '/en' || uri === '/en/start' ? redirectTo('/') : null;

  var cookies = request.cookies || {};
  var signedIn = !!cookies.__session || (!!cookies.__client_uat && cookies.__client_uat.value !== '0');
  var hebrewPage = HEBREW_PRODUCT_PAGES.indexOf(uri) !== -1 || /^\/features\/[^\/.]+$/.test(uri);
  return hebrewPage && !signedIn ? redirectTo('/en') : null;
}

function handler(event) {
  var request = event.request;
  var uri = request.uri.length > 1 ? request.uri.replace(/\/+$/, '') : request.uri;
  if (GEO_ROUTING) {
    var redirect = geoRedirect(request, uri);
    if (redirect) return redirect;
  }
  if (MARKETING.indexOf(uri) !== -1 || /^\/(features|blog)\/[^\/.]+$/.test(uri)) {
    request.uri = uri + '/index.html';
  } else if (uri.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}
