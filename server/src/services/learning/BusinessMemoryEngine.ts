/**
 * BusinessMemoryEngine — manages business memory state.
 *
 * Memory stores:
 * - preferred_tone           (from positive comment keywords)
 * - preferred_channels       (from accepted actions)
 * - rejected_patterns        (from thumbs_down / correction)
 * - accepted_patterns        (from thumbs_up)
 * - agent_weights            (per-agent accuracy scores)
 * - channel_preferences      (channel → score 0–1)
 * - timing_preferences       (day_hour → score 0–1)
 * - sector_specific_preferences
 *
 * Update modes:
 * - incrementalMemoryUpdate(): called after EACH feedback event
 * - fullMemoryCycle():         called from learning pipeline (30-day batch)
 *
 * Learning update rules:
 * - thumbs_up            → add to accepted_patterns, boost channel/timing prefs
 * - thumbs_down          → add to rejected_patterns, penalize channel/timing
 * - correction           → store in rejected_patterns + correction tag
 * - ignore (after 24h)   → mild penalty on channel/timing
 * - edit (heavy)         → partial rejection signal
 * - recent > old         → recent window weight = 0.6, all-time = 0.4
 */

import { learningRepository } from '../../repositories/LearningRepository';
import { bus } from '../../events/EventBus';
import { createLogger } from '../../infra/logger';
import { nanoid } from 'nanoid';

const logger = createLogger('BusinessMemoryEngine');

const MAX_PATTERNS = 40;
const MAX_CHANNELS  = 5;

