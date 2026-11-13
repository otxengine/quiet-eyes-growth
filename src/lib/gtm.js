/**
 * gtm.js — conversion events for Google Tag Manager (GTM-5DTZ9QKC, loaded by index.html and
 * marketing.html on the prod hosts only; elsewhere these pushes land in an array nobody reads).
 * GTM forwards them to GA4, where sign_up / generate_lead / purchase are key events.
 *
 * Never put personal data in an event: no emails, names, business names, addresses or URLs
 * that carry them. Ids, plan, amounts, currency and market (he | en) are fine.
 */
export function track(event, params = {}) {
  window.dataLayer = window.dataLayer || [];
  // GA4 merges ecommerce objects across pushes unless the previous one is cleared first.
  if (params.ecommerce) window.dataLayer.push({ ecommerce: null });
  window.dataLayer.push({ event, ...params });
}

// Paddle checkout event data → GA4 ecommerce object. Picks ids and amounts only: Paddle's data
// also carries the customer's email and address, which must not reach Google.
export function paddleEcommerce(data) {
  return {
    transaction_id: data?.transaction_id,
    value: Number(data?.totals?.total) || 0,
    currency: data?.currency_code,
    items: (data?.items || []).map((i) => ({
      item_id: i.price_id,
      item_name: i.product?.name || i.price_name,
      quantity: i.quantity,
    })),
  };
}
