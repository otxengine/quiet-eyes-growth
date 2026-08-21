import { invokeLLM } from './llm';

export interface LogoDescription {
  competitorName: string;
  description: string;
}

/**
 * Synthesizes the visual pattern(s) recurring across tracked competitors'
 * logos/profile pictures — text-only, pooling the per-logo descriptions
 * already extracted by describeLogo (one vision call per logo, done once
 * upstream) rather than sending multiple images in one call.
 */
export async function synthesizeLogoTrends(descriptions: LogoDescription[]): Promise<string | null> {
  if (!descriptions.length) return null;

  try {
    const summary = descriptions.map((d, i) => `${i + 1}. [${d.competitorName}] ${d.description}`).join('\n');

    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 400,
      skipCache: true,
      response_json_schema: { type: 'object' },
      prompt: `You are a brand designer. Below are short descriptions of the logos/profile pictures of ${new Set(descriptions.map(d => d.competitorName)).size} different competitors:

${summary}

Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "insight": "2-4 sentences synthesizing the COMMON visual pattern(s) across MULTIPLE competitors' logos — style (wordmark/icon/photo), color choices, professional-quality markers. If there's no obvious cross-competitor pattern, say so honestly instead of forcing one."
}`,
    });

    return typeof result?.insight === 'string' && result.insight ? result.insight : null;
  } catch (err: any) {
    console.warn('[synthesizeLogoTrends] failed:', err.message);
    return null;
  }
}
