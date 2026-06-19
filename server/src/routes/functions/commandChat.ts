import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { tavilySearch } from '../../lib/tavily';

/**
 * commandChat — AI Command Center for CommandHome.
 * Loads rich business context and returns: reply, chips, pendingAction, webSearch.
 *
 * Body: { businessProfileId, message, history: Array<{role, content}> }
 */
export async function commandChat(req: Request, res: Response) {
  const { businessProfileId, message, history = [] } = req.body;
  if (!businessProfileId || !message) {
    return res.status(400).json({ error: 'Missing businessProfileId or message' });
  }

  try {
    // Load all context in parallel
    const [
      profile,
      leads,
      reviews,
      competitors,
      alerts,
      tasks,
      healthScore,
      marketSignals,
    ] = await Promise.all([
      prisma.businessProfile.findUnique({ where: { id: businessProfileId } }),
      prisma.lead.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 20,
        select: { id: true, name: true, status: true, score: true, service_needed: true },
      }),
      prisma.review.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 10,
        select: { id: true, text: true, rating: true, sentiment: true, response_status: true },
      }),
      prisma.competitor.findMany({
        where: { linked_business: businessProfileId },
        take: 5,
        select: { id: true, name: true, rating: true, weaknesses: true, trend_direction: true },
      }),
      prisma.proactiveAlert.findMany({
        where: { linked_business: businessProfileId, is_dismissed: false, is_acted_on: false },
        orderBy: { created_at: 'desc' },
        take: 10,
        select: { id: true, title: true, priority: true, suggested_action: true, alert_type: true },
      }),
      prisma.task.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 10,
        select: { id: true, title: true, status: true, due_date: true },
      }).catch(() => [] as any[]),
      prisma.healthScore.findFirst({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
      }).catch(() => null),
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { detected_at: 'desc' },
        take: 8,
        select: { summary: true, category: true, impact_level: true, recommended_action: true },
      }),
    ]);

    if (!profile) {
      return res.status(404).json({ error: 'Business profile not found' });
    }

    const historyText = (Array.isArray(history) ? history : [])
      .slice(-10)
      .map((m: any) => `${m.role === 'user' ? 'משתמש' : 'עוזר'}: ${m.content}`)
      .join('\n');

    const hotLeads = leads.filter(l => l.status === 'hot');
    const pendingReviews = reviews.filter(r => r.response_status === 'pending');
    const negReviews = reviews.filter(r => r.sentiment === 'negative');
    const criticalAlerts = alerts.filter(a => a.priority === 'critical' || a.priority === 'high');
    const openTasks = tasks.filter((t: any) => t.status !== 'completed');

    const contextBlock = `
עסק: ${(profile as any).name} | ${(profile as any).category || ''} | ${(profile as any).city || ''}
ציון בריאות: ${(healthScore as any)?.overall_score ?? 'לא זמין'}/100

לידים: ${leads.length} סה"כ | ${hotLeads.length} חמים
${hotLeads.slice(0, 3).map(l => `  • ${l.name || 'ליד'} — ${l.service_needed || ''} (${l.status})`).join('\n')}

ביקורות: ${reviews.length} | ממתינות למענה: ${pendingReviews.length} | שליליות: ${negReviews.length}
${negReviews.slice(0, 2).map(r => `  • "${(r.text || '').slice(0, 60)}" (${r.rating}★)`).join('\n')}

מתחרים (${competitors.length}): ${competitors.map(c => `${c.name} (${c.rating || '?'}★)`).join(', ')}

התראות פעילות (${alerts.length}) — דחופות: ${criticalAlerts.length}:
${criticalAlerts.slice(0, 3).map(a => `  • [${a.priority}] ${a.title} → ${a.suggested_action || ''}`).join('\n')}

משימות פתוחות (${openTasks.length}):
${openTasks.slice(0, 4).map((t: any) => `  • ${t.title} (${t.status})`).join('\n')}

סיגנלים אחרונים:
${marketSignals.slice(0, 4).map(s => `  • [${s.impact_level}] ${s.summary}`).join('\n')}
`.trim();

    const systemPrompt = `אתה מרכז הפיקוד AI של QuietEyes — יועץ עסקי חכם שמסייע לבעל עסק ישראלי.
יש לך גישה מלאה לנתוני העסק.

${contextBlock}

חובה: ענה אך ורק ב-JSON תקין ללא טקסט נוסף, ללא markdown fences, ללא הסברים מחוץ ל-JSON.

מבנה התשובה (JSON בלבד):
{"reply":"תשובה בעברית 2-4 משפטים קצרים","chips":[{"label":"← לידים","path":"/leads"}],"pendingAction":null,"needsWebSearch":false,"webSearchQuery":""}

כללים:
1. reply — תשובה בעברית, קצרה ומעשית (2-4 משפטים). זהו הטקסט שיוצג למשתמש.
2. chips — מערך קישורים רלוונטיים (אופציונלי, יכול להיות [])
3. pendingAction — אם הבקשה דורשת פעולה:
   - create_task: {"type":"create_task","label":"הסבר","payload":{"title":"...","description":"..."}}
   - update_lead: {"type":"update_lead","label":"הסבר","payload":{"id":"...","status":"..."}}
   - respond_review: {"type":"respond_review","label":"הסבר","payload":{"id":"...","suggested_response":"..."}}
   - dismiss_alert: {"type":"dismiss_alert","label":"הסבר","payload":{"id":"..."}}
   - navigate: {"type":"navigate","label":"הסבר","payload":{"path":"/..."}}
   - אם אין פעולה — null
4. needsWebSearch — true רק אם צריך מידע עדכני שאינו בנתוני העסק
5. webSearchQuery — שאילתת חיפוש אם needsWebSearch הוא true, אחרת ""

חשוב: שדה reply חייב להכיל תמיד טקסט קריא בעברית בלבד, לא JSON.`;

    const rawFirst = await invokeLLM({
      prompt: `${systemPrompt}\n\nהיסטוריה:\n${historyText}\n\nמשתמש: ${message}`,
      model: 'gemini-flash',
      maxTokens: 800,
    });

    let parsed: any = {};
    const rawText = typeof rawFirst === 'string' ? rawFirst : JSON.stringify(rawFirst);

    // Extract JSON block from LLM response (may be wrapped in markdown fences)
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                      rawText.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]).trim() : rawText.trim();

    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // LLM returned plain text — use as reply directly
      parsed = { reply: rawText.replace(/```(?:json)?|```/g, '').trim() };
    }

    // Safety: if reply itself looks like JSON (double-encoded), unwrap it
    if (typeof parsed.reply === 'string' && parsed.reply.trimStart().startsWith('{')) {
      try {
        const inner = JSON.parse(parsed.reply);
        if (inner?.reply) parsed = { ...parsed, ...inner };
      } catch { /* ignore */ }
    }

    // Web search fallback
    if (parsed.needsWebSearch && parsed.webSearchQuery) {
      try {
        const results = await tavilySearch(parsed.webSearchQuery, 3);
        const snippets = results
          .map((r: any) => r.content || r.snippet || '')
          .filter(Boolean)
          .slice(0, 3)
          .join('\n\n');

        if (snippets) {
          const rawSecond = await invokeLLM({
            prompt: `${systemPrompt}\n\nתוצאות חיפוש עבור "${parsed.webSearchQuery}":\n${snippets}\n\nהיסטוריה:\n${historyText}\n\nמשתמש: ${message}`,
            model: 'gemini-flash',
            maxTokens: 800,
          });
          let sp: any = {};
          const rawSecondText = typeof rawSecond === 'string' ? rawSecond : JSON.stringify(rawSecond);
          const jsonMatch2 = rawSecondText.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                             rawSecondText.match(/(\{[\s\S]*\})/);
          const jsonStr2 = jsonMatch2 ? (jsonMatch2[1] || jsonMatch2[0]).trim() : rawSecondText.trim();
          try { sp = JSON.parse(jsonStr2); } catch { sp = { reply: rawSecondText.replace(/```(?:json)?|```/g, '').trim() }; }
          parsed = { ...parsed, ...sp, webSearch: { query: parsed.webSearchQuery, results: snippets.slice(0, 300) } };
        }
      } catch (searchErr: any) {
        console.error('[commandChat] Web search error:', searchErr.message);
      }
    }

    return res.json({
      reply: parsed.reply || 'מצטער, לא הצלחתי לעבד את הבקשה.',
      chips: Array.isArray(parsed.chips) ? parsed.chips : [],
      pendingAction: parsed.pendingAction || null,
      webSearch: parsed.webSearch || null,
    });
  } catch (err: any) {
    console.error('[commandChat] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
