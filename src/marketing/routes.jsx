import Home from './pages/Home.jsx';

/**
 * Single source of truth for the marketing midsite: consumed by the SPA router
 * (PublicRoutes.jsx), and later by the prerender script, sitemap generator and
 * the standalone hydration entry. Must stay free of app imports and SSR-safe.
 *
 * seo: { title ≤60, description ≤155, canonical path } — full head assembly
 * (OG/JSON-LD/hreflang) lands with the prerender layer (Gate 5).
 */
export const SITE_URL = 'https://cortexi.ai';

export const marketingRoutes = [
  {
    path: '/',
    Component: Home,
    seo: {
      title: 'Cortexi — מערכת AI לניהול שיווק ומודיעין תחרותי לעסקים',
      description:
        'מערכת AI לניהול שיווק לעסקים קטנים: מעקב מתחרים, ניהול מוניטין, תובנות שוק ופעולות מוכנות לאישור — הכל בעברית. התחילו בחינם, תובנה ראשונה תוך 60 שניות.',
      canonical: '/',
    },
  },
  // Legacy alias — same component, canonical stays "/"
  {
    path: '/home',
    Component: Home,
    seo: {
      title: 'Cortexi — מערכת AI לניהול שיווק ומודיעין תחרותי לעסקים',
      description:
        'מערכת AI לניהול שיווק לעסקים קטנים: מעקב מתחרים, ניהול מוניטין, תובנות שוק ופעולות מוכנות לאישור — הכל בעברית. התחילו בחינם, תובנה ראשונה תוך 60 שניות.',
      canonical: '/',
      noSitemap: true,
    },
  },
];
