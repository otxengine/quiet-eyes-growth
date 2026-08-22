import React from 'react';
import Home from './pages/Home.jsx';
import Pricing from './pages/Pricing.jsx';
import About from './pages/About.jsx';
import Contact from './pages/Contact.jsx';
import HowItWorks from './pages/HowItWorks.jsx';
import FeaturesIndex from './pages/FeaturesIndex.jsx';
import FeaturePage from './pages/FeaturePage.jsx';
import NotFound from './pages/NotFound.jsx';
import { Terms, Privacy, DataDeletion } from './pages/Legal.jsx';
import { FEATURE_PAGES } from './content/featurePages.js';
import { PRICING_FAQ } from './content/pricing.js';

/**
 * Single source of truth for the marketing midsite: consumed by the SPA router
 * (PublicRoutes.jsx), and by the prerender script, sitemap generator and the
 * standalone hydration entry (Gate 5). Must stay free of app imports, SSR-safe.
 *
 * seo: { title ≤60, description ≤155, canonical } — titles/descriptions per
 * docs/midsite-content-audit.md §9. Full head assembly (OG/JSON-LD/hreflang)
 * lands with the prerender layer.
 */
export const SITE_URL = 'https://cortexi.ai';

const HOME_SEO = {
  title: 'Cortexi — מערכת AI לניהול שיווק ומודיעין תחרותי לעסקים',
  description:
    'מערכת AI לניהול שיווק לעסקים קטנים: מעקב מתחרים, ניהול מוניטין, תובנות שוק ופעולות מוכנות לאישור — הכל בעברית. התחילו בחינם, תובנה ראשונה תוך 60 שניות.',
  canonical: '/',
};

const featureRoutes = Object.entries(FEATURE_PAGES).map(([slug, data]) => ({
  path: `/features/${slug}`,
  Component: function FeatureRoute() {
    return <FeaturePage slug={slug} data={data} />;
  },
  seo: { ...data.seo, canonical: `/features/${slug}`, faqItems: data.faq },
}));

export const marketingRoutes = [
  { path: '/', Component: Home, seo: { ...HOME_SEO, jsonLd: 'software' } },
  // Legacy alias — canonical stays "/", excluded from sitemap
  { path: '/home', Component: Home, seo: { ...HOME_SEO, noSitemap: true } },
  {
    path: '/features',
    Component: FeaturesIndex,
    seo: {
      title: 'כל היכולות של Cortexi — 7 מודולים, מערכת אחת',
      description: 'מוניטין, מתחרים, תובנות, שיווק, סושיאל, מבצעים ואירועים — כל המודולים של Cortexi בעמוד אחד.',
      canonical: '/features',
    },
  },
  ...featureRoutes,
  {
    path: '/pricing',
    Component: Pricing,
    seo: {
      title: 'Cortexi מחיר — תוכניות מ-₪0, ללא התחייבות',
      description: 'תוכנית חינם לתמיד, Starter ‏₪149, Growth ‏₪349 ו-Pro ‏₪699 לסניף לחודש. ללא כרטיס אשראי, ביטול בכל עת.',
      canonical: '/pricing',
      jsonLd: 'pricing',
      faqItems: PRICING_FAQ,
    },
  },
  {
    path: '/about',
    Component: About,
    seo: {
      title: 'אודות Cortexi — מודיעין עסקי ברמת Enterprise לעסק קטן',
      description: 'למה בנינו את Cortexi: להביא לעסק הקטן בישראל יכולות מודיעין שיווקי ותחרותי שהיו שמורות לרשתות הגדולות.',
      canonical: '/about',
    },
  },
  {
    path: '/contact',
    Component: Contact,
    seo: {
      title: 'צור קשר — Cortexi',
      description: 'דברו איתנו על Cortexi: שאלות, הדגמה או הצטרפות. מענה תוך יום עסקים.',
      canonical: '/contact',
    },
  },
  {
    path: '/how-it-works',
    Component: HowItWorks,
    seo: {
      title: 'איך Cortexi עובדת — מהרשמה לתובנה ב-60 שניות',
      description: 'שלושה צעדים: מגדירים את העסק, המערכת סורקת ולומדת, ואתם מאשרים פעולות מוכנות.',
      canonical: '/how-it-works',
    },
  },
  {
    path: '/terms',
    Component: Terms,
    seo: { title: 'תנאי שימוש — Cortexi', description: 'תנאי השימוש בשירות Cortexi.', canonical: '/terms' },
  },
  {
    path: '/privacy',
    Component: Privacy,
    seo: { title: 'מדיניות פרטיות — Cortexi', description: 'מדיניות הפרטיות של Cortexi: איזה מידע נאסף, איך הוא נשמר ומה זכויותיך.', canonical: '/privacy' },
  },
  {
    path: '/data-deletion',
    Component: DataDeletion,
    seo: { title: 'מחיקת מידע — Cortexi', description: 'איך מבקשים מחיקת מידע מ-Cortexi, כולל נתוני חשבונות פייסבוק ואינסטגרם מחוברים.', canonical: '/data-deletion' },
  },
];

export const notFoundRoute = {
  Component: NotFound,
  seo: { title: 'העמוד לא נמצא — Cortexi', description: 'העמוד שחיפשת לא קיים.', noindex: true },
};
