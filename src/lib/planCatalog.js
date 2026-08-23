/**
 * planCatalog.js — Shared plan display metadata (name/price/features).
 * Single source for anywhere that renders a plan picker: Subscription.jsx,
 * the onboarding plan-selection step. Usage limits live in planConfig.js;
 * this file is presentation only.
 */

export const PLAN_CATALOG = [
  {
    id: 'free_trial',
    name: 'חינם',
    description: 'להתנסות ראשונית',
    price: '₪0',
    period: 'לתמיד',
    features: [
      'Dashboard + Morning Briefing',
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
    period: 'סניף/חודש',
    features: [
      'Dashboard + Morning Briefing',
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
    period: 'סניף/חודש',
    highlighted: true,
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
    period: 'סניף/חודש',
    features: [
      'כל מה שב-Growth',
      'סריקות ללא הגבלה',
      'מתחרים ללא הגבלה',
      'תמונות AI ללא הגבלה',
      'אינטגרציות FB/IG/Apify',
      'תמיכה Priority 4h',
      'Onboarding אישי',
    ],
  },
];
