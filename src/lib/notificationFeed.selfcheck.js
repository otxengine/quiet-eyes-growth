// Self-check for buildNotificationFeed — run: node src/lib/notificationFeed.selfcheck.js
// Kept out of notificationFeed.js so nothing node-only reaches the browser bundle.
import { strict as assert } from 'node:assert';
import { buildNotificationFeed } from './notificationFeed.js';

const iso = (d) => new Date(d).toISOString();
const now = Date.parse('2026-01-10T12:00:00Z');

const feed = buildNotificationFeed({
  now,
  competitors: [{ id: 'c1', name: 'פיצה כהן' }],
  pendingReviews:    [{ id: 'r1', rating: 2, reviewer_name: 'דנה', created_at: iso('2026-01-09') }],
  competitorReviews: [{ id: 'r2', rating: 5, linked_competitor: 'c1', created_at: iso('2026-01-08') }],
  competitorPosts:   [{ id: 'p1', competitor_id: 'c1', has_offer: true, first_seen_at: iso('2026-01-07') },
                      { id: 'p2', competitor_id: 'c1', has_offer: null, first_seen_at: iso('2026-01-06') }],
  competitorAds:     [{ id: 'a1', competitor_id: 'c1', has_offer: false, first_seen_at: iso('2026-01-05') }],
  pageVisits: { '/reviews': Date.parse('2026-01-09T12:00:00Z') }, // after r1 arrived -> read
});

assert.deepEqual(feed.map((n) => n.id),
  ['rev-r1', 'crev-r2', 'post-p1', 'post-p2', 'ad-a1'], 'newest first');
assert.equal(feed[0].unread, false, 'visited /reviews after the review arrived');
assert.equal(feed[1].unread, true, 'never visited /reviews/compare');
assert.equal(feed.find((n) => n.id === 'post-p1').path, '/competitors-offers', 'offers route');
assert.equal(feed.find((n) => n.id === 'post-p2').kind, 'content', 'has_offer=null is not an offer');
assert.equal(feed.find((n) => n.id === 'ad-a1').kind, 'content', 'has_offer=false is not an offer');
assert.match(feed[1].text, /פיצה כהן/, 'competitor name resolved');

// undated rows must surface rather than vanish
const undated = buildNotificationFeed({ now, competitorPosts: [{ id: 'p9', competitor_id: 'c1' }] });
assert.equal(undated[0].unread, true, 'undated row counts as unread');

console.log('notificationFeed self-check passed');
