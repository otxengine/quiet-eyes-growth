import { invokeLLM } from './llm';

export interface BioProfileSummary {
  competitorName: string;
  platform: string;
  bio: string;
}

export interface BioExample {
  competitorName: string;
  text: string;
}

export interface BioTrends {
  bio_insight: string | null;
  bio_examples: BioExample[];
}

/**
 * Synthesizes what competitors' social bios commonly CONTAIN (contact info,
 * hours, tagline, emojis, link, hashtags, service list...) and how they're
 * commonly STRUCTURED (ordering pattern), across ALL of a business's tracked
 * competitors' profiles — text-only, mirrors synthesizeContentTrends's
 * verbatim-example approach: the LLM only picks WHICH profiles best exemplify
 * the pattern (by index), the actual quoted bio text is pulled straight from
 * that profile's own `bio` field, spread across different competitors.
 */
export async function synthesizeBioTrends(profiles: BioProfileSummary[]): Promise<BioTrends> {
  if (!profiles.length) return { bio_insight: null, bio_examples: [] };

  try {
    const summary = profiles.map((p, i) =>
      `${i + 1}. [${p.competitorName} · ${p.platform}]\n   ${p.bio.replace(/\n/g, ' / ')}`,
    ).join('\n');

    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 600,
      skipCache: true,
      response_json_schema: { type: 'object' },
      prompt: `You are a marketing analyst. Below are the social bio texts of ${new Set(profiles.map(p => p.competitorName)).size} different competitors:

${summary}

Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "bio_insight": "3-5 sentences describing the pattern(s) that recur across MULTIPLE competitors' bios: what they commonly CONTAIN (e.g. contact info, working hours, tagline, emojis, a link, hashtags, a service list) and how they're commonly STRUCTURED (e.g. what typically comes first/last, list format vs paragraph, use of line breaks/emojis as separators). If there's no obvious cross-competitor pattern, say so honestly instead of forcing one.",
  "bio_example_indices": [an array of up to 6 profile numbers (the "N." at the start of each entry above) that best exemplify the bio_insight pattern you just described, ordered from strongest to weakest example — prefer spreading picks across DIFFERENT competitors rather than several from the same one. Pick real profiles, do not invent]
}`,
    });

    const indices: number[] = Array.isArray(result?.bio_example_indices)
      ? result.bio_example_indices.filter((n: any) => Number.isInteger(n) && n >= 1 && n <= profiles.length)
      : [];

    const bioExamples: BioExample[] = [];
    const usedCompetitors = new Set<string>();
    for (const i of indices) {
      if (bioExamples.length >= 3) break;
      const profile = profiles[i - 1];
      if (usedCompetitors.has(profile.competitorName)) continue;
      bioExamples.push({ competitorName: profile.competitorName, text: profile.bio });
      usedCompetitors.add(profile.competitorName);
    }

    return {
      bio_insight: typeof result?.bio_insight === 'string' && result.bio_insight ? result.bio_insight : null,
      bio_examples: bioExamples,
    };
  } catch (err: any) {
    console.warn('[synthesizeBioTrends] failed:', err.message);
    return { bio_insight: null, bio_examples: [] };
  }
}
