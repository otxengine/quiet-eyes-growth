import { invokeLLM } from './llm';

function normalize(s: string): string {
  return s.replace(/[^֐-׿a-zA-Z0-9]/g, '').trim();
}

/**
 * Vision-checks that a generated wordmark logo actually spells the business
 * name correctly — gpt-image-1 is good at rendering Hebrew but not perfect,
 * and a misspelled name is worse than no logo. Fails closed: any read/verify
 * error counts as "not confirmed correct" so the caller retries rather than
 * silently accepting an unverified result.
 */
export async function verifyLogoSpelling(
  imageBase64: string,
  imageMediaType: string,
  businessName: string,
): Promise<boolean> {
  try {
    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 150,
      skipCache: true,
      imageBase64,
      imageMediaType,
      response_json_schema: { type: 'object' },
      prompt: `Look at the attached logo image. Return ONLY valid JSON:
{ "text_seen": "the exact text rendered in the image, verbatim, in its original script — empty string if there's no legible text" }`,
    });
    const seen = typeof result?.text_seen === 'string' ? result.text_seen : '';
    return normalize(seen) === normalize(businessName) && normalize(businessName).length > 0;
  } catch (err: any) {
    console.warn('[verifyLogoSpelling] failed:', err.message);
    return false;
  }
}
