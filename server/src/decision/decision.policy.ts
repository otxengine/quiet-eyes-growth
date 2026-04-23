/**
 * PolicyEngine — controls automation eligibility, approval requirements,
 * cooldowns, channel permissions, and safety gates.
 *
 * Pure synchronous rules — no I/O or DB access.
 * Loaded context must be passed in from callers.
 */

import {
  POLICY_THRESHOLDS,
  COOLDOWN_DAYS,
  APPROVAL_REQUIRED_CHANNELS,
  AUTO_ALLOWED_CHANNELS,
  EXTERNAL_CHANNELS,
} from '../infra/config';

// ─── Input types ──────────────────────────────────────────────────────────────

export interface PolicyContext {
  businessId:           string;
  actionType:           string;
  channel:              string;
  confidence:           number;
  finalScore:           number;
  executionMode?:       string;
  autoEnabled:          boolean;
  lastRejectedAt?:      string | null;   // ISO timestamp of most recent rejection
  lastIgnoredAt?:       string | null;   // ISO timestamp of most recent ignore
  lastOverrideAt?:      string | null;
  recentRejectionCount: number;          // rejections in last 7 days
  overrideCount:        number;          // manual overrides in last 30 days
  isCustomerFacing:     boolean;         // generates content for end-users
  hasDraftContent:      boolean;         // draft copy will be dispatched
}

export interface PolicyDecision {
  eligible:          boolean;
  requiresApproval:  boolean;
  executionMode:     'suggest' | 'draft' | 'approval' | 'auto';
  blockedReasons:    string[];
  cooldownEndsAt?:   string;
}

// ─── PolicyEngine ─────────────────────────────────────────────────────────────

export class PolicyEngine {

  // ── 1. Automation eligibility ───────────────────────────────────────────────

  checkAutomationEligibility(ctx: PolicyContext): {
    eligible: boolean;
    reason?: string;
  } {
    if (!ctx.autoEnabled) {
      return { eligible: false, reason: 'auto_execute_disabled' };
    }
    if (ctx.confidence < POLICY_THRESHOLDS.auto_confidence_threshold) {
      return { eligible: false, reason: `confidence_too_low:${ctx.confidence.toFixed(2)}<${POLICY_THRESHOLDS.auto_confidence_threshold}` };
    }
    if (ctx.finalScore < POLICY_THRESHOLDS.auto_min_score) {
      return { eligible: false, reason: `score_too_low:${ctx.finalScore}<${POLICY_THRESHOLDS.auto_min_score}` };
    }
    if (!AUTO_ALLOWED_CHANNELS.has(ctx.channel)) {
      return { eligible: false, reason: `channel_not_auto_allowed:${ctx.channel}` };
    }
    const cooldown = this.checkCooldown(ctx);
    if (cooldown.inCooldown) {
      return { eligible: false, reason: `in_cooldown:until_${cooldown.endsAt}` };
    }
    return { eligible: true };
  }

  // ── 2. Approval requirement ─────────────────────────────────────────────────

  checkApprovalRequired(ctx: PolicyContext): boolean {
    // Customer-facing copy always needs human eyes
    if (ctx.isCustomerFacing || ctx.hasDraftContent) return true;
    // External channel sends always need approval
    if (APPROVAL_REQUIRED_CHANNELS.has(ctx.channel)) return true;
    // Low confidence
    if (ctx.confidence < POLICY_THRESHOLDS.approval_safe_threshold) return true;
    // Too many recent overrides
    if (ctx.overrideCount >= 3) return true;
    return false;
  }

  // ── 3. Cooldown ─────────────────────────────────────────────────────────────

