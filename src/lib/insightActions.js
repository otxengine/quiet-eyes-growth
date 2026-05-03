/**
 * insightActions.js
 *
 * ActionRouter — maps insight type + business snapshot → specific executable actions.
 * Zero LLM calls. Pure logic.
 *
 * Each action has:
 *   label      — button text
 *   type       — 'navigate' | 'execute' | 'external'
 *   url        — internal route (for navigate)
 *   href       — external URL (for external)
 *   fn         — function name to call (for execute)
 *   params     — pre-filled params
 *   icon       — lucide icon name string
 *   condition  — optional fn(snapshot) => bool — show only when relevant
 */

// ── Action definitions ───────────────────────────────────────────────────────

const ACTION_DEFS = {

  create_task: (insight) => ({
    label: 'צור משימה',
    icon: 'ClipboardList',
    type: 'execute',
    fn: 'createTask',
    params: {
      title: insight?.title || '',
      description: insight?.description || '',
      priority: insight?.priority === 'critical' || insight?.priority === 'high' ? insight.priority : 'medium',
    },
  }),

  view_reviews: () => ({
    label: 'ביקורות ממתינות',
    icon: 'Star',
    type: 'navigate',
    url: '/reviews',
  }),

  respond_review: () => ({
    label: 'הגב לביקורות',
    icon: 'MessageSquare',
    type: 'navigate',
    url: '/reviews?filter=pending',
  }),

  draft_post: (insight) => ({
    label: 'צור פוסט',
    icon: 'Megaphone',
    type: 'navigate',
    url: `/marketing?create=organic&summary=${encodeURIComponent(insight?.title || '')}&action=${encodeURIComponent(insight?.description || '')}`,
  }),

  create_campaign: (insight) => ({
    label: 'הפעל קמפיין',
    icon: 'Zap',
    type: 'navigate',
    url: `/marketing/create?summary=${encodeURIComponent(insight?.title || '')}`,
  }),

  view_competitors: () => ({
    label: 'עמוד מתחרים',
    icon: 'Users',
    type: 'navigate',
    url: '/competitors',
  }),

  add_competitor: () => ({
    label: 'הוסף מתחרה',
    icon: 'UserPlus',
    type: 'navigate',
    url: '/competitors?addNew=true',
  }),

  view_leads: () => ({
    label: 'לידים חמים',
    icon: 'TrendingUp',
    type: 'navigate',
    url: '/leads?filter=hot',
  }),

  view_retention: () => ({
    label: 'שימור לקוחות',
    icon: 'Heart',
    type: 'navigate',
    url: '/retention',
  }),

  connect_google: () => ({
    label: 'חבר גוגל ביזנס',
    icon: 'Globe',
    type: 'navigate',
    url: '/integrations?platform=google',
    condition: (snap) => !snap?.has_google_business,
  }),

  connect_facebook: () => ({
    label: 'חבר פייסבוק',
    icon: 'Share2',
    type: 'navigate',
    url: '/integrations?platform=facebook_page',
    condition: (snap) => !snap?.has_facebook,
  }),

  connect_instagram: () => ({
    label: 'חבר אינסטגרם',
    icon: 'Camera',
    type: 'navigate',
    url: '/integrations?platform=instagram_business',
    condition: (snap) => !snap?.has_instagram,
  }),

  register_google_business: () => ({
    label: 'הירשם לגוגל ביזנס',
    icon: 'Globe',
    type: 'external',
    href: 'https://business.google.com/create',
    condition: (snap) => !snap?.has_google_business,
  }),

  view_signals: () => ({
    label: 'תובנות שוק',
    icon: 'Eye',
    type: 'navigate',
    url: '/signals',
  }),

  view_analytics: () => ({
    label: 'אנליטיקס',
    icon: 'BarChart2',
    type: 'navigate',
    url: '/analytics',
  }),

  view_tasks: () => ({
    label: 'כל המשימות',
    icon: 'ClipboardList',
    type: 'navigate',
    url: '/tasks',
  }),

  update_profile: () => ({
    label: 'עדכן פרופיל עסקי',
    icon: 'Settings',
    type: 'navigate',
    url: '/settings',
  }),

  connect_delivery: () => ({
    label: 'חבר פלטפורמת משלוחים',
    icon: 'Truck',
    type: 'navigate',
    url: '/integrations?category=delivery',
    condition: (snap) => !snap?.has_wolt && !snap?.has_ten_bis,
  }),

  whatsapp_blast: (insight) => ({
    label: 'שלח הודעת וואטסאפ',
    icon: 'MessageCircle',
    type: 'navigate',
    url: `/marketing?create=whatsapp&summary=${encodeURIComponent(insight?.title || '')}`,
    condition: (snap) => snap?.has_whatsapp,
  }),
};

