import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { israelDateOffset, israelLocalToUTC } from '../../lib/timezone';

/**
 * suggestPostTime
 *
 * Lets the LLM pick a posting date/time for a single organic post draft,
 * based on general social-media best-practice knowledge (platform + post
 * type), as an alternative to the business owner picking manually. No real
 * publishing is wired up yet — scheduled_at is informational only, same as
 * the bulk-generate flow.
 *
 * Body: { businessProfileId, platform, postType, content? }
 * Returns: { scheduled_at, reasoning }
 */
export async function suggestPostTime(req: Request, res: Response) {
  const { businessProfileId, platform, postType, content } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    const nowIL = new Date().toLocaleString('he-IL', {
      timeZone: 'Asia/Jerusalem', weekday: 'long', hour: '2-digit', minute: '2-digit',
    });

    const result = await invokeLLM({
      model: 'haiku',
      maxTokens: 200,
      skipCache: true,
      prompt: `אתה מומחה לתזמון פרסום ברשתות חברתיות. בחר את המועד הטוב ביותר לפרסום הפוסט הבא, על סמך ידע כללי על התנהגות משתמשים ברשת החברתית הרלוונטית וסוג התוכן.

עסק: ${profile?.category || ''} ${profile?.city ? `(${profile.city})` : ''}
פלטפורמה: ${platform || 'instagram'}
סוג: ${postType === 'story' ? 'סטורי' : 'פוסט'}
${content ? `תוכן הפוסט: ${String(content).slice(0, 200)}` : ''}
עכשיו: ${nowIL} (שעון ישראל)

בחר יום ושעה בטווח הקרוב (היום עד 6 ימים קדימה) שבהם הקהל הכי פעיל ורלוונטי לתוכן הזה.

Return ONLY valid JSON:
{
  "day_offset": 0,
  "time": "19:00",
  "reasoning": "הסבר קצר בעברית (עד 15 מילים)"
}`,
      response_json_schema: { type: 'object' },
    });

    const dayOffset = Math.max(0, Math.min(6, parseInt(result?.day_offset, 10) || 0));
    const time = /^\d{2}:\d{2}$/.test(result?.time) ? result.time : '19:00';
    const scheduledAt = israelLocalToUTC(israelDateOffset(dayOffset), time);

    return res.json({ scheduled_at: scheduledAt.toISOString(), reasoning: result?.reasoning || '' });
  } catch (err: any) {
    console.error('[suggestPostTime]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
