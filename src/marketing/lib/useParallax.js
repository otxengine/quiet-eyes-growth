import { useEffect, useRef } from 'react';

/**
 * Scroll-linked parallax translate based on the element's position relative
 * to the viewport (rAF-throttled), not raw window.scrollY — correct no
 * matter where the hero sits on the page.
 *
 * speed: positive = element lags behind scroll (reads as background).
 *        negative = element leads scroll (reads as foreground).
 * clamp: max |px| offset.
 * No-ops entirely on the server, under prefers-reduced-motion, and <768px.
 */
export default function useParallax(speed = 0.1, { clamp = 32 } = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || speed === 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (window.matchMedia('(max-width: 767px)').matches) return;

    let ticking = false;
    let raf = null;

    const update = () => {
      ticking = false;
      const rect = el.getBoundingClientRect();
      const delta = window.innerHeight / 2 - (rect.top + rect.height / 2);
      const offset = Math.max(-clamp, Math.min(clamp, delta * speed));
      el.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      raf = requestAnimationFrame(update);
    };

    el.style.willChange = 'transform';
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
      el.style.transform = '';
      el.style.willChange = '';
    };
  }, [speed, clamp]);

  return ref;
}