function safeParse<T>(val: string | null | undefined, fallback: T): T {
  try { return val ? JSON.parse(val) : fallback; } catch { return fallback; }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ─── Incremental update ───────────────────────────────────────────────────────

export async function incrementalMemoryUpdate(
  businessId:  string,
  agentName:   string,
  score:       number,           // -1 | 0 | 1
  tags:        string[],
  correction:  string | undefined,
  comment:     string | undefined,
  outputType:  string | undefined,
  traceId:     string,
  feedbackType?: string,         // 'thumbs_up'|'thumbs_down'|'correction'|'edit'|'ignore'|'manual_override'
): Promise<void> {
  const memory = await learningRepository.getMemory(businessId);

  const rejectedPatterns: string[] = safeParse(memory?.rejected_patterns, []);
  const acceptedPatterns: string[] = safeParse(memory?.accepted_patterns, []);
  const existingSummary:  Record<string, any> = safeParse(memory?.feedback_summary, {});
  const channelPrefs:     Record<string, number> = safeParse((memory as any)?.channel_preferences, {});
  const timingPrefs:      Record<string, number> = safeParse((memory as any)?.timing_preferences, {});

  const primaryTag = tags[0] || outputType || 'general';
  const pattern    = `${agentName}:${primaryTag}`;

  // Determine sample based on feedback type
  const isReject = score < 0 || feedbackType === 'thumbs_down' || feedbackType === 'correction' || feedbackType === 'edit';
  const isAccept = score > 0 || feedbackType === 'thumbs_up';

  if (isReject) {
    if (!rejectedPatterns.includes(pattern)) {
      rejectedPatterns.push(pattern);
      if (rejectedPatterns.length > MAX_PATTERNS) rejectedPatterns.shift();
    }
    const idx = acceptedPatterns.indexOf(pattern);
    if (idx !== -1) acceptedPatterns.splice(idx, 1);
  } else if (isAccept) {
    if (!acceptedPatterns.includes(pattern)) {
      acceptedPatterns.push(pattern);
      if (acceptedPatterns.length > MAX_PATTERNS) acceptedPatterns.shift();
    }
    const idx = rejectedPatterns.indexOf(pattern);
    if (idx !== -1) rejectedPatterns.splice(idx, 1);
  }

  // Update channel preferences
  const channelTags = tags.filter(t =>
    ['instagram', 'facebook', 'whatsapp', 'tiktok', 'email', 'google', 'dashboard'].includes(t)
  );
  for (const ch of channelTags) {
    const current = channelPrefs[ch] ?? 0.5;
    // EMA: recent window α=0.20
    const sample  = isAccept ? 1.0 : feedbackType === 'ignore' ? 0.3 : 0.0;
    channelPrefs[ch] = clamp01(current * 0.80 + sample * 0.20);
  }

  // Update timing preferences
  const hour      = (new Date().getUTCHours() + 3) % 24;
  const dayOfWeek = new Date().getDay();
  const timingKey = `${dayOfWeek}_${hour}`;
  if (isAccept || isReject) {
    const current = timingPrefs[timingKey] ?? 0.5;
    const sample  = isAccept ? 1.0 : 0.0;
    timingPrefs[timingKey] = clamp01(current * 0.80 + sample * 0.20);
  }

  // Update preferred tone from comment
  let preferredTone = memory?.preferred_tone ?? 'professional';
  if (isAccept && comment) {
    if (comment.includes('ישיר') || comment.includes('קצר'))         preferredTone = 'direct';
    if (comment.includes('מפורט') || comment.includes('מקצועי'))    preferredTone = 'detailed';
    if (comment.includes('חברותי') || comment.includes('אישי'))     preferredTone = 'friendly';
  }

  // Update feedback summary
  for (const tag of tags) {
    existingSummary[`tag_${tag}`] = (existingSummary[`tag_${tag}`] || 0) + 1;
  }
  if (isReject && tags[0])  existingSummary.common_rejection = tags[0];
  if (isAccept && tags[0])  existingSummary.common_positive  = tags[0];
  if (correction)            existingSummary.last_correction  = correction.slice(0, 200);
  if (feedbackType === 'manual_override') {
    existingSummary.override_count = (existingSummary.override_count || 0) + 1;
  }

  // Detect preferred channels from accepts
  let preferredChannels: string[] = safeParse(memory?.preferred_channels, []);
  if (isAccept && channelTags.length > 0) {
    const ch = channelTags[0];
    if (!preferredChannels.includes(ch)) {
      preferredChannels = [ch, ...preferredChannels].slice(0, MAX_CHANNELS);
    }
  }

  await learningRepository.upsertMemory(businessId, {
    rejected_patterns:   JSON.stringify(rejectedPatterns),
    accepted_patterns:   JSON.stringify(acceptedPatterns),
    preferred_tone:      preferredTone,
    preferred_channels:  JSON.stringify(preferredChannels),
    feedback_summary:    JSON.stringify(existingSummary),
    channel_preferences: JSON.stringify(channelPrefs),
    timing_preferences:  JSON.stringify(timingPrefs),
    last_updated:        new Date().toISOString(),
  } as any);

  if (score !== 0) {
    const signalType = isAccept ? 'positive_pattern' : 'negative_pattern';
    const weightDelta = isAccept ? 0.05 : -0.05;
    await learningRepository.upsertPattern(
      businessId, pattern,
      isAccept
        ? `${agentName} — תוצאות מתקבלות: ${primaryTag}`
        : `${agentName} — תוצאות נדחות: ${primaryTag}`,
      signalType, agentName, weightDelta,
    );
  }

  logger.debug('Incremental memory update', { businessId, pattern, score, feedbackType });
}

// ─── Full cycle update ────────────────────────────────────────────────────────

export async function fullMemoryCycle(
  businessId: string,
  traceId:    string,
): Promise<{ patterns_added: number; weights_updated: number; version: number }> {
  logger.info('Running full memory cycle', { businessId });

  const feedback = await learningRepository.getRecentFeedback(businessId, 30);
  if (feedback.length === 0) {
    logger.info('No feedback for cycle', { businessId });
    return { patterns_added: 0, weights_updated: 0, version: 1 };
  }

  const byAgent: Record<string, typeof feedback> = {};
  for (const f of feedback) {
    const key = f.agent_name || 'unknown';
    if (!byAgent[key]) byAgent[key] = [];
    byAgent[key].push(f);
  }

  const agentWeights: Record<string, number> = {};
  let patternsAdded  = 0;
  let weightsUpdated = 0;

  for (const [agentName, events] of Object.entries(byAgent)) {
    const pos      = events.filter(e => (e.score ?? 0) > 0).length;
    const neg      = events.filter(e => (e.score ?? 0) < 0).length;
    const total    = events.length;
    const accuracy = total > 0 ? pos / total : 0.5;

    // Recent window (last 7 days) gets higher weight
    const cutoff7d  = new Date(Date.now() - 7 * 86_400_000);
    const recent    = events.filter(e => new Date((e as any).created_date ?? (e as any).created_at ?? 0) > cutoff7d);
    const recentPos = recent.filter(e => (e.score ?? 0) > 0).length;
    const recentAcc = recent.length > 0 ? recentPos / recent.length : accuracy;
    const blended   = recentAcc * 0.6 + accuracy * 0.4;

    agentWeights[agentName] = blended;

    const rejectedTypes = [...new Set(
      events.filter(e => (e.score ?? 0) < 0).map(e => e.output_type).filter(Boolean) as string[],
    )].slice(0, 10);
    const acceptedTypes = [...new Set(
      events.filter(e => (e.score ?? 0) > 0).map(e => e.output_type).filter(Boolean) as string[],
    )].slice(0, 10);

    await learningRepository.upsertAgentProfile(businessId, agentName, {
      total_outputs:  total,
      positive_count: pos,
      negative_count: neg,
      accuracy_score: Math.round(blended * 1000) / 1000,
      rejected_types: JSON.stringify(rejectedTypes),
      accepted_types: JSON.stringify(acceptedTypes),
    });

    weightsUpdated++;

    // Tag frequency patterns
    const tagFreq: Record<string, number> = {};
    for (const f of events) {
      const tags = f.tags ? f.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
      for (const tag of tags) tagFreq[tag] = (tagFreq[tag] || 0) + 1;
    }
    for (const [tag, count] of Object.entries(tagFreq)) {
      if (count >= 2) {
        const posForTag   = events.filter(e => (e.score ?? 0) > 0 && e.tags?.includes(tag)).length;
        const signalType  = posForTag > count / 2 ? 'positive_pattern' : 'negative_pattern';
        const weightDelta = signalType === 'positive_pattern' ? 0.1 : -0.1;
        await learningRepository.upsertPattern(
          businessId,
          `${agentName}:cycle:${tag}`,
          signalType === 'positive_pattern'
            ? `${agentName} — מחזור: ${tag} מוצלח`
            : `${agentName} — מחזור: ${tag} נכשל`,
          signalType, agentName, weightDelta,
        );
        patternsAdded++;
      }
    }
  }

  // Channel preferences from positive feedback
  const channelVotes: Record<string, number> = {};
  for (const f of feedback.filter(e => (e.score ?? 0) > 0)) {
    for (const ch of ['instagram', 'facebook', 'whatsapp', 'tiktok', 'email']) {
      if (f.tags?.includes(ch)) channelVotes[ch] = (channelVotes[ch] || 0) + 1;
    }
  }
  const preferredChannels = Object.entries(channelVotes)
    .sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 5);

  // Timing preferences: count positive vs total per (day, hour) slot
  const timingCounts: Record<string, { pos: number; total: number }> = {};
  for (const f of feedback) {
    const createdAt = (f as any).created_date ?? (f as any).created_at;
    if (!createdAt) continue;
    const d   = new Date(createdAt);
    const key = `${d.getDay()}_${(d.getUTCHours() + 3) % 24}`;
    if (!timingCounts[key]) timingCounts[key] = { pos: 0, total: 0 };
    timingCounts[key].total++;
    if ((f.score ?? 0) > 0) timingCounts[key].pos++;
  }
  const timingPrefs: Record<string, number> = {};
  for (const [key, { pos, total }] of Object.entries(timingCounts)) {
    timingPrefs[key] = total > 0 ? Math.round((pos / total) * 1000) / 1000 : 0.5;
  }

  const rejectedPatterns = [...new Set(
    feedback.filter(e => (e.score ?? 0) < 0).map(e => `${e.agent_name}:${e.output_type || 'general'}`),
  )].slice(0, 30);
  const acceptedPatterns = [...new Set(
    feedback.filter(e => (e.score ?? 0) > 0).map(e => `${e.agent_name}:${e.output_type || 'general'}`),
  )].slice(0, 30);

  const memory         = await learningRepository.getMemory(businessId);
  const currentVersion = (memory?.learning_version ?? 0) + 1;

  await learningRepository.upsertMemory(businessId, {
    agent_weights:      JSON.stringify(agentWeights),
    rejected_patterns:  JSON.stringify(rejectedPatterns),
    accepted_patterns:  JSON.stringify(acceptedPatterns),
    preferred_channels: preferredChannels.length > 0 ? JSON.stringify(preferredChannels) : undefined,
    timing_preferences: JSON.stringify(timingPrefs),
    feedback_summary:   JSON.stringify({
      total_events: feedback.length,
      agents:       weightsUpdated,
      last_run:     new Date().toISOString(),
    }),
    last_updated:     new Date().toISOString(),
    learning_version: currentVersion,
  } as any);

  await bus.emit(bus.makeEvent('memory.updated', businessId, {
    event_id:       `evt_${nanoid(8)}`,
    business_id:    businessId,
    memory_version: currentVersion,
    updated_at:     new Date().toISOString(),
    update_type:    'full_cycle' as const,
  }, traceId));

  logger.info('Memory cycle complete', { businessId, patternsAdded, weightsUpdated, version: currentVersion });

  return { patterns_added: patternsAdded, weights_updated: weightsUpdated, version: currentVersion };
}
