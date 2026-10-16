// CloudFront viewer-request function (cloudfront-js-2.0). Mirrors the Render routes in render.yaml:
// prerendered marketing pages live at /<route>/index.html; any other path without a file
// extension is a client-side route and gets the SPA shell.
var MARKETING = ['/home', '/features', '/blog', '/pricing', '/about', '/contact', '/how-it-works', '/terms', '/privacy', '/data-deletion'];

function handler(event) {
  var request = event.request;
  var uri = request.uri.length > 1 ? request.uri.replace(/\/+$/, '') : request.uri;
  if (MARKETING.indexOf(uri) !== -1 || /^\/(features|blog)\/[^\/.]+$/.test(uri)) {
    request.uri = uri + '/index.html';
  } else if (uri.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}
