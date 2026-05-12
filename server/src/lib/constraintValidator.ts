/**
 * constraintValidator.ts — OTX-004
 * Validates and adapts generated business actions against per-business
 * constraint rules (brand tone, prohibited keywords, operational limits, policy).
 * Returns the action modified/filtered to be compliant before execution.
 */

import { prisma } from '../db';

export interface ActionToValidate {
  type:          string;   // action type
  content?:      string;   // generated text content (post, reply, etc.)
  platform?:     string;   // target platform
  budgetIls?:    number;   // proposed budget
  discountPct?:  number;   // proposed discount %
  scheduledHour?: number;  // 0–23 hour to post
  competitors?:  string[]; // competitor names mentioned
}

export interface ValidationResult {
  valid:          boolean;
  action:         ActionToValidate;  // possibly modified
  modifications:  string[];          // list of changes made
  violations:     string[];          // hard violations (if any)
  constraintNotes: string;           // JSON for storage in AutoAction.constraint_notes
}

// ── Default constraints for businesses without explicit rules ────────────────
const DEFAULT_CONSTRAINTS = {
  prohibited_keywords:   [] as string[],
  max_discount_pct:      50,
  allow_competitor_mention: false,
  posting_hours_start:   8,
  posting_hours_end:     22,
  budget_cap_daily_ils:  500,
  approved_channels:     ['instagram', 'facebook', 'whatsapp'] as string[],
};

