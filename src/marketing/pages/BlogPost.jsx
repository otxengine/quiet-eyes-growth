import React from 'react';
import { Container, CtaButton } from '../ui/primitives.jsx';
import { MODULES, featurePath } from '../content/modules.js';
import useReveal from '../lib/useReveal.js';

const formatDate = (iso) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });

/** Template for every /blog/[slug] page — content comes from content/blogPosts.js */
export default function BlogPost({ post }) {
  const revealRef = useReveal();
  const related = MODULES.filter((m) => post.relatedSlugs.includes(m.slug));

  return (
    <div ref={revealRef}>
      <Container className="max-w-2xl pt-14 md:pt-20 pb-24">
        {/* Breadcrumb */}
        <nav aria-label="פירורי לחם" className="text-[12.5px]" style={{ color: 'var(--mkt-muted)' }}>
          <a href="/" className="hover:underline">בית</a>
          <span aria-hidden="true"> / </span>
          <a href="/blog" className="hover:underline">בלוג</a>
        </nav>

        <article>
          <header>
            <h1 className="mt-4 text-[28px] md:text-[36px] leading-tight">{post.title}</h1>
            <div className="mt-3 flex items-center gap-3 text-[13px]" style={{ color: 'var(--mkt-muted)' }}>
              <time dateTime={post.datePublished}>{formatDate(post.datePublished)}</time>
              <span aria-hidden="true">·</span>
              <span>{post.readingMinutes} דקות קריאה</span>
              <span aria-hidden="true">·</span>
              <span>צוות Cortexi</span>
            </div>
          </header>

          <p className="mt-6 text-[16px] leading-relaxed font-medium" style={{ color: 'var(--mkt-ink-2)' }}>
            {post.intro}
          </p>

          {post.sections.map((section) => (
            <section key={section.h2} className="mt-9">
              <h2 className="text-[21px] leading-snug">{section.h2}</h2>
              {section.paras?.map((p) => (
                <p key={p.slice(0, 40)} className="mt-3 text-[15px] leading-[1.85]" style={{ color: 'var(--mkt-ink-2)' }}>
                  {p}
                </p>
              ))}
              {section.bullets && (
                <ul className="mt-4 space-y-2.5">
                  {section.bullets.map((b) => (
                    <li key={b.slice(0, 40)} className="flex items-start gap-2.5 text-[14.5px] leading-relaxed" style={{ color: 'var(--mkt-ink-2)' }}>
                      <span className="mt-[9px] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--mkt-ink)' }} aria-hidden="true" />
                      {b}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          {/* Related modules — internal links */}
          <aside className="mt-12 pt-8 border-t" style={{ borderColor: 'var(--mkt-border)' }}>
            <div className="text-[13px] font-bold mb-3" style={{ color: 'var(--mkt-muted)' }}>קשור במוצר</div>
            <div className="flex flex-wrap gap-2">
              {related.map((m) => (
                <a
                  key={m.slug}
                  href={featurePath(m.slug)}
                  className="rounded-full border bg-white px-4 py-2 text-[13px] font-bold hover:shadow-sm"
                  style={{ borderColor: 'var(--mkt-border-strong)', color: 'var(--mkt-ink)' }}
                >
                  {m.label}
                </a>
              ))}
            </div>
          </aside>

          {/* CTA */}
          <div className="mkt-card mt-8 p-7 text-center">
            <p className="text-[17px] font-bold">{post.ctaText}</p>
            <p className="mt-1.5 text-[13px]" style={{ color: 'var(--mkt-muted)' }}>
              תוכנית חינם לתמיד · בלי כרטיס אשראי · תובנה ראשונה תוך 60 שניות
            </p>
            <div className="mt-5">
              <CtaButton href="/sign-up" variant="gradient">התחילו בחינם</CtaButton>
            </div>
          </div>
        </article>

        <div className="mt-10 text-center">
          <a href="/blog" className="text-[14px] font-bold hover:underline" style={{ color: 'var(--mkt-ink)' }}>
            ← לכל המאמרים
          </a>
        </div>
      </Container>
    </div>
  );
}
