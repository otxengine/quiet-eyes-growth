import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';

/*
 * Faithful replica of the product home screen (src/pages/Dashboard.jsx):
 * gradient Kori avatar, the greeting, the pill prompt, and the four real
 * quick-action chips. The typing animation cycles real prompts; under
 * prefers-reduced-motion (or before hydration) the first prompt shows in full.
 */

// Approved in the content audit — 1-2 are verbatim from Dashboard.jsx
const TYPED_PROMPTS = [
  'תעשה לי מחקר שוק קצר על העסק שלי',
  'כתוב תגובה לביקורת החדשה בגוגל',
  'בנה לי קמפיין לפסח',
  'תסכם לי את השבוע — מה קרה, מה הישגים, מה הצעדים הבאים',
];

// Verbatim from Dashboard.jsx quickChips
const QUICK_CHIPS = ['בנה קמפיין חדש', 'בצע מחקר שוק', 'הצג פעולות לאישור', 'סכם לי את השבוע'];

const TYPE_MS = 55;
const DELETE_MS = 22;
const HOLD_MS = 1800;

function useTypedText(phrases) {
  // SSR/static frame: the full first phrase — no hydration mismatch, good LCP.
  const [text, setText] = useState(phrases[0]);
  const [animating, setAnimating] = useState(false);
  const state = useRef({ phrase: 0, char: phrases[0].length, deleting: false });

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setAnimating(true);
    let timer;
    const tick = () => {
      const s = state.current;
      const current = phrases[s.phrase];
      if (!s.deleting) {
        s.char += 1;
        setText(current.slice(0, s.char));
        if (s.char >= current.length) {
          s.deleting = true;
          timer = setTimeout(tick, HOLD_MS);
          return;
        }
        timer = setTimeout(tick, TYPE_MS);
      } else {
        s.char -= 1;
        setText(current.slice(0, s.char));
        if (s.char <= 0) {
          s.deleting = false;
          s.phrase = (s.phrase + 1) % phrases.length;
        }
        timer = setTimeout(tick, DELETE_MS);
      }
    };
    timer = setTimeout(tick, HOLD_MS);
    return () => clearTimeout(timer);
  }, [phrases]);

  return { text, animating };
}

export default function HeroProductReplica() {
  const { text, animating } = useTypedText(TYPED_PROMPTS);

  return (
    <div
      className="mkt-card w-full max-w-2xl mx-auto p-6 md:p-8 shadow-[0_20px_60px_-25px_rgba(16,16,20,0.25)]"
      role="img"
      aria-label="הדגמה של מסך הבית של Cortexi: שדה פקודה חופשי ופעולות מהירות"
    >
      {/* Kori avatar + greeting, as in the product */}
      <div className="flex flex-col items-center text-center">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold select-none shadow-md"
          style={{ background: 'var(--mkt-grad)' }}
          aria-hidden="true"
        >
          ק
        </div>
        <p className="mt-4 text-[15px] font-medium" style={{ color: 'var(--mkt-muted)' }}>
          בוקר טוב 👋
        </p>
        <p className="mt-1 text-[21px] md:text-[23px] font-bold" style={{ color: 'var(--mkt-ink)' }}>
          מה תרצה לבצע בעסק שלך היום?
        </p>
      </div>

      {/* Prompt pill with typing animation */}
      <div
        className="mt-6 flex items-center gap-3 rounded-full border bg-white ps-5 pe-2 h-[52px] shadow-sm"
        style={{ borderColor: 'var(--mkt-border-strong)' }}
      >
        <span className="flex-1 text-[14.5px] truncate text-right" style={{ color: 'var(--mkt-ink-2)' }} aria-hidden="true">
          {text}
          {animating && <span className="mkt-caret ms-0.5" />}
        </span>
        <span
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          style={{ background: 'var(--mkt-ink)' }}
          aria-hidden="true"
        >
          <ChevronLeft size={18} color="#fff" />
        </span>
      </div>

      {/* Quick-action chips — verbatim from the product */}
      <div className="mt-4 flex flex-wrap justify-center gap-2" aria-hidden="true">
        {QUICK_CHIPS.map((chip) => (
          <span
            key={chip}
            className="rounded-full border bg-white px-4 py-2 text-[12.5px] font-medium"
            style={{ borderColor: 'var(--mkt-border)', color: 'var(--mkt-ink-2)' }}
          >
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}
