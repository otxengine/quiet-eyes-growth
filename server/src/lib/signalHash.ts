/**
 * Signal hashing — deterministic deduplication for ingested signals.
 *
 * Hash is computed from: normalized_text (first 300 chars) + source + business_scope
 * This ensures:
 * - Same text from same source for same business = same hash (dedup)
 * - Same text from different source = different hash (kept)
 * - Global signals (no business scope) use 'global'
 */

import { createHash } from 'crypto';

/**
 * Compute a deterministic sha256 hash for a signal.
 * Safe to call multiple times — always returns the same hash for the same inputs.
 */
export function hashSignal(
  normalizedText: string,
  source: string,
  businessScope: string,
): string {
  const input = [
    businessScope.toLowerCase().trim(),
    source.toLowerCase().trim(),
    normalizedText.toLowerCase().trim().slice(0, 300),
  ].join('|');

  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

/**
 * Compute a deterministic dedup key for an opportunity.
 * Same business + type + time window = same key → merge rather than duplicate.
 */
export function hashOpportunity(
  businessId: string,
  type: string,
  windowStart: string | null,
): string {
  const windowDay = windowStart
    ? new Date(windowStart).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const input = [businessId, type, windowDay].join('|');
  return createHash('sha256').update(input).digest('hex').slice(0, 24);
}

/**
 * Compute a deterministic dedup key for a threat.
 */
export function hashThreat(
  businessId: string,
  type: string,
  dayWindow: string,
): string {
  const input = [businessId, type, dayWindow].join('|');
  return createHash('sha256').update(input).digest('hex').slice(0, 24);
}
