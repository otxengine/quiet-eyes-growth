// action_router.ts — maps agent-generated action_type strings to UI destinations
// Used by: CompetitorSwotCard, BattlecardSection, InsightCard, CompetitorCard

export type ActionDestination =
  | { type: "open_composer"; text: string; platform?: string; context?: string }
  | { type: "open_reply";   reviewUrl: string; reviewText?: string; context?: string }
  | { type: "open_task";    title: string; description?: string; estimatedMinutes?: number }
  | { type: "open_url";     url: string; label?: string }
  | { type: "open_modal";   title: string; body: string };

export interface ActionInput {
  label: string;
  minutes?: number;
  action_type?: string;    // agent-generated type hint
  url?: string;
  platform?: string;
  review_url?: string;
  review_text?: string;
  context?: string;
}

// ─── Keyword heuristics to infer action type from Hebrew/English label ─────────

const SOCIAL_KEYWORDS = [
  "פוסט", "פרסם", "פרסום", "post", "פייסבוק", "אינסטגרם", "instagram", "facebook",
  "tiktok", "טיקטוק", "סטורי", "story", "קמפיין", "campaign", "שתף", "share",
];

const REPLY_KEYWORDS = [
  "תגובה", "הגב", "reply", "ביקורת", "review", "review_reply", "מענה",
];

const DELIVERY_KEYWORDS = [
  "וולט", "wolt", "10bis", "עשר ביס", "delivery", "משלוח", "הזמנה", "order",
];

const PROMO_KEYWORDS = [
  "קופון", "coupon", "הנחה", "discount", "מבצע", "promo", "promotion", "offer",
];

const ALERT_KEYWORDS = [
  "התראה", "alert", "notify", "הודעה", "warning",
];

function matchesAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

// ─── Primary resolver ──────────────────────────────────────────────────────────

export function resolveActionDestination(action: ActionInput): ActionDestination {
  const label = action.label ?? "";

  // Explicit action_type from agent takes priority
  if (action.action_type) {
    switch (action.action_type) {
      case "social_post":
      case "promote":
        return {
          type: "open_composer",
          text: buildComposerText(label, action.context),
          platform: action.platform,
          context: action.context,
        };
      case "respond":
      case "review_reply":
        return {
          type: "open_reply",
          reviewUrl: action.review_url ?? action.url ?? "",
          reviewText: action.review_text,
          context: action.context,
        };
      case "delivery_push":
        return {
          type: "open_url",
          url: action.url ?? "https://wolt.com/he/isr",
          label: label,
        };
      case "menu_change":
      case "staffing":
      case "open_task":
        return {
          type: "open_task",
          title: label,
          estimatedMinutes: action.minutes,
          description: action.context,
        };
      case "alert":
        return {
          type: "open_modal",
          title: label,
          body: action.context ?? label,
        };
    }
  }

  // Heuristic fallback based on label keywords
  if (matchesAny(label, REPLY_KEYWORDS)) {
    return {
      type: "open_reply",
      reviewUrl: action.review_url ?? action.url ?? "",
      reviewText: action.review_text,
      context: label,
    };
  }

  if (matchesAny(label, DELIVERY_KEYWORDS)) {
    return {
      type: "open_url",
      url: action.url ?? "https://wolt.com/he/isr",
      label: label,
    };
  }

  if (matchesAny(label, ALERT_KEYWORDS)) {
    return { type: "open_modal", title: label, body: action.context ?? label };
  }

  if (matchesAny(label, SOCIAL_KEYWORDS) || matchesAny(label, PROMO_KEYWORDS)) {
    return {
      type: "open_composer",
      text: buildComposerText(label, action.context),
      platform: action.platform,
      context: action.context,
    };
  }

  // Default: open as a task (covers most SWOT / battlecard actions)
  return {
    type: "open_task",
    title: label,
    estimatedMinutes: action.minutes,
    description: action.context,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildComposerText(label: string, context?: string): string {
  if (context) return `${context}\n\n${label}`;
  return label;
}