  checkCooldown(ctx: PolicyContext): { inCooldown: boolean; endsAt?: string } {
    const now = Date.now();

    if (ctx.lastRejectedAt) {
      const rejectedMs  = new Date(ctx.lastRejectedAt).getTime();
      const cooldownMs  = COOLDOWN_DAYS.rejected_pattern * 86_400_000;
      if (now - rejectedMs < cooldownMs) {
        const endsAt = new Date(rejectedMs + cooldownMs).toISOString();
        // High urgency can bypass cooldown
        return { inCooldown: true, endsAt };
      }
    }

    if (ctx.lastIgnoredAt) {
      const ignoredMs  = new Date(ctx.lastIgnoredAt).getTime();
      const cooldownMs = COOLDOWN_DAYS.ignored_pattern * 86_400_000;
      if (now - ignoredMs < cooldownMs) {
        const endsAt = new Date(ignoredMs + cooldownMs).toISOString();
        return { inCooldown: true, endsAt };
      }
    }

    if (ctx.lastOverrideAt) {
      const overrideMs = new Date(ctx.lastOverrideAt).getTime();
      const cooldownMs = COOLDOWN_DAYS.manual_override * 86_400_000;
      if (now - overrideMs < cooldownMs) {
        const endsAt = new Date(overrideMs + cooldownMs).toISOString();
        return { inCooldown: true, endsAt };
      }
    }

    return { inCooldown: false };
  }

  // ── 4. Channel permission ───────────────────────────────────────────────────

  checkChannelPermission(
    channel: string,
    mode: string,
    allowedChannels?: Set<string>,
  ): { allowed: boolean; reason?: string } {
    const allowed = allowedChannels ?? AUTO_ALLOWED_CHANNELS;
    if (mode === 'auto' && !allowed.has(channel)) {
      return { allowed: false, reason: `channel_${channel}_not_in_auto_allowlist` };
    }
    return { allowed: true };
  }

  // ── 5. Safety policy ────────────────────────────────────────────────────────

  checkSafetyPolicy(ctx: PolicyContext): { safe: boolean; reason?: string } {
    // External channel auto-dispatch without approval is not safe
    if (EXTERNAL_CHANNELS.has(ctx.channel) && ctx.executionMode === 'auto') {
      return { safe: false, reason: 'external_channel_auto_blocked_by_safety' };
    }
    // Customer-facing copy auto-dispatched without approval is not safe
    if (ctx.isCustomerFacing && ctx.executionMode === 'auto') {
      return { safe: false, reason: 'customer_facing_auto_blocked_by_safety' };
    }
    return { safe: true };
  }

  // ── Full evaluation ─────────────────────────────────────────────────────────

  evaluate(ctx: PolicyContext): PolicyDecision {
    const blockedReasons: string[] = [];
    let executionMode: PolicyDecision['executionMode'] = 'suggest';
    let eligible       = true;
    let requiresApproval = false;

    // Confidence floor
    if (ctx.confidence < POLICY_THRESHOLDS.min_confidence_threshold) {
      eligible = false;
      blockedReasons.push(`confidence_below_minimum:${ctx.confidence.toFixed(2)}`);
    }

    // Score floor
    if (ctx.finalScore < POLICY_THRESHOLDS.min_score_threshold) {
      eligible = false;
      blockedReasons.push(`score_below_minimum:${ctx.finalScore}`);
    }

    if (!eligible) {
      return { eligible, requiresApproval: false, executionMode: 'suggest', blockedReasons };
    }

    // Approval check (runs before execution mode determination)
    requiresApproval = this.checkApprovalRequired(ctx);

    // Safety check
    const safety = this.checkSafetyPolicy({ ...ctx, executionMode: 'auto' });
    if (!safety.safe) {
      // Will not be auto, force approval if external
      if (EXTERNAL_CHANNELS.has(ctx.channel)) {
        requiresApproval = true;
        executionMode = 'approval';
        return { eligible, requiresApproval, executionMode, blockedReasons };
      }
    }

    // Determine execution mode
    if (APPROVAL_REQUIRED_CHANNELS.has(ctx.channel)) {
      executionMode = 'approval';
      requiresApproval = true;
    } else {
      const autoCheck = this.checkAutomationEligibility(ctx);
      if (autoCheck.eligible) {
        executionMode = 'auto';
      } else if (ctx.finalScore >= POLICY_THRESHOLDS.draft_min_score && ctx.autoEnabled) {
        executionMode = 'draft';
      } else {
        executionMode = 'suggest';
      }
    }

    const cooldown = this.checkCooldown(ctx);
    return {
      eligible,
      requiresApproval,
      executionMode,
      blockedReasons,
      cooldownEndsAt: cooldown.inCooldown ? cooldown.endsAt : undefined,
    };
  }
}

// Singleton instance
export const policyEngine = new PolicyEngine();
