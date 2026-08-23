import React from 'react';
import { Container, Section, GradientText, CtaButton } from '../ui/primitives.jsx';
import { BLOG_POSTS, blogPath } from '../content/blogPosts.js';
import useReveal from '../lib/useReveal.js';

const formatDate = (iso) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });

export default function Blog() {
  const revealRef = useReveal();

  return (
    <div ref={revealRef}>
      <div className="relative">
        <div className="absolute inset-0 mkt-dotgrid mkt-dotgrid-fade" aria-hidden="true" />
        <Container className="relative pt-16 md:pt-24 pb-12 text-center">
          <h1 className="text-[32px] md:text-[44px] leading-tight">
            הבלוג של <GradientText>Cortexi</GradientText>
          </h1>
          <p className="mt-4 text-[15.5px] max-w-xl mx-auto" style={{ color: 'var(--mkt-ink-2)' }}>
            מדריכים מעשיים לשיווק, מוניטין ולידים לעסקים קטנים — בלי באזוורדס, בלי הבטחות ריקות.
          </p>
        </Container>
      </div>

      <Section className="!pt-4 pb-24">
        <Container className="max-w-3xl">
          <div className="space-y-5">
            {BLOG_POSTS.map((post) => (
              <a
                key={post.slug}
                href={blogPath(post.slug)}
                className="mkt-card mkt-reveal block p-7 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
              >
                <div className="flex items-center gap-3 text-[12px]" style={{ color: 'var(--mkt-muted)' }}>
                  <time dateTime={post.datePublished}>{formatDate(post.datePublished)}</time>
                  <span aria-hidden="true">·</span>
                  <span>{post.readingMinutes} דקות קריאה</span>
                </div>
                <h2 className="mt-2 text-[20px] leading-snug">{post.title}</h2>
                <p className="mt-2 text-[14px] leading-relaxed" style={{ color: 'var(--mkt-ink-2)' }}>
                  {post.description}
                </p>
                <span className="mt-4 inline-block text-[13.5px] font-bold" style={{ color: 'var(--mkt-ink)' }}>
                  לקריאה ←
                </span>
              </a>
            ))}
          </div>

          <div className="text-center mt-14 mkt-reveal">
            <CtaButton href="/sign-up" variant="gradient">נסו את Cortexi בחינם</CtaButton>
          </div>
        </Container>
      </Section>
    </div>
  );
}
