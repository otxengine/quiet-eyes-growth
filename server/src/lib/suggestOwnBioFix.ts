import { invokeLLM } from './llm';

export interface OwnBioFixInput {
  businessName: string;
  category: string;
  city: string;
  services: string | null;
  platform: string;
  ownBio: string;
  competitorBioInsight: string;
  competitorBioExamples: { competitorName: string; text: string }[];
  changeFeedback?: string; // owner's requested change to a previous AI-suggested rewrite, if this is a revision
}

export interface OwnBioFix {
  suggested_bio: string | null;
  rationale: string | null;
}

/**
 * Suggests a rewritten version of the business's OWN bio for one platform,
 * grounded in the pattern already synthesized across tracked competitors'
 * winning bios (synthesizeBioTrends) — same "here's what's working, here's
 * how to apply it to you" idea as the content-trends reports, but actionable
 * (a ready-to-use rewrite) instead of just descriptive.
 */
export async function suggestOwnBioFix(input: OwnBioFixInput): Promise<OwnBioFix> {
  try {
    const examplesBlock = input.competitorBioExamples.length
      ? input.competitorBioExamples.map(e => `- [${e.competitorName}] ${e.text.replace(/\n/g, ' / ')}`).join('\n')
      : '(none)';

    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 500,
      skipCache: true,
      response_json_schema: { type: 'object' },
      prompt: `You are a social media consultant. A business wants to improve its ${input.platform} bio based on a pattern that's working for its competitors.

Business: "${input.businessName}" | Sector: ${input.category} | City: ${input.city}${input.services ? ` | Services: ${input.services}` : ''}

Winning bio pattern across competitors: ${input.competitorBioInsight}

Real competitor bio examples:
${examplesBlock}

The business's CURRENT bio on ${input.platform}:
${input.ownBio}
${input.changeFeedback ? `\nThe owner reviewed a previous AI-suggested rewrite and asked for this specific change: "${input.changeFeedback}". The new suggestion must incorporate this.\n` : ''}
Rewrite this business's bio to apply the winning pattern, while staying true to THIS business (its real name, sector, city, services — never invent details not given above, never copy a competitor's specific offer/contact info). Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "suggested_bio": "the rewritten bio, ready to copy-paste as-is, using line breaks (\\n) the same way the winning examples do",
  "rationale": "1-3 sentences explaining what changed from the current bio and why, tied to the winning pattern"
}`,
    });

    return {
      suggested_bio: typeof result?.suggested_bio === 'string' && result.suggested_bio ? result.suggested_bio : null,
      rationale: typeof result?.rationale === 'string' && result.rationale ? result.rationale : null,
    };
  } catch (err: any) {
    console.warn('[suggestOwnBioFix] failed:', err.message);
    return { suggested_bio: null, rationale: null };
  }
}
