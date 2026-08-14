const SIGNAL_TYPES   = new Set(['web_search','social_mention','social_review','competitor_social','custom_source','social_trend']);
const RAW_ORIGINS    = new Set(['tavily','apify','google_places','instagram_graph_api','llm','manual','webhook']);
const REVIEW_ORIGINS = new Set(['google_places','google_business_api','tavily','apify','manual','serp_google_maps_reviews','dataforseo_google_reviews']);

export function normSignalType(v: string, ctx = ''): string {
  if (!SIGNAL_TYPES.has(v)) {
    console.warn(`[signalGuard] unknown signal_type "${v}"${ctx ? ` in ${ctx}` : ''} — normalizing to "custom_source"`);
    return 'custom_source';
  }
  return v;
}

export function normRawOrigin(v: string, ctx = ''): string {
  if (!RAW_ORIGINS.has(v)) {
    console.warn(`[signalGuard] unknown source_origin "${v}"${ctx ? ` in ${ctx}` : ''} — normalizing to "manual"`);
    return 'manual';
  }
  return v;
}

export function normReviewOrigin(v: string, ctx = ''): string {
  if (!REVIEW_ORIGINS.has(v)) {
    console.warn(`[signalGuard] unknown source_origin "${v}"${ctx ? ` in ${ctx}` : ''} — normalizing to "manual"`);
    return 'manual';
  }
  return v;
}
