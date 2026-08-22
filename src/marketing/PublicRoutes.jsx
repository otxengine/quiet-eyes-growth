import React from 'react';
import { Route } from 'react-router-dom';
import MarketingLayout from './layout/MarketingLayout.jsx';
import { marketingRoutes } from './routes.jsx';

// Legacy public pages — migrated into src/marketing/pages/* gate by gate,
// then these imports (and the old files) are deleted.
import PublicLayout from '@/components/public/PublicLayout.jsx';
import HowItWorks from '@/pages/public/HowItWorks.jsx';
import Features from '@/pages/public/Features.jsx';
import PricingPage from '@/pages/public/Pricing.jsx';
import AboutPage from '@/pages/public/About.jsx';
import ContactPage from '@/pages/public/Contact.jsx';
import TermsPage from '@/pages/public/Terms.jsx';
import PrivacyPage from '@/pages/public/Privacy.jsx';
import DataDeletionPage from '@/pages/public/DataDeletion.jsx';

const LEGACY_ROUTES = [
  { path: '/how-it-works', element: <HowItWorks /> },
  { path: '/features', element: <Features /> },
  { path: '/pricing', element: <PricingPage /> },
  { path: '/about', element: <AboutPage /> },
  { path: '/contact', element: <ContactPage /> },
  { path: '/terms', element: <TermsPage /> },
  { path: '/privacy', element: <PrivacyPage /> },
  { path: '/data-deletion', element: <DataDeletionPage /> },
];

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
      <Route element={<PublicLayout />}>
        {LEGACY_ROUTES.map(({ path, element }) => (
          <Route key={path} path={path} element={element} />
        ))}
      </Route>
    </>
  );
}

const PUBLIC_PATHS = new Set([
  ...marketingRoutes.map((r) => r.path),
  ...LEGACY_ROUTES.map((r) => r.path),
]);

export function isPublicPath(pathname) {
  return PUBLIC_PATHS.has(pathname.replace(/\/+$/, '') || '/');
}
