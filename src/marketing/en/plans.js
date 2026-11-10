/* The report-only plans sold in English (USD). Mirrors server/src/lib/planLimits.ts (brief_* plans)
   and server/src/lib/paddle.ts (PLAN_PRICES) — update all three together. No app imports: this file
   is used by the prerendered landing page and by the in-app English sign-up flow. */
export const EN_PLANS = [
  {
    id: 'brief_free', name: 'Free', price: '$0', cadence: 'Monthly summary',
    competitors: 2, reports: 'Monthly summary', posts: 'Monthly', ads: 'Monthly', reviews: 'Weekly', stories: null, youVsThem: false,
    cta: 'Start free',
  },
  {
    id: 'brief_monthly', name: 'Monthly', price: '$10', cadence: 'Full monthly report',
    competitors: 3, reports: 'Monthly', posts: 'Monthly', ads: 'Weekly', reviews: 'Weekly', stories: 'Daily', youVsThem: true,
    cta: 'Choose Monthly',
  },
  {
    id: 'brief_weekly', name: 'Weekly', price: '$29', cadence: 'Weekly + monthly reports',
    competitors: 3, reports: 'Weekly, monthly', posts: 'Weekly', ads: 'Weekly', reviews: 'Weekly', stories: 'Daily', youVsThem: true,
    cta: 'Choose Weekly',
  },
  {
    id: 'brief_daily', name: 'Daily', price: '$79', cadence: 'Daily, weekly + monthly',
    competitors: 5, reports: 'Daily, weekly, monthly', posts: 'Daily', ads: 'Daily', reviews: 'Weekly', stories: 'Daily', youVsThem: true,
    cta: 'Choose Daily', highlighted: true,
  },
  {
    id: 'brief_plus', name: 'Daily Plus', price: '$149', cadence: 'Daily, weekly + monthly',
    competitors: 10, reports: 'Daily, weekly, monthly', posts: 'Daily', ads: 'Daily', reviews: 'Weekly', stories: 'Daily', youVsThem: true,
    cta: 'Choose Daily Plus',
  },
];

/** The lines shown on a plan card; `on: false` renders greyed out. */
export function planFeatures(p) {
  return [
    { on: true, text: `${p.competitors} competitors` },
    { on: true, text: `Reports: ${p.reports.toLowerCase()}` },
    { on: true, text: `Posts checked ${p.posts.toLowerCase()}, ads ${p.ads.toLowerCase()}` },
    { on: true, text: `Google reviews checked ${p.reviews.toLowerCase()}` },
    { on: !!p.stories, accent: true, text: p.stories ? 'Instagram stories, collected daily' : 'No Instagram stories' },
    { on: p.youVsThem, text: p.youVsThem ? 'You vs. your competitors, monthly' : 'No "you vs. your competitors"' },
  ];
}

export const EN_FAQ = [
  {
    q: 'What is in the report?',
    a: 'What each competitor posted on Instagram and Facebook, the ads they are running on Meta, the offers and promos they announced, how their follower count moved, and what their customers wrote on Google — with a short list of what to do about it. On paid plans the monthly report also puts your own posts, ads and reviews next to theirs.',
  },
  {
    q: 'How do you find my competitors?',
    a: 'You tell us your business name and city. We find it on Google, suggest nearby businesses of the same kind, and you choose which ones to watch. You can add or remove competitors at any time.',
  },
  {
    q: 'Do I need to connect my accounts?',
    a: 'No. The report is built from public pages: Instagram, Facebook, the Meta Ad Library and Google reviews.',
  },
  {
    q: 'How do I get the report?',
    a: 'By email, with a PDF, at 9am in your time zone. Delivery by WhatsApp is coming soon.',
  },
  {
    q: 'Is the first report really free?',
    a: 'Yes. Right after you pick your competitors you get a report on their last 30 days, with no card. The Free plan then sends a summary of your competitors every month.',
  },
  {
    q: 'Can I cancel?',
    a: 'Any time, from your account. Paid plans are billed monthly through Paddle, and a cancelled plan goes back to Free.',
  },
];
