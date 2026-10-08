/**
 * buildNotificationFeed — flattens the review/competitor entity rows the bell already
 * fetches into one reverse-chronological feed.
 *
 * Unread is derived, not stored: an item is unread when it arrived after the user last
 * opened the page it links to (pageVisits, kept in sessionStorage by AppLayout).
 *
 * ponytail: no notifications table — the rows already exist, we were only counting them.
 * Add one when a notification needs state the source row can't carry (per-item dismiss,
 * or read state that survives a new tab).
 */

const MAX_ITEMS = 50;

const at = (row, ...fields) => {
  const raw = fields.map((f) => row[f]).find(Boolean);
  return raw ? new Date(raw).getTime() : null;
};

export function buildNotificationFeed({
  pendingReviews = [],
  competitorReviews = [],
  competitorPosts = [],
  competitorAds = [],
  competitors = [],
  pageVisits = {},
  now = Date.now(),
}) {
  const seen = (path) => pageVisits[path] || 0;
  const nameOf = (id) => competitors.find((c) => c.id === id)?.name || 'מתחרה';
  const items = [];

  const push = (id, kind, text, ts, path) => {
    // Undated rows sort to the top and count as unread — better to over-notify than hide
    const t = ts ?? now;
    items.push({ id, kind, text, ts: t, path, unread: t > seen(path) });
  };

  for (const r of pendingReviews) {
    const stars = r.rating ? `${r.rating}★ ` : '';
    push(`rev-${r.id}`, 'review',
      `${stars}ביקורת ממתינה למענה${r.reviewer_name ? ` — ${r.reviewer_name}` : ''}`,
      at(r, 'created_at', 'created_date'), '/reviews');
  }

  for (const r of competitorReviews) {
    const stars = r.rating ? `${r.rating}★ ` : '';
    push(`crev-${r.id}`, 'competitorReview',
      `${stars}ביקורת חדשה על ${nameOf(r.linked_competitor)}`,
      at(r, 'created_at', 'created_date'), '/reviews/compare');
  }

  for (const p of competitorPosts) {
    const offer = p.has_offer === true;
    push(`post-${p.id}`, offer ? 'offer' : 'content',
      `${nameOf(p.competitor_id)} ${offer ? 'פרסם מבצע חדש' : 'פרסם פוסט חדש'}`,
      at(p, 'first_seen_at', 'posted_at'),
      offer ? '/competitors-offers' : '/social-competition');
  }

  for (const a of competitorAds) {
    const offer = a.has_offer === true;
    push(`ad-${a.id}`, offer ? 'offer' : 'content',
      `${nameOf(a.competitor_id)} ${offer ? 'משיק מבצע בקמפיין חדש' : 'העלה מודעה חדשה'}`,
      at(a, 'first_seen_at'),
      offer ? '/competitors-offers' : '/social-competition');
  }

  return items.sort((x, y) => y.ts - x.ts).slice(0, MAX_ITEMS);
}
