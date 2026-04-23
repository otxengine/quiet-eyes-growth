/**
 * popup_classifier.ts
 * Classifies a market signal / insight into a popup action type.
 * Used by ActionPopup to auto-detect the right UX flow when action_type
 * is not explicitly set in the signal metadata.
 */

export type PopupType =
  | 'social_post'      // פרסם פוסט / story
  | 'respond'          // הגב לביקורת / לקוח
  | 'internal_task'    // משימה פנימית בעסק
  | 'whatsapp_blast'   // שלח ל-WhatsApp
  | 'campaign'         // קמפיין ממומן
  | 'pricing_action'   // שינוי מחיר / מבצע
  | 'delivery_promo';  // מבצע משלוח

export function classifyInsight(insight: {
  action_platform?: string;
  action_label?: string;
  action_type?: string;
  insight_type?: string;
  summary?: string;
  recommended_action?: string;
  category?: string;
  raw_text?: string;
}): PopupType {
  const label    = ((insight.action_label    ?? '') + ' ' + (insight.recommended_action ?? '')).toLowerCase();
  const platform = (insight.action_platform ?? '').toLowerCase();
  const type     = (insight.action_type     ?? insight.insight_type ?? '').toLowerCase();
  const text     = ((insight.summary ?? '') + ' ' + (insight.raw_text ?? '')).toLowerCase();
  const category = (insight.category ?? '').toLowerCase();

  // Already explicitly typed — map to PopupType
  if (type === 'social_post' || type === 'promote') return 'social_post';
  if (type === 'respond')     return 'respond';
  if (type === 'campaign')    return 'campaign';
  if (type === 'call')        return 'internal_task';
  if (type === 'task')        return 'internal_task';
  if (type === 'whatsapp_blast') return 'whatsapp_blast';
  if (type === 'pricing_action') return 'pricing_action';
  if (type === 'delivery_promo') return 'delivery_promo';

  // Platform-based detection
  if (['instagram', 'tiktok', 'facebook'].includes(platform)) return 'social_post';
  if (platform === 'whatsapp') return 'whatsapp_blast';
  if (platform === 'google_maps' || platform === 'google') return 'respond';
  if (platform === 'wolt' || platform === 'ten_bis') return 'delivery_promo';

  // Label / text heuristics
  if (/פרסם|פוסט|סטורי|story|post|שתף/.test(label)) return 'social_post';
  if (/הגב|ביקורת|תגובה|respond|reply/.test(label)) return 'respond';
  if (/whatsapp|ווטסאפ|הודע|blast/.test(label))    return 'whatsapp_blast';
  if (/קמפיין|campaign|ממומן|פרסום ממומן/.test(label)) return 'campaign';
  if (/מחיר|מבצע|הנחה|pricing|discount|sale/.test(label)) return 'pricing_action';
  if (/משלוח|delivery|wolt|תן ביס/.test(label))    return 'delivery_promo';

  // Signal category
  if (category === 'opportunity' || category === 'trend') return 'social_post';
  if (category === 'competitor_move') return 'internal_task';

  // Text-level signals
  if (/happy.?hour|קוקטייל|מבצע|sale|discount/.test(text)) return 'social_post';
  if (/ביקורת שלילית|negative review|לא מרוצה/.test(text)) return 'respond';
  if (/משלוח|wolt|ten.?bis/.test(text)) return 'delivery_promo';

  return 'internal_task';
}

/** Map classifyInsight result back to ActionPopup's existing action_type strings */
export function popupTypeToActionType(t: PopupType): string {
  switch (t) {
    case 'social_post':    return 'social_post';
    case 'respond':        return 'respond';
    case 'campaign':       return 'promote';
    case 'whatsapp_blast': return 'social_post'; // uses social_post flow, platform=whatsapp
    case 'pricing_action': return 'promote';
    case 'delivery_promo': return 'promote';
    case 'internal_task':  return 'task';
  }
}

/** SWOT column type → best popup type */
export function swotTypeToPopupType(swotKey: 'strengths' | 'weaknesses' | 'opportunities' | 'threats'): string {
  switch (swotKey) {
    case 'strengths':     return 'social_post';  // highlight our strengths → post
    case 'weaknesses':    return 'task';          // internal fix
    case 'opportunities': return 'promote';       // campaign opportunity
    case 'threats':       return 'task';          // internal defensive action
  }
}
