import React from 'react';
import Home from './pages/Home.jsx';
import Pricing from './pages/Pricing.jsx';
import About from './pages/About.jsx';
import Contact from './pages/Contact.jsx';
import HowItWorks from './pages/HowItWorks.jsx';
import FeaturesIndex from './pages/FeaturesIndex.jsx';
import FeaturePage from './pages/FeaturePage.jsx';
import NotFound from './pages/NotFound.jsx';
import Blog from './pages/Blog.jsx';
import BlogPost from './pages/BlogPost.jsx';
import { Terms, Privacy, RefundPolicy, DataDeletion } from './pages/Legal.jsx';
import { FEATURE_PAGES } from './content/featurePages.js';
import { PRICING_FAQ } from './content/pricing.js';
import { BLOG_POSTS, postPath } from './content/blogPosts.js';

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

// Keyword targets per docs/keyword-research.md: שיווק דיגיטלי (1,900/חודש),
// בינה מלאכותית לעסקים (110), אוטומציות לעסקים (590)
const HOME_SEO = {
  title: 'Cortexi — מערכת AI לשיווק דיגיטלי וניהול מוניטין לעסקים',
  description:
    'Cortexi: מערכת AI לאוטומציה שיווקית וניהול מוניטין לעסקים קטנים — מעקב מתחרים, ביקורות גוגל, לידים ופעולות מוכנות לאישור, בעברית.',
  canonical: '/',
};

const featureRoutes = Object.entries(FEATURE_PAGES).map(([slug, data]) => ({
  path: `/features/${slug}`,
  Component: function FeatureRoute() {
    return <FeaturePage slug={slug} data={data} />;
  },
  seo: {
    ...data.seo,
    canonical: `/features/${slug}`,
    faqItems: data.faq,
    breadcrumbs: [
      { name: 'בית', path: '/' },
      { name: 'יכולות', path: '/features' },
      { name: data.label, path: `/features/${slug}` },
    ],
  },
}));

// Pillar posts (e.g. /automation) carry their own path and skip the /blog breadcrumb.
const blogRoutes = BLOG_POSTS.map((post) => {
  const path = postPath(post);
  return {
    path,
    Component: function BlogPostRoute() {
      return <BlogPost post={post} />;
    },
    seo: {
      title: post.seoTitle,
      description: post.description,
      canonical: path,
      faqItems: post.faq,
      article: {
        headline: post.title,
        description: post.description,
        datePublished: post.datePublished,
        dateModified: post.dateModified,
      },
      breadcrumbs: [
        { name: 'בית', path: '/' },
        ...(post.pillar ? [] : [{ name: 'בלוג', path: '/blog' }]),
        { name: post.title, path },
      ],
    },
  };
});

export const marketingRoutes = [
  { path: '/', Component: Home, seo: { ...HOME_SEO, jsonLd: 'software' } },
  {
    path: '/blog',
    Component: Blog,
    seo: {
      title: 'הבלוג של Cortexi — מדריכי שיווק ומוניטין לעסקים קטנים',
      description: 'מדריכים מעשיים לעסקים קטנים: אוטומציה, ניהול מוניטין וביקורות גוגל, לידים ובחירת תוכנה לניהול עסק.',
      canonical: '/blog',
      breadcrumbs: [
        { name: 'בית', path: '/' },
        { name: 'בלוג', path: '/blog' },
      ],
    },
  },
  ...blogRoutes,
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
      description: 'תוכנית חינם לתמיד, Starter ‏₪149, Growth ‏₪499 ו-Pro ‏₪899 לסניף לחודש. ללא כרטיס אשראי, ביטול בכל עת.',
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
    path: '/refund-policy',
    Component: RefundPolicy,
    seo: { title: 'מדיניות החזרים — Cortexi', description: 'החזר כספי מלא תוך 14 יום מכל חיוב, דרך Paddle.com.', canonical: '/refund-policy' },
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
