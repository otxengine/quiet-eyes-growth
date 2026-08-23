/**
 * Pricing content — mirrors the Stripe-wired catalog exactly:
 * src/lib/planCatalog.js (display) + src/lib/planConfig.js (quotas) +
 * server/src/lib/stripe.ts (billing: price × branch count, monthly only).
 * Duplicated here (not imported) so the marketing bundle never touches app code.
 * If plans change — update BOTH files.
 */

export const PLANS = [
  {
    id: 'free_trial',
    name: 'חינם',
    description: 'להתנסות ראשונית',
    price: '₪0',
    period: 'לתמיד',
    cta: 'התחילו בחינם',
    features: [
      'Dashboard + בריף בוקר',
      'סריקה מלאה 1 לחודש',
      'עד 5 תובנות שוק',
      'עד 3 מתחרים',
      'פוסט AI 1 לחודש',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    description: 'לעסקים שמתחילים',
    price: '₪149',
    period: 'לסניף / לחודש',
    cta: 'התחילו בחינם',
    features: [
      'Dashboard + בריף בוקר',
      'ביקורות ומוניטין מלא',
      'עד 20 משימות',
      '4 סריקות מלאות לחודש',
      'עד 15 תובנות שוק',
      'עד 5 מתחרים',
      '5 פוסטים AI לחודש',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    description: 'לעסקים בצמיחה',
    price: '₪349',
    period: 'לסניף / לחודש',
    highlighted: true,
    cta: 'התחילו בחינם',
    features: [
      'משימות ללא הגבלה',
      '30 סריקות מלאות לחודש',
      'תובנות שוק ללא הגבלה',
      'עד 10 מתחרים + Battlecard',
      '30 פוסטים AI + 10 תמונות',
      'לידים חברתיים',
      'ניתוח מגמות ו-Viral Signals',
      'דוח שבועי + מרכז למידה',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'לעסקים מתקדמים',
    price: '₪699',
    period: 'לסניף / לחודש',
    cta: 'התחילו בחינם',
    features: [
      'כל מה שב-Growth',
      'סריקות ללא הגבלה',
      'מתחרים ללא הגבלה',
      'תמונות AI ללא הגבלה',
      'חיבור פייסבוק ואינסטגרם',
      'תמיכה Priority 4h',
      'Onboarding אישי',
    ],
  },
];

export const ENTERPRISE = {
  name: 'Enterprise',
  description: 'לרשתות, סוכנויות ומותגים עם צרכים מותאמים',
  bullets: ['ניהול ריבוי סניפים וסוכנות', 'SLA ו-Account Manager', 'תנאים מותאמים'],
  mailto: 'mailto:contact@cortexi.ai?subject=Enterprise%20Plan',
};

// From src/lib/planConfig.js — enforced server-side too (runFullScan.ts, entities.ts)
export const QUOTA_ROWS = [
  { label: 'סריקות מלאות בחודש', values: ['1', '4', '30', 'ללא הגבלה'] },
  { label: 'תובנות שוק פעילות', values: ['5', '15', 'ללא הגבלה', 'ללא הגבלה'] },
  { label: 'מתחרים במעקב', values: ['3', '5', '10', 'ללא הגבלה'] },
  { label: 'פוסטים AI בחודש', values: ['1', '5', '30', 'ללא הגבלה'] },
  { label: 'תמונות AI בחודש', values: ['—', '—', '10', 'ללא הגבלה'] },
  { label: 'לידים מרשתות חברתיות', values: ['—', '—', '✓', '✓'] },
  { label: 'ניתוח מגמות וסיגנלים ויראליים', values: ['—', '—', '✓', '✓'] },
  { label: 'דוח שבועי + Battlecard', values: ['—', '—', '✓', '✓'] },
  { label: 'חיבור פייסבוק ואינסטגרם', values: ['—', '—', '—', '✓'] },
  { label: 'תמיכה Priority + Onboarding אישי', values: ['—', '—', '—', '✓'] },
];

export const PRICING_FAQ = [
  {
    q: 'מה נחשב "סניף"?',
    a: 'מיקום עסקי אחד שהמערכת סורקת עבורו מתחרים, ביקורות ואותות. עסק עם כמה סניפים משלם לפי מספר הסניפים — כל סניף מקבל מעקב, מתחרים ותובנות משלו.',
  },
  {
    q: 'יש התחייבות או חוזה?',
    a: 'לא. החיוב חודשי, ואפשר לבטל בכל עת — הביטול נכנס לתוקף בסוף תקופת החיוב הנוכחית.',
  },
  {
    q: 'מה קורה כשנגמרת מכסת הסריקות החודשית?',
    a: 'הסריקות הידניות נעצרות עד תחילת החודש הבא, או עד שדרוג התוכנית. המעקב השוטף של המערכת ממשיך לרוץ ברקע.',
  },
  {
    q: 'התוכנית החינמית מוגבלת בזמן?',
    a: 'לא — היא חינם לתמיד, בלי כרטיס אשראי. היא מוגבלת בכמויות: סריקה אחת בחודש, עד 3 מתחרים ועד 5 תובנות.',
  },
  {
    q: 'יש קופוני הנחה?',
    a: 'כן — בעמוד התשלום אפשר להזין קוד קופון.',
  },
];