// ── Main validation function ──────────────────────────────────────────────────
export async function validateAction(
  businessId: string,
  action: ActionToValidate
): Promise<ValidationResult> {
  // Load business constraints
  let constraints = DEFAULT_CONSTRAINTS;
  try {
    const stored = await prisma.businessConstraints.findFirst({
      where: { business_id: businessId },
    });
    if (stored) {
      constraints = {
        prohibited_keywords:     JSON.parse(stored.prohibited_keywords || '[]'),
        max_discount_pct:        stored.max_discount_pct ?? 50,
        allow_competitor_mention: stored.allow_competitor_mention ?? false,
        posting_hours_start:     stored.posting_hours_start ?? 8,
        posting_hours_end:       stored.posting_hours_end ?? 22,
        budget_cap_daily_ils:    stored.budget_cap_daily_ils ?? 500,
        approved_channels:       JSON.parse(stored.approved_channels || '["instagram","facebook","whatsapp"]'),
      };
    }
  } catch {}

  const modifications: string[] = [];
  const violations:    string[] = [];
  let   modifiedAction = { ...action };

  // ── Rule 1: Prohibited keywords ───────────────────────────────────────────
  if (constraints.prohibited_keywords.length > 0 && modifiedAction.content) {
    for (const kw of constraints.prohibited_keywords) {
      if (!kw) continue;
      const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      if (regex.test(modifiedAction.content)) {
        // Replace with asterisks to sanitize
        modifiedAction.content = modifiedAction.content.replace(regex, '***');
        modifications.push(`Removed prohibited keyword: "${kw}"`);
      }
    }
  }

  // ── Rule 2: Competitor mentions ───────────────────────────────────────────
  if (!constraints.allow_competitor_mention) {
    // Check content for competitor names
    if (modifiedAction.content && modifiedAction.competitors?.length) {
      for (const comp of modifiedAction.competitors) {
        const regex = new RegExp(comp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        if (regex.test(modifiedAction.content)) {
          modifiedAction.content = modifiedAction.content.replace(regex, 'מתחרה');
          modifications.push(`Anonymized competitor mention: "${comp}"`);
        }
      }
    }
  }

  // ── Rule 3: Discount cap ──────────────────────────────────────────────────
  if (modifiedAction.discountPct !== undefined) {
    if (modifiedAction.discountPct > constraints.max_discount_pct) {
      const original = modifiedAction.discountPct;
      modifiedAction.discountPct = constraints.max_discount_pct;
      modifications.push(`Discount reduced from ${original}% to max allowed ${constraints.max_discount_pct}%`);

      // Also update content if it mentions the old discount
      if (modifiedAction.content) {
        modifiedAction.content = modifiedAction.content.replace(
          new RegExp(`${original}%`, 'g'),
          `${constraints.max_discount_pct}%`
        );
      }
    }
  }

  // ── Rule 4: Posting hours ─────────────────────────────────────────────────
  if (modifiedAction.scheduledHour !== undefined) {
    const { posting_hours_start: start, posting_hours_end: end } = constraints;
    if (modifiedAction.scheduledHour < start || modifiedAction.scheduledHour > end) {
      // Reschedule to next allowed window
      const reschedHour = modifiedAction.scheduledHour < start ? start : start + 2;
      modifications.push(
        `Rescheduled from ${modifiedAction.scheduledHour}:00 to ${reschedHour}:00 (allowed: ${start}:00–${end}:00)`
      );
      modifiedAction.scheduledHour = reschedHour;
    }
  }

  // ── Rule 5: Budget cap ────────────────────────────────────────────────────
  if (modifiedAction.budgetIls !== undefined) {
    if (modifiedAction.budgetIls > constraints.budget_cap_daily_ils) {
      modifications.push(
        `Budget capped from ₪${modifiedAction.budgetIls} to ₪${constraints.budget_cap_daily_ils} (daily cap)`
      );
      modifiedAction.budgetIls = constraints.budget_cap_daily_ils;
    }
  }

  // ── Rule 6: Approved channels ─────────────────────────────────────────────
  if (modifiedAction.platform) {
    if (!constraints.approved_channels.includes(modifiedAction.platform)) {
      violations.push(`Platform "${modifiedAction.platform}" is not in approved channels: ${constraints.approved_channels.join(', ')}`);
    }
  }

  const valid = violations.length === 0;
  const constraintNotes = JSON.stringify({ modifications, violations, validated_at: new Date().toISOString() });

  return { valid, action: modifiedAction, modifications, violations, constraintNotes };
}

// ── Ensure a business has constraint defaults ──────────────────────────────────
export async function ensureConstraints(businessId: string) {
  const existing = await prisma.businessConstraints.findFirst({
    where: { business_id: businessId },
  }).catch(() => null);

  if (!existing) {
    await prisma.businessConstraints.create({
      data: {
        business_id:           businessId,
        prohibited_keywords:   '[]',
        max_discount_pct:      50,
        allow_competitor_mention: false,
        posting_hours_start:   8,
        posting_hours_end:     22,
        approved_channels:     '["instagram","facebook","whatsapp"]',
        budget_cap_daily_ils:  500,
        min_confidence_auto:   85,
        min_confidence_suggest: 60,
        updated_at:            new Date().toISOString(),
      },
    }).catch(() => {});  // ignore if race condition
  }
}

// ── Get business constraints (for display in settings UI) ────────────────────
export async function getConstraints(businessId: string) {
  await ensureConstraints(businessId);
  return prisma.businessConstraints.findFirst({ where: { business_id: businessId } });
}

// ── Update business constraints ───────────────────────────────────────────────
export async function updateConstraints(
  businessId: string,
  updates: Partial<{
    brand_tone:              string;
    prohibited_keywords:     string[];
    max_discount_pct:        number;
    allow_competitor_mention: boolean;
    posting_hours_start:     number;
    posting_hours_end:       number;
    approved_channels:       string[];
    budget_cap_daily_ils:    number;
    min_confidence_auto:     number;
    min_confidence_suggest:  number;
    content_policy:          Array<{ rule: string; description: string }>;
  }>
) {
  await ensureConstraints(businessId);

  const data: Record<string, any> = { updated_at: new Date().toISOString() };
  if (updates.brand_tone              !== undefined) data.brand_tone              = updates.brand_tone;
  if (updates.prohibited_keywords     !== undefined) data.prohibited_keywords     = JSON.stringify(updates.prohibited_keywords);
  if (updates.max_discount_pct        !== undefined) data.max_discount_pct        = updates.max_discount_pct;
  if (updates.allow_competitor_mention !== undefined) data.allow_competitor_mention = updates.allow_competitor_mention;
  if (updates.posting_hours_start     !== undefined) data.posting_hours_start     = updates.posting_hours_start;
  if (updates.posting_hours_end       !== undefined) data.posting_hours_end       = updates.posting_hours_end;
  if (updates.approved_channels       !== undefined) data.approved_channels       = JSON.stringify(updates.approved_channels);
  if (updates.budget_cap_daily_ils    !== undefined) data.budget_cap_daily_ils    = updates.budget_cap_daily_ils;
  if (updates.min_confidence_auto     !== undefined) data.min_confidence_auto     = updates.min_confidence_auto;
  if (updates.min_confidence_suggest  !== undefined) data.min_confidence_suggest  = updates.min_confidence_suggest;
  if (updates.content_policy          !== undefined) data.content_policy          = JSON.stringify(updates.content_policy);

  return prisma.businessConstraints.update({ where: { business_id: businessId }, data });
}
