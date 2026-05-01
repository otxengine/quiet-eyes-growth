/**
 * popup_classifier.ts
 * Classifies a market signal / insight into a popup action type.
 * Used by ActionPopup to auto-detect the right UX flow when action_type
 * is not explicitly set in the signal metadata.
 */

export type PopupType =
  | 'organic_post'     // פוסט אורגני (לא ממומן)
  | 'story_post'       // סטורי אורגני
  | 'social_post'      // פרסם פוסט / story (legacy)
  | 'respond'          // הגב לביקורת / לקוח
  | 'internal_task'    // משימה פנימית בעסק
  | 'whatsapp_blast'   // שלח ל-WhatsApp
  | 'campaign'         // קמפיין ממומן
  | 'pricing_action'   // שינוי מחיר / מבצע
  | 'delivery_promo'   // מבצע משלוח
  | 'platform_setup';  // הגדרת פלטפורמה (גוגל מפס, פייסבוק, אינסטגרם)

/** Returns true for signal types that should navigate to /marketing (organic content) */
export function isOrganicContent(type: PopupType): boolean {
  return type === 'organic_post' || type === 'social_post' || type === 'story_post';
}

/** Returns true for signal types that should navigate to /marketing/create (paid campaign) */
export function isPaidCampaign(type: PopupType): boolean {
  return type === 'campaign' || type === 'pricing_action';
}

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
  if (type === 'platform_setup') return 'platform_setup';
  if (type === 'story_post' || type === 'story') return 'story_post';
  if (type === 'organic_post') return 'organic_post';
  if (type === 'social_post' || type === 'promote' || type === 'post_publish') return 'organic_post';
  if (type === 'respond')     return 'respond';
  if (type === 'campaign')    return 'campaign';
  if (type === 'call')        return 'internal_task';
  if (type === 'task')        return 'internal_task';
  if (type === 'whatsapp_blast') return 'whatsapp_blast';
  if (type === 'pricing_action') return 'pricing_action';
  if (type === 'delivery_promo') return 'delivery_promo';

  // Platform setup detection — must come before general platform checks
  const setupPattern = /הרשם|הגדר|צור חשבון|פתח חשבון|הוסף עסק|setup|register|create account|claim|verify/i;
  if (setupPattern.test(label) || setupPattern.test(text)) return 'platform_setup';
  if (/google.?(maps|business|מפות|עסקים)|גוגל.?(מפות|עסקים)/.test(text + label) && setupPattern.test(text + label)) return 'platform_setup';

  // Platform-based detection
  if (['instagram', 'tiktok', 'facebook'].includes(platform)) return 'social_post';
  if (platform === 'whatsapp') return 'whatsapp_blast';
  if (platform === 'google_maps') return 'platform_setup';
  if (platform === 'google') return 'respond';
  if (platform === 'wolt' || platform === 'ten_bis') return 'delivery_promo';

  // Label / text heuristics
  if (/סטורי|story/.test(label)) return 'story_post';
  if (/פרסם|פוסט|post|שתף/.test(label)) return 'organic_post';
  if (/הגב|ביקורת|תגובה|respond|reply/.test(label)) return 'respond';
  if (/whatsapp|ווטסאפ|הודע|blast/.test(label))    return 'whatsapp_blast';
  if (/קמפיין|campaign|ממומן|פרסום ממומן/.test(label)) return 'campaign';
  if (/מחיר|מבצע|הנחה|pricing|discount|sale/.test(label)) return 'pricing_action';
  if (/משלוח|delivery|wolt|תן ביס/.test(label))    return 'delivery_promo';

  // Signal category
  if (category === 'opportunity' || category === 'trend') return 'organic_post';
  if (category === 'competitor_move') return 'internal_task';

  // Text-level signals
  if (/happy.?hour|קוקטייל|מבצע|sale|discount/.test(text)) return 'organic_post';
  if (/ביקורת שלילית|negative review|לא מרוצה/.test(text)) return 'respond';
  if (/משלוח|wolt|ten.?bis/.test(text)) return 'delivery_promo';

  return 'internal_task';
}

