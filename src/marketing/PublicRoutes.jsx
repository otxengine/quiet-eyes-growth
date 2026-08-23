import React from 'react';
import { Route } from 'react-router-dom';
import MarketingLayout from './layout/MarketingLayout.jsx';
import { marketingRoutes, notFoundRoute } from './routes.jsx';

/**
 * The public route set, shared by all three route trees in App.jsx.
 * includeRoot=false in the authenticated tree, where "/" belongs to Dashboard.
 */
export function publicRoutes({ includeRoot = true } = {}) {
  return (
    <>
      {marketingRoutes
        .filter((r) => includeRoot || r.path !== '/')
        .map(({ path, Component, seo }) => (
          <Route
            key={path}
            path={path}
            element={
              <MarketingLayout seo={seo}>
                <Component />
              </MarketingLayout>
            }
          />
        ))}
    </>
  );
}

/** Designed 404 in the marketing shell — the catch-all for the public trees. */
export function marketingNotFound() {
  const NF = notFoundRoute.Component;
  return (
    <MarketingLayout seo={notFoundRoute.seo}>
      <NF />
    </MarketingLayout>
  );
}

const PUBLIC_PATHS = new Set(marketingRoutes.map((r) => r.path));

export function isPublicPath(pathname) {
  return PUBLIC_PATHS.has(pathname.replace(/\/+$/, '') || '/');
}
