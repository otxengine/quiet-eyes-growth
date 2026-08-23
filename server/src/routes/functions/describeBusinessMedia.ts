import { Request, Response } from 'express';
import { invokeLLM } from '../../lib/llm';

/**
 * describeBusinessMedia
 *
 * Generates a short Hebrew description of an uploaded business image via
 * vision-capable LLM (Claude → Gemini Flash fallback), used to pre-fill the
 * media library's description field so the business owner can review/edit
 * rather than write it from scratch.
 *
 * Body: { imageBase64, mimeType }
 * Returns: { description }
 */
export async function describeBusinessMedia(req: Request, res: Response) {
  const { imageBase64, mimeType = 'image/jpeg' } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });

  try {
    const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, '');

    const result = await invokeLLM({
      model:      'sonnet',
      maxTokens:  100,
      systemPrompt: 'Return ONLY the description text. No markdown, no explanation, no surrounding quotes.',
      prompt:     'תאר בקצרה (עד 20 מילים) בעברית מה רואים בתמונה הזו, לשימוש כהקשר ליצירת פוסטים לרשתות חברתיות עבור העסק.',
      imageBase64: base64Data,
      imageMediaType: mimeType,
    });

    const description = (typeof result === 'string' ? result : String(result || '')).trim();
    return res.json({ description });
  } catch (err: any) {
    console.error('[describeBusinessMedia]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