/** Map classifyInsight result back to ActionPopup's existing action_type strings */
export function popupTypeToActionType(t: PopupType): string {
  switch (t) {
    case 'organic_post':   return 'social_post';
    case 'story_post':     return 'social_post';
    case 'social_post':    return 'social_post';
    case 'respond':        return 'respond';
    case 'campaign':       return 'promote';
    case 'whatsapp_blast': return 'social_post';
    case 'pricing_action': return 'promote';
    case 'delivery_promo': return 'platform_setup';
    case 'internal_task':  return 'task';
    case 'platform_setup': return 'platform_setup';
  }
}

/** Resolve the platform URL and steps for platform_setup type */
export function getPlatformSetupConfig(text: string, label: string): {
  platform: string;
  icon: string;
  url: string;
  steps: string[];
} {
  const t = (text + ' ' + label).toLowerCase();

  if (/google.?(maps|business|מפות|עסקים)|גוגל.?(מפות|עסקים)/.test(t)) {
    return {
      platform: 'Google Business Profile',
      icon: '🗺️',
      url: 'https://business.google.com/',
      steps: [
        'היכנס ל-business.google.com',
        'לחץ על "נהל עכשיו" (Manage now)',
        'חפש את שם העסק שלך',
        'מלא פרטי עסק: כתובת, קטגוריה, שעות',
        'אמת בעלות על העסק (SMS / גלויה / שיחה)',
        'לאחר אימות — הפרופיל פעיל ✓',
      ],
    };
  }
  if (/facebook|פייסבוק/.test(t)) {
    return {
      platform: 'Facebook Business',
      icon: '📘',
      url: 'https://www.facebook.com/pages/create',
      steps: [
        'היכנס לפייסבוק ולחץ "צור עמוד"',
        'בחר: עסק או מותג',
        'הכנס שם עמוד וקטגוריה',
        'הוסף תמונת פרופיל ועטיפה',
        'מלא "אודות" עם כתובת, טלפון, שעות',
        'פרסם את העמוד ✓',
      ],
    };
  }
  if (/instagram|אינסטגרם/.test(t)) {
    return {
      platform: 'Instagram Business',
      icon: '📷',
      url: 'https://www.instagram.com/accounts/convert_to_professional/',
      steps: [
        'פתח אינסטגרם → פרופיל → הגדרות',
        'בחר "עבור לחשבון מקצועי"',
        'בחר "עסק" (Business)',
        'קשר לעמוד הפייסבוק שלך',
        'הוסף פרטי קשר ועיר',
        'החשבון מוכן לקהל עסקי ✓',
      ],
    };
  }
  if (/whatsapp|ווטסאפ/.test(t)) {
    return {
      platform: 'WhatsApp Business',
      icon: '💬',
      url: 'https://business.whatsapp.com/',
      steps: [
        'הורד WhatsApp Business מ-App Store / Google Play',
        'הכנס מספר טלפון עסקי',
        'אמת ב-SMS',
        'הגדר שם עסק, שעות פעילות, תיאור',
        'הגדר הודעות אוטומטיות (ברוכים הבאים / היעדרות)',
        'החשבון מוכן לשליחה אוטומטית ✓',
      ],
    };
  }
  if (/wolt|וולט/.test(t)) {
    return {
      platform: 'Wolt Partners',
      icon: '🛵',
      url: 'https://explore.wolt.com/partners',
      steps: [
        'היכנס ל-Wolt Partners Portal',
        'לחץ "הצטרף כשותף"',
        'מלא פרטי מסעדה / עסק',
        'העלה תפריט ותמונות',
        'חתום על הסכם שותפות',
        'הפעלה תוך 7-14 ימי עסקים ✓',
      ],
    };
  }
  if (/10bis|תן.?ביס/.test(t)) {
    return {
      platform: '10BIS',
      icon: '🍽️',
      url: 'https://www.10bis.co.il/next/restaurantRegister',
      steps: [
        'היכנס לאזור ההצטרפות של תן ביס',
        'מלא פרטי עסק ותפריט',
        'העלה תמונות ותיאורים',
        'הגדר שעות משלוח ואזור',
        'אמת את פרטי הבנק לתשלום',
        'הפעלה תוך 5-10 ימי עסקים ✓',
      ],
    };
  }

  // Default generic platform setup
  return {
    platform: 'פלטפורמה דיגיטלית',
    icon: '🔧',
    url: '#',
    steps: [
      'פתח את הפלטפורמה',
      'צור חשבון עסקי',
      'מלא פרטי העסק',
      'אמת בעלות',
      'הפרופיל פעיל ✓',
    ],
  };
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
