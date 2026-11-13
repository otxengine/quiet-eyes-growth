// Self-check for gtm.js — run: node src/lib/gtm.selfcheck.js
import { strict as assert } from 'node:assert';
import { track, paddleEcommerce } from './gtm.js';

globalThis.window = {};

// Shape of Paddle.js v2 checkout event data (synthetic values), personal data included
const paddleData = {
  transaction_id: 'txn_test',
  currency_code: 'USD',
  totals: { subtotal: 29, tax: 0, total: 29 },
  customer: { id: 'ctm_test', email: 'someone@example.com', address: { country_code: 'US', postal_code: '10001' } },
  items: [{ price_id: 'pri_test', price_name: 'Weekly', product: { id: 'pro_test', name: 'Cortexi Weekly' }, quantity: 1 }],
};

const ecommerce = paddleEcommerce(paddleData);
assert.deepEqual(ecommerce, {
  transaction_id: 'txn_test',
  value: 29,
  currency: 'USD',
  items: [{ item_id: 'pri_test', item_name: 'Cortexi Weekly', quantity: 1 }],
});
// Nothing personal leaks into what Google receives
assert.ok(!JSON.stringify(ecommerce).match(/example\.com|10001|ctm_test/), 'no customer data');
// Missing data does not throw and does not send NaN
assert.deepEqual(paddleEcommerce(undefined), { transaction_id: undefined, value: 0, currency: undefined, items: [] });

// Ecommerce pushes clear the previous ecommerce object first; plain events do not
track('purchase', { ecommerce });
track('sign_up', { market: 'he', method: 'account' });
assert.deepEqual(window.dataLayer, [
  { ecommerce: null },
  { event: 'purchase', ecommerce },
  { event: 'sign_up', market: 'he', method: 'account' },
]);

console.log('gtm selfcheck: ok');
