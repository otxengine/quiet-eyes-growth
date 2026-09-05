// Hebrew label maps for the coded offer-analysis fields (offer_mechanic,
// offer_value_framing, offer_audience_intent — see server/src/lib/offerStats.ts).
// Hoisted out of CompetitorsOffers.jsx so OffersPillarSection.jsx (Insights
// page) can share them without duplicating the Hebrew copy.

export const OFFER_MECHANIC_LABELS = {
  percent_discount: '% הנחה', fixed_amount: 'הנחה קבועה', bogo: 'קנה קבל',
  free_shipping: 'משלוח חינם', bundle: 'באנדל', gift_with_purchase: 'מתנה בקנייה',
  free_trial: 'ניסיון חינם', giveaway: 'הגרלה', loyalty_perk: 'הטבת מועדון', other: 'אחר',
};

export const AUDIENCE_INTENT_LABELS = {
  new_customer: 'לקוחות חדשים', retention: 'שימור לקוחות', reactivation: 'הפעלה מחדש',
  list_building: 'גיוס לרשימה', general: 'כללי',
};

export const VALUE_FRAMING_LABELS = { relative: 'הנחה יחסית (%)', absolute: 'הנחה מוחלטת (₪)', both: 'יחסית ומוחלטת' };

export const CHANNEL_LABELS = { organic: 'אורגני', paid: 'ממומן' };