// ── Routing map ───────────────────────────────────────────────────────────────

const INSIGHT_ACTION_MAP = {
  opportunity: [
    'draft_post',
    'create_campaign',
    'whatsapp_blast',
    'create_task',
    'view_leads',
  ],
  market_opportunity: [
    'draft_post',
    'create_campaign',
    'create_task',
    'view_signals',
  ],
  action_needed: [
    'create_task',
    'draft_post',
    'view_reviews',
    'view_leads',
  ],
  risk: [
    'create_task',
    'view_reviews',
    'respond_review',
    'view_retention',
  ],
  retention_risk: [
    'view_retention',
    'whatsapp_blast',
    'create_task',
    'draft_post',
  ],
  negative_review: [
    'respond_review',
    'create_task',
    'view_reviews',
  ],
  competitor_move: [
    'view_competitors',
    'add_competitor',
    'draft_post',
    'create_task',
  ],
  milestone: [
    'draft_post',
    'create_task',
    'view_analytics',
  ],
  hot_lead: [
    'view_leads',
    'create_task',
    'view_retention',
  ],
  // Action entity categories
  competitive: [
    'view_competitors',
    'draft_post',
    'create_task',
  ],
  defensive: [
    'create_task',
    'respond_review',
    'view_retention',
  ],
  general: [
    'create_task',
    'draft_post',
    'view_signals',
  ],
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a single action object by key, filtered by snapshot condition.
 * Returns null if the action doesn't exist or its condition fails.
 */
export function getActionByKey(key, snapshot, insight = {}) {
  const factory = ACTION_DEFS[key];
  if (!factory) return null;
  const action = factory(insight);
  if (action.condition && !action.condition(snapshot)) return null;
  return { key, ...action };
}

/**
 * Returns an array of action objects for the given insight type,
 * filtered by what's relevant given the business snapshot.
 *
 * @param {string} insightType - e.g. 'opportunity', 'risk', 'competitor_move'
 * @param {object|null} snapshot - from fetchBusinessSnapshot()
 * @param {object|null} insight - { title, description, priority }
 * @param {number} max - max actions to return (default 4)
 */
export function getActionsForInsight(insightType, snapshot, insight = {}, max = 4) {
  const keys = INSIGHT_ACTION_MAP[insightType] || INSIGHT_ACTION_MAP.general;

  return keys
    .map(key => {
      const factory = ACTION_DEFS[key];
      if (!factory) return null;
      const action = factory(insight);
      // Apply condition filter
      if (action.condition && !action.condition(snapshot)) return null;
      return { key, ...action };
    })
    .filter(Boolean)
    .slice(0, max);
}

/**
 * Returns a short plain-text description of what the business has/lacks
 * relevant to a given insight type — used to filter LLM suggestions.
 *
 * Example: for 'opportunity' insight, returns
 * "חבור: facebook, instagram | לא חבור: google, tiktok | ביקורות ממתינות: 3"
 */
export function getRelevantSnapshotContext(insightType, snapshot) {
  if (!snapshot) return '';
  const parts = [];

  // Platform status — always relevant
  if (snapshot.connected_platforms.length > 0) {
    parts.push(`פלטפורמות פעילות: ${snapshot.connected_platforms.join(', ')}`);
  }
  if (snapshot.missing_platforms.length > 0) {
    parts.push(`לא מחוברות: ${snapshot.missing_platforms.join(', ')}`);
  }

  // Type-specific additions
  if (['risk', 'negative_review', 'retention_risk'].includes(insightType)) {
    if (snapshot.pending_reviews > 0) parts.push(`ביקורות ממתינות: ${snapshot.pending_reviews}`);
    if (snapshot.avg_rating) parts.push(`דירוג: ${snapshot.avg_rating}/5`);
  }
  if (['competitor_move', 'competitive'].includes(insightType)) {
    if (snapshot.competitor_count > 0) parts.push(`מתחרים במעקב: ${snapshot.competitor_count}`);
  }
  if (['opportunity', 'market_opportunity'].includes(insightType)) {
    if (snapshot.open_tasks > 0) parts.push(`משימות פתוחות: ${snapshot.open_tasks}`);
  }

  return parts.join(' | ');
}
