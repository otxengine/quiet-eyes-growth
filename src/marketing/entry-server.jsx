import React from 'react';
import { renderToString } from 'react-dom/server';
import MarketingLayout from './layout/MarketingLayout.jsx';
import { marketingRoutes, notFoundRoute } from './routes.jsx';
import { buildHead } from './seo/head.js';
import './styles/marketing.css';

/**
 * SSR entry for the prerender script (scripts/prerender.mjs).
 * render(path) → { html, head } for every marketing route + the 404.
 */
export function render(path) {
  const route =
    path === '/404'
      ? { ...notFoundRoute, path: '/404' }
      : marketingRoutes.find((r) => r.path === path);
  if (!route) throw new Error(`No marketing route for path: ${path}`);

  const Page = route.Component;
  const html = renderToString(
    <MarketingLayout seo={route.seo}>
      <Page />
    </MarketingLayout>
  );
  return { html, head: buildHead(route.seo) };
}

export { marketingRoutes };
