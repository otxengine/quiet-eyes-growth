import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import MarketingLayout from './layout/MarketingLayout.jsx';
import { marketingRoutes, notFoundRoute } from './routes.jsx';
import './styles/marketing.css';

/**
 * Hydration entry for the prerendered static marketing pages. No router —
 * navigation between marketing pages is real <a> navigation to real files,
 * which keeps this bundle to react + react-dom + page code.
 */
const path = window.location.pathname.replace(/\/+$/, '') || '/';
const route = marketingRoutes.find((r) => r.path === path) || notFoundRoute;
const Page = route.Component;

hydrateRoot(
  document.getElementById('root'),
  <MarketingLayout seo={route.seo}>
    <Page />
  </MarketingLayout>
);
