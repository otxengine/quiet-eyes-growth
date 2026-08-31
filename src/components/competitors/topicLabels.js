// Hebrew labels for Review.topic_sentiment topic ids (service, price, quality, etc.)
// — the AI-extracted review theme taxonomy, shared by every UI that shows
// per-topic sentiment (TopicTimelineWidget, the review topics radar).
export const TOPIC_HE = {
  service: 'שירות', price: 'מחיר', quality: 'איכות', cleanliness: 'ניקיון',
  atmosphere: 'אווירה', availability: 'זמינות', delivery: 'משלוח',
  food_quality: 'איכות המזון', menu_variety: 'מגוון תפריט', wait_time: 'זמן המתנה',
  portion_size: 'גודל מנה', freshness: 'טריות', results: 'תוצאות',
  technique: 'טכניקה', appointment_availability: 'זמינות תורים',
  product_quality: 'איכות מוצרים', expertise: 'מקצועיות',
  trainers: 'מאמנים', equipment: 'ציוד', class_variety: 'מגוון שיעורים',
  schedule_flexibility: 'גמישות לוח זמנים', doctor_expertise: 'מקצועיות רופא',
  medical_wait_time: 'זמן המתנה', diagnosis_quality: 'איכות אבחון',
  staff_attitude: 'יחס הצוות', appointment_ease: 'נוחות קביעת תור',
  legal_expertise: 'מקצועיות', response_time: 'זמן תגובה', communication: 'תקשורת',
  value_for_money: 'תמורה לכסף', outcome: 'תוצאה', product_variety: 'מגוון מוצרים',
  staff_helpfulness: 'סיוע הצוות', stock_availability: 'זמינות מלאי',
  return_policy: 'מדיניות החזרות', repair_quality: 'איכות תיקון',
  diagnosis_accuracy: 'דיוק אבחון', auto_wait_time: 'זמן המתנה',
  price_transparency: 'שקיפות במחיר', warranty: 'אחריות על עבודה',
};

export const th = id => TOPIC_HE[id] || id;
