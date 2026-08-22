import { SITE_URL } from '../routes.jsx';

/**
 * Builds the full <head> block for a marketing route at prerender time.
 * hreflang is subdirectory-ready: today he + x-default point at the he URL;
 * when /en/ ships, add an en-US alternate here — no page changes needed.
 */

const ORGANIZATION = {
  '@type': 'Organization',
  '@id': `${SITE_URL}/#organization`,
  name: 'Cortexi',
  alternateName: 'קורטקסי',
  url: SITE_URL,
  logo: `${SITE_URL}/logo/cortexi-logo.png`,
  slogan: 'Inspired by the brain. Built for intelligence.',
  email: 'contact@cortexi.ai',
};

const WEBSITE = {
  '@type': 'WebSite',
  '@id': `${SITE_URL}/#website`,
  name: 'Cortexi',
  url: SITE_URL,
  inLanguage: 'he',
  publisher: { '@id': `${SITE_URL}/#organization` },
};

const SOFTWARE_APPLICATION = {
  '@type': 'SoftwareApplication',
  name: 'Cortexi',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  inLanguage: 'he',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'ILS' },
};

// Mirrors src/marketing/content/pricing.js (the Stripe-wired catalog)
const PRICING_PRODUCT = {
  '@type': 'Product',
  name: 'Cortexi',
  description: 'מערכת AI לניהול שיווק ומודיעין תחרותי לעסקים קטנים',
  brand: { '@id': `${SITE_URL}/#organization` },
  offers: [
    { name: 'חינם', price: '0' },
    { name: 'Starter', price: '149' },
    { name: 'Growth', price: '349' },
    { name: 'Pro', price: '699' },
  ].map((o) => ({
    '@type': 'Offer',
    name: o.name,
    price: o.price,
    priceCurrency: 'ILS',
    url: `${SITE_URL}/pricing`,
    availability: 'https://schema.org/InStock',
  })),
};

const faqJsonLd = (items) => ({
  '@type': 'FAQPage',
  mainEntity: items.map((it) => ({
    '@type': 'Question',
    name: it.q,
    acceptedAnswer: { '@type': 'Answer', text: it.a },
  })),
});

const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function buildHead(seo) {
  const canonical = `${SITE_URL}${seo.canonical === '/' ? '/' : seo.canonical || '/'}`;
  const ogImage = `${SITE_URL}/og/og-default.png`;

  const graph = [ORGANIZATION, WEBSITE];
  graph.push({
    '@type': 'WebPage',
    '@id': `${canonical}#webpage`,
    url: canonical,
    name: seo.title,
    description: seo.description,
    inLanguage: 'he',
    isPartOf: { '@id': `${SITE_URL}/#website` },
  });
  if (seo.breadcrumbs?.length) {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: seo.breadcrumbs.map((b, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: b.name,
        item: `${SITE_URL}${b.path === '/' ? '/' : b.path}`,
      })),
    });
  }
  if (seo.jsonLd === 'software') graph.push(SOFTWARE_APPLICATION);
  if (seo.jsonLd === 'pricing') graph.push(PRICING_PRODUCT);
  if (seo.faqItems?.length) graph.push(faqJsonLd(seo.faqItems));
  if (seo.article) {
    graph.push({
      '@type': 'BlogPosting',
      headline: seo.article.headline,
      description: seo.article.description,
      datePublished: seo.article.datePublished,
      dateModified: seo.article.dateModified || seo.article.datePublished,
      inLanguage: 'he',
      image: `${SITE_URL}/og/og-default.png`,
      author: { '@id': `${SITE_URL}/#organization` },
      publisher: { '@id': `${SITE_URL}/#organization` },
      mainEntityOfPage: { '@id': `${canonical}#webpage` },
    });
  }

  const lines = [
    `<title>${esc(seo.title)}</title>`,
    `<meta name="description" content="${esc(seo.description)}" />`,
    seo.noindex
      ? `<meta name="robots" content="noindex, follow" />`
      : `<meta name="robots" content="index, follow, max-image-preview:large" />`,
    `<link rel="canonical" href="${canonical}" />`,
    // hreflang — he today, /en/ slot ready for the future
    `<link rel="alternate" hreflang="he" href="${canonical}" />`,
    `<link rel="alternate" hreflang="x-default" href="${canonical}" />`,
    // Open Graph
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Cortexi" />`,
    `<meta property="og:locale" content="he_IL" />`,
    `<meta property="og:title" content="${esc(seo.title)}" />`,
    `<meta property="og:description" content="${esc(seo.description)}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:image" content="${ogImage}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    // Twitter
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(seo.title)}" />`,
    `<meta name="twitter:description" content="${esc(seo.description)}" />`,
    `<meta name="twitter:image" content="${ogImage}" />`,
    `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>`,
  ];
  return lines.join('\n    ');
}
