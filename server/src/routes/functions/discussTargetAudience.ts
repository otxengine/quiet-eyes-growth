/**
 * discussTargetAudience — conversational audience discovery for paid campaigns.
 *
 * The user describes the campaign they want to run (what's being promoted,
 * for whom, any specifics); the LLM either asks one short clarifying
 * question or proposes 1-2 grounded audience segments — same shape
 * getAudienceSegments.ts produces, real data via buildAudienceIntelligence
 * — ready for the user to save.
 *
 * Body: { businessProfileId, message, history: Array<{role, content}> }
 */
import { Request, Response } from 'express';
import { invokeLLM } from '../../lib/llm';
import { buildAudienceIntelligence } from './getAudienceSegments';

export async function discussTargetAudience(req: Request, res: Response) {
  const { businessProfileId, message, history = [] } = req.body;
  if (!businessProfileId || !message) {
    return res.status(400).json({ error: 'Missing businessProfileId or message' });
  }

  try {
    const intel = await buildAudienceIntelligence(businessProfileId);
    if (!intel) return res.status(404).json({ error: 'Business profile not found' });
    const { fullContext } = intel;

    const historyText = (Array.isArray(history) ? history : [])
      .slice(-10)
      .map((m: any) => `${m.role === 'user' ? 'משתמש' : 'עוזר'}: ${m.content}`)
      .join('\n');

    const systemPrompt = `אתה עוזר AI שעוזר לבעל עסק ישראלי למצוא קהל יעד לקמפיין ממומן (Facebook/Instagram/Google).
המשתמש מתאר איזה קמפיין הוא רוצה לפרסם — מה מקדמים, למי, וכל פרט רלוונטי.

נתוני העסק האמיתיים (ביקורות, לידים, מתחרים, טרנדים) — השתמש בהם כדי לבסס את הקהל, אל תמציא:
${fullContext}

חובה: ענה אך ורק ב-JSON תקין ללא טקסט נוסף, ללא markdown fences.

מבנה התשובה (JSON בלבד):
{"reply":"תגובה קצרה בעברית, 1-3 משפטים","segments":[]}

כללים:
1. אם אין לך מספיק מידע כדי לבנות קהל יעד ממוקד (לא ברור מה מקדמים / למי / מה המטרה) — שאל שאלת המשך אחת קצרה וממוקדת ב-reply, והחזר segments: []
2. אם יש מספיק מידע — בנה 1-2 סגמנטים מדויקים ב-segments, ו-reply יהיה משפט קצר שמציג אותם (למשל "מצאתי 2 קהלים שמתאימים לקמפיין — תוכל לשמור את מה שרלוונטי")
3. כל סגמנט ב-segments חייב במבנה המדויק הזה:
{"segment_name":"שם","description":"תיאור קצר","age_min":25,"age_max":45,"genders":"נשים וגברים","income_level":"mid","conversion_probability":0.3,"estimated_size":"medium","estimated_audience_range":"10,000-40,000","why_this_segment":"למה הסגמנט הזה","facebook_targeting":{"interests":["עניין 1","עניין 2","עניין 3"],"behaviors":["התנהגות"],"custom_audience":"Custom Audience מומלץ","lookalike_source":"מקור Lookalike","exclusions":[]},"google_targeting":{"keywords":["ביטוי 1","ביטוי 2"],"negative_keywords":[],"in_market_audiences":["קטגוריה"],"custom_intent":"כוונה"},"best_channels":["Facebook","Instagram"],"best_posting_time":"ראשון-חמישי 18:00-21:00","ad_creative_tip":"טיפ קריאייטיב","pain_point":"כאב מהנתונים","purchase_trigger":"טריגר קנייה"}
4. אל תשאל יותר משאלת המשך אחת ברצף — אחרי שהמשתמש ענה על שאלה, השתדל להציע סגמנטים גם אם המידע חלקי.`;

    const raw = await invokeLLM({
      prompt: `${systemPrompt}\n\nהיסטוריה:\n${historyText}\n\nמשתמש: ${message}`,
      model: 'haiku',
      maxTokens: 1000,
      skipCache: true,
    });

    const rawText = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                      rawText.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]).trim() : rawText.trim();

    let parsed: any = {};
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      parsed = { reply: rawText.replace(/```(?:json)?|```/g, '').trim(), segments: [] };
    }

    return res.json({
      reply: parsed.reply || 'מצטער, לא הצלחתי לעבד את הבקשה — נסה לנסח מחדש.',
      segments: Array.isArray(parsed.segments) ? parsed.segments : [],
    });
  } catch (err: any) {
    console.error('[discussTargetAudience] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
