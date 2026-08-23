#!/usr/bin/env node
/**
 * Minimal static server with Render's exact semantics for local Lighthouse runs:
 * serve an existing file (or dir/index.html) first; otherwise rewrite to
 * /index.html ("Render does not apply rewrite rules to a path if a resource
 * exists at that path"). Gzips text responses like production.
 *
 *   node scripts/static-server.mjs [port]   (default 5399, serves dist/)
 */
import http from 'node:http';
import { statSync, readFileSync, existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = join(process.cwd(), 'dist');
const PORT = Number(process.argv[2]) || 5399;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};
const GZIP = new Set(['.html', '.js', '.css', '.json', '.svg', '.xml', '.txt']);

function resolveFile(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^([/\\])+/, '');
  const base = join(DIST, clean);
  if (!base.startsWith(DIST)) return null;
  for (const candidate of [base, join(base, 'index.html')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

http
  .createServer((req, res) => {
    const file = resolveFile(req.url) || join(DIST, 'index.html'); // Render's /* rewrite
    const ext = extname(file).toLowerCase();
    let body = readFileSync(file);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (GZIP.has(ext) && /gzip/.test(req.headers['accept-encoding'] || '')) {
      body = gzipSync(body);
      headers['Content-Encoding'] = 'gzip';
    }
    res.writeHead(200, headers);
    res.end(body);
  })
  .listen(PORT, () => console.log(`static (render-parity) on http://localhost:${PORT}`));
