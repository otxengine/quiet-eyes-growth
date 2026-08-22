import { useEffect, useRef } from 'react';

/**
 * Adds `is-visible` to elements marked `.mkt-reveal` inside the ref'd container
 * when they enter the viewport. SSR-safe (runs only in useEffect); under
 * prefers-reduced-motion the CSS keeps everything visible with no transition.
 */
export default function useReveal() {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const targets = root.querySelectorAll('.mkt-reveal');
    if (!targets.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15 }
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);

  return ref;
}
