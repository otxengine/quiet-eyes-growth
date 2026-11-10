import React, { useEffect } from 'react';
import './../styles/tokens.css';
import Nav from './Nav.jsx';
import Footer from './Footer.jsx';
import { EnNav, EnFooter } from '../en/EnChrome.jsx';

/**
 * Shell for every marketing page. Takes children (not <Outlet/>) so the same
 * component serves both the SPA (via PublicRoutes) and the standalone
 * prerendered marketing bundle, without dragging react-router into the latter.
 * A route with seo.lang === 'en' gets the same shell left-to-right, with the English nav and footer.
 */
export default function MarketingLayout({ seo, children }) {
  const en = seo?.lang === 'en';

  // Inside the app (index.html is lang="he" dir="rtl") an English page flips the document while it
  // is mounted; the prerendered English files already carry lang="en" dir="ltr".
  useEffect(() => {
    if (!en) return undefined;
    const el = document.documentElement;
    const prev = { lang: el.lang, dir: el.dir };
    el.lang = 'en';
    el.dir = 'ltr';
    return () => { el.lang = prev.lang; el.dir = prev.dir; };
  }, [en]);

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
    <div className="mkt-root min-h-screen flex flex-col" dir={en ? 'ltr' : 'rtl'} lang={en ? 'en' : undefined}>
      {en ? <EnNav /> : <Nav />}
      <main className="flex-1">{children}</main>
      {en ? <EnFooter /> : <Footer />}
    </div>
  );
}
