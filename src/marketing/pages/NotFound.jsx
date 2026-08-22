import React from 'react';
import { Container, GradientText, CtaButton } from '../ui/primitives.jsx';

export default function NotFound() {
  return (
    <div className="relative">
      <div className="absolute inset-0 mkt-dotgrid mkt-dotgrid-fade" aria-hidden="true" />
      <Container className="relative py-28 md:py-36 text-center">
        <div className="text-[72px] md:text-[96px] font-extrabold leading-none" style={{ letterSpacing: '-0.02em' }}>
          4<GradientText>0</GradientText>4
        </div>
        <h1 className="mt-4 text-[24px] md:text-[30px]">את העמוד הזה עוד לא סרקנו</h1>
        <p className="mt-3 text-[15px]" style={{ color: 'var(--mkt-muted)' }}>
          הקישור שגוי או שהעמוד הועבר. הנה כמה מקומות טובים להמשיך מהם:
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <CtaButton href="/" variant="gradient">לעמוד הבית</CtaButton>
          <CtaButton href="/features" variant="ghost">כל היכולות</CtaButton>
          <CtaButton href="/pricing" variant="ghost">מחירים</CtaButton>
        </div>
      </Container>
    </div>
  );
}
