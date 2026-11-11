// Self-check for appLayoutView — run: node src/lib/appLayoutView.selfcheck.js
import { strict as assert } from 'node:assert';
import { appLayoutView, retryAfterSeconds, pickAppProfile } from './appLayoutView.js';

const err = (status, extra) => Object.assign(new Error('x'), { status, ...extra });
const loaded = { loading: false, error: null, profilesLoaded: true, hasProfile: true, fromOnboarding: false };

// Failures never reach onboarding, even though no profile is known
for (const [name, e] of [['429', err(429)], ['500', err(500)], ['timeout', err(408)], ['network', new TypeError('Failed to fetch')]]) {
  assert.equal(appLayoutView({ ...loaded, error: e, profilesLoaded: false, hasProfile: false }), 'error', `${name} on /me`);
  assert.equal(appLayoutView({ ...loaded, error: e, hasProfile: false }), 'error', `${name} on profiles/orgs`);
}
assert.equal(appLayoutView({ ...loaded, error: err(401), hasProfile: false }), 'signin', '401 goes to sign-in');

// Only a successful, empty profile list means "no business yet"
assert.equal(appLayoutView({ ...loaded, hasProfile: false }), 'onboarding', '200 with no profile');
assert.equal(appLayoutView({ ...loaded, hasProfile: false, fromOnboarding: true }), 'app', 'just onboarded: wait for the new profile');
assert.equal(appLayoutView({ ...loaded, profilesLoaded: false, hasProfile: false }), 'app', 'profiles never fetched is not "empty"');
assert.equal(appLayoutView(loaded), 'app', '200 with a profile stays');
assert.equal(appLayoutView({ ...loaded, loading: true, error: err(500) }), 'loading', 'retrying shows the spinner');

assert.equal(retryAfterSeconds(err(429, { retryAfter: 120 })), 120, 'Retry-After honoured');
assert.equal(retryAfterSeconds(err(429)), 30, 'fallback when the header is missing');
assert.equal(retryAfterSeconds(err(500)), 0, 'only 429 waits');

// A user with both an app business and a newer English report-only one opens the app business
const he = { id: 'he', subscription_plan: 'pro', onboarding_completed: true };
const en = { id: 'en', subscription_plan: 'brief_monthly', onboarding_completed: true };
assert.equal(pickAppProfile([en, he]).id, 'he', 'app business wins over a newer report-only one');
assert.equal(pickAppProfile([en]).id, 'en', 'report-only business alone is still picked (then redirected)');
assert.equal(pickAppProfile([{ id: 'new', subscription_plan: 'free_trial' }, he]).id, 'he', 'onboarded first');
assert.equal(pickAppProfile([{ id: 'new' }, en]).id, 'new', 'an unfinished app business beats a report-only one');
assert.equal(pickAppProfile([]), undefined);
assert.equal(pickAppProfile(undefined), undefined);

console.log('appLayoutView self-check passed');
