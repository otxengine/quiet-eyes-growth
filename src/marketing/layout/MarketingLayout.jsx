import React, { useEffect } from 'react';
import './../styles/tokens.css';
import Nav from './Nav.jsx';
import Footer from './Footer.jsx';

/**
 * Shell for every marketing page. Takes children (not <Outlet/>) so the same
 * component serves both the SPA (via PublicRoutes) and the standalone
 * prerendered marketing bundle, without dragging react-router into the latter.
 */
export default function MarketingLayout({ seo, children }) {
  // Keeps the head correct on in-SPA client navigation; the prerendered static
  // files carry the full head server-side.
  useEffect(() => {
    if (!seo) return;
    if (seo.title) document.title = seo.title;
    if (seo.description) {
      let tag = document.querySelector('meta[name="description"]');
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('name', 'description');
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', seo.description);
    }
  }, [seo]);

  return (
    <div className="mkt-root min-h-screen flex flex-col" dir="rtl">
      <Nav />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
