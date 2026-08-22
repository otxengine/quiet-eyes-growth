#!/usr/bin/env node
/**
 * Prerenders every marketing route to a real static HTML file under dist/,
 * and emits dist/sitemap.xml. Runs after both client builds:
 *
 *   vite build                                        → dist/ (app + marketing.html template)
 *   vite build --ssr src/marketing/entry-server.jsx   → dist-ssr/ (render fn)
 *   node scripts/prerender.mjs
 *
 * Output:
 *   dist/pricing/index.html, dist/features/reputation/index.html, …  (marketing template + lean bundle)
 *   dist/404.html                                                    (designed 404)
 *   dist/index.html                                                  (app shell, home head+markup injected)
 *   dist/sitemap.xml
 *
 * Render static hosting serves existing files before the SPA rewrite, so each
 * marketing URL gets its own head (title/canonical/OG/JSON-LD) and instant LCP,
 * while deep app routes still fall back to the app shell.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SSR_DIR = join(ROOT, 'dist-ssr');
const SITE_URL = 'https://cortexi.ai';

const ssrEntry = join(SSR_DIR, 'entry-server.js');
if (!existsSync(ssrEntry)) {
  console.error('dist-ssr/entry-server.js not found — run the full build (npm run build).');
  process.exit(1);
}
const { render, marketingRoutes } = await import(pathToFileURL(ssrEntry).href);

const template = readFileSync(join(DIST, 'marketing.html'), 'utf-8');
const fill = (tpl, head, html) =>
  tpl.replace('<!--app-head-->', head).replace('<!--app-html-->', html);

let count = 0;

for (const route of marketingRoutes) {
  const { html, head } = render(route.path);
  if (route.path === '/') {
    // dist/index.html stays the app shell (the SPA rewrite target) — inject the
    // home head+markup into it so "/" paints instantly and carries real SEO.
    const appShell = readFileSync(join(DIST, 'index.html'), 'utf-8');
    if (!appShell.includes('<!--app-head-->')) {
      throw new Error('index.html is missing the <!--app-head--> marker');
    }
    writeFileSync(join(DIST, 'index.html'), fill(appShell, head, html));
  } else {
    const outDir = join(DIST, route.path.slice(1));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'index.html'), fill(template, head, html));
  }
  count += 1;
}

// NOTE: intentionally NO dist/404.html — static hosts (incl. the local `serve`
// package) prefer a 404.html over the SPA rewrite, which would break hard
// refreshes on app routes like /dashboard. Unknown paths fall through the
// rewrite to the SPA, whose catch-all renders the designed marketing 404.

// sitemap.xml — canonical pages only (no /home alias, no noindex)
const today = new Date().toISOString().slice(0, 10);
const urls = marketingRoutes
  .filter((r) => !r.seo?.noSitemap && !r.seo?.noindex)
  .map((r) => `  <url><loc>${SITE_URL}${r.path === '/' ? '/' : r.path}</loc><lastmod>${today}</lastmod></url>`);
writeFileSync(
  join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
);

rmSync(SSR_DIR, { recursive: true, force: true });
console.log(`✓ prerendered ${count} routes + sitemap.xml (${urls.length} urls)`);
