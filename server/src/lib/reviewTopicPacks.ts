/**
 * reviewTopicPacks.ts — KAN-122
 *
 * resolved_topic_set = CORE + REVIEW_TOPIC_PACKS[sector_key] + ≤3 onboarding extras
 *
 * AC-5: sector_profile.relevant_topics (market/trend interests) must NOT be passed here.
 *       Only explicitly supplied onboarding extras enter the resolver.
 */

export interface Aspect {
  id: string;
  label_he: string;
}

export const CORE_ASPECTS: Aspect[] = [
  { id: 'service',    label_he: 'שירות' },
  { id: 'price',      label_he: 'מחיר' },
  { id: 'quality',    label_he: 'איכות' },
  { id: 'cleanliness',label_he: 'ניקיון' },
  { id: 'atmosphere', label_he: 'אווירה' },
];

// v1 GTM sectors — Hebrew packs per PRD §5.2 Appendix A
export const REVIEW_TOPIC_PACKS: Record<string, Aspect[]> = {
  restaurant: [
    { id: 'food_quality',   label_he: 'איכות המזון' },
    { id: 'menu_variety',   label_he: 'מגוון תפריט' },
    { id: 'wait_time',      label_he: 'זמן המתנה' },
    { id: 'portion_size',   label_he: 'גודל מנה' },
    { id: 'freshness',      label_he: 'טריות' },
  ],
  beauty: [
    { id: 'results',               label_he: 'תוצאות' },
    { id: 'technique',             label_he: 'טכניקה' },
    { id: 'appointment_availability', label_he: 'זמינות תורים' },
    { id: 'product_quality',       label_he: 'איכות מוצרים' },
    { id: 'expertise',             label_he: 'מקצועיות' },
  ],
  fitness: [
    { id: 'trainers',          label_he: 'מאמנים' },
    { id: 'equipment',         label_he: 'ציוד' },
    { id: 'class_variety',     label_he: 'מגוון שיעורים' },
    { id: 'schedule_flexibility', label_he: 'גמישות לוח זמנים' },
    { id: 'fitness_results',   label_he: 'תוצאות' },
  ],
  medical: [
    { id: 'doctor_expertise',   label_he: 'מקצועיות רופא' },
    { id: 'medical_wait_time',  label_he: 'זמן המתנה' },
    { id: 'diagnosis_quality',  label_he: 'איכות אבחון' },
    { id: 'staff_attitude',     label_he: 'יחס הצוות' },
    { id: 'appointment_ease',   label_he: 'נוחות קביעת תור' },
  ],
  legal: [
    { id: 'legal_expertise',   label_he: 'מקצועיות' },
    { id: 'response_time',     label_he: 'זמן תגובה' },
    { id: 'communication',     label_he: 'תקשורת' },
    { id: 'value_for_money',   label_he: 'תמורה לכסף' },
    { id: 'outcome',           label_he: 'תוצאה' },
  ],
  retail: [
    { id: 'product_variety',    label_he: 'מגוון מוצרים' },
    { id: 'product_quality',    label_he: 'איכות מוצרים' },
    { id: 'staff_helpfulness',  label_he: 'סיוע הצוות' },
    { id: 'stock_availability', label_he: 'זמינות מלאי' },
    { id: 'return_policy',      label_he: 'מדיניות החזרות' },
  ],
  auto: [
    { id: 'repair_quality',      label_he: 'איכות תיקון' },
    { id: 'diagnosis_accuracy',  label_he: 'דיוק אבחון' },
    { id: 'auto_wait_time',      label_he: 'זמן המתנה' },
    { id: 'price_transparency',  label_he: 'שקיפות במחיר' },
    { id: 'warranty',            label_he: 'אחריות על עבודה' },
  ],
};

// Maps non-GTM sector keys to the closest GTM pack key
const SECTOR_CATEGORY_MAP: Record<string, string> = {
  health:     'medical',
  accounting: 'legal',
};

/**
 * Resolve the full topic set for a business.
 *
 * @param sectorKey        From sector_profile.sector_key
 * @param onboardingExtras ≤3 aspects the owner selected during onboarding
 *                         MUST NOT be sector_profile.relevant_topics — those are
 *                         market/trend interests, not review aspects (AC-5)
 */
export function resolveTopicSet(
  sectorKey: string,
  onboardingExtras: Aspect[] = [],
): Aspect[] {
  const resolvedKey = SECTOR_CATEGORY_MAP[sectorKey] ?? sectorKey;
  const pack = REVIEW_TOPIC_PACKS[resolvedKey] ?? [];
  const base = [...CORE_ASPECTS, ...pack];
  const taken = new Set(base.map(a => a.id));

  // AC-3: strip colliding extras; take first 3 survivors
  const validExtras = onboardingExtras
    .filter(e => e.id && e.label_he && !taken.has(e.id))
    .slice(0, 3);

  return [...base, ...validExtras];
}
