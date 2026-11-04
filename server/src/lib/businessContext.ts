/**
 * businessContext — loads BusinessMemory to inject into agent prompts.
 * Call this before building any Claude prompt so agents use learned preferences.
 */

import { prisma } from '../db';

export interface BusinessContext {
  preferredTone: string;
  preferredChannels: string[];
  rejectedPatterns: string[];
  acceptedPatterns: string[];
  leadPreferences: Record<string, any>;
  contentStyle: Record<string, any>;
  agentWeights: Record<string, number>;
  feedbackSummary: Record<string, any>;
}

export async function loadBusinessContext(businessProfileId: string): Promise<BusinessContext | null> {
  try {
    const memory = await prisma.businessMemory.findUnique({
      where: { linked_business: businessProfileId },
    });
    if (!memory) return null;

    return {
      preferredTone: memory.preferred_tone || 'professional',
      preferredChannels: safeParseArr(memory.preferred_channels),
      rejectedPatterns: safeParseArr(memory.rejected_patterns),
      acceptedPatterns: safeParseArr(memory.accepted_patterns),
      leadPreferences: safeParse(memory.lead_preferences),
      contentStyle: safeParse(memory.content_style),
      agentWeights: safeParse(memory.agent_weights),
      feedbackSummary: safeParse(memory.feedback_summary),
    };
  } catch {
    return null;
  }
}

/**
 * Format business context as a Hebrew system prompt injection.
 * Pass the result as part of the prompt to Claude.
 */
export function formatContextForPrompt(ctx: BusinessContext | null, agentName?: string): string {
  if (!ctx) return '';

  const lines: string[] = ['=== העדפות עסקיות נלמדות ==='];

  if (ctx.preferredTone) {
    lines.push(`טון מועדף: ${ctx.preferredTone}`);
  }

  if (ctx.preferredChannels.length > 0) {
    lines.push(`ערוצים מועדפים: ${ctx.preferredChannels.join(', ')}`);
  }

  if (ctx.rejectedPatterns.length > 0) {
    lines.push(`הימנע מ: ${ctx.rejectedPatterns.slice(0, 5).join(', ')}`);
  }

  if (ctx.acceptedPatterns.length > 0) {
    lines.push(`מה עובד טוב: ${ctx.acceptedPatterns.slice(0, 5).join(', ')}`);
  }

  if (agentName && ctx.agentWeights[agentName] !== undefined) {
    const accuracy = Math.round(ctx.agentWeights[agentName] * 100);
    lines.push(`דיוק היסטורי של סוכן זה: ${accuracy}%`);
  }

  if (ctx.feedbackSummary?.common_rejection) {
    lines.push(`סיבת דחייה נפוצה: ${ctx.feedbackSummary.common_rejection}`);
  }

  lines.push('=== סוף העדפות ===');
  return '\n' + lines.join('\n') + '\n';
}

/** Track an AI output in the database, returns the output id */
export async function trackAIOutput(
  businessProfileId: string,
  agentName: string,
  outputType: string,
  content: string,
  confidence?: number,
  module?: string,
): Promise<string | null> {
  try {
    const rec = await prisma.aIOutput.create({
      data: {
        linked_business: businessProfileId,
        agent_name: agentName,
        module: module || agentName,
        output_type: outputType,
        content: content.slice(0, 2000),
        confidence: confidence ?? 0.7,
        outcome_status: 'pending',
      },
    });
    return rec.id;
  } catch {
    return null;
  }
}

function safeParse(val: string | null | undefined): Record<string, any> {
  try { return val ? JSON.parse(val) : {}; } catch { return {}; }
}
function safeParseArr(val: string | null | undefined): string[] {
  try { const r = val ? JSON.parse(val) : []; return Array.isArray(r) ? r : []; } catch { return []; }
}
