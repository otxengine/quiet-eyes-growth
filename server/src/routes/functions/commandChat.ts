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

כללים:
1. ענה תמיד בעברית
2. תשובות קצרות ומעשיות (2-4 משפטים) אלא אם נשאל להסבר
3. אם הבקשה דורשת פעולה (יצירת משימה, עדכון ליד, מענה לביקורת, סגירת התראה, ניווט) — כלול pendingAction
4. הצע chips לניווט רלוונטי
5. אם צריך מידע חיצוני/עדכני — החזר needsWebSearch: true

תבנית JSON:
{
  "reply": "תשובה בעברית",
  "chips": [{"label": "← לידים", "path": "/leads"}],
  "pendingAction": {"type": "create_task", "label": "תיאור הפעולה", "payload": {}},
  "needsWebSearch": false,
  "webSearchQuery": ""
}

סוגי pendingAction:
- create_task: payload = { title, description, due_date? }
- update_lead: payload = { id, ...fields }
- respond_review: payload = { id, suggested_response }
- dismiss_alert: payload = { id }
- navigate: payload = { path }`;

    const firstResult = await invokeLLM({
      prompt: `${systemPrompt}\n\nהיסטוריה:\n${historyText}\n\nמשתמש: ${message}`,
      response_json_schema: {
        type: 'object',
        properties: {
          reply: { type: 'string' },
          chips: { type: 'array', items: { type: 'object' } },
          pendingAction: { type: 'object' },
          needsWebSearch: { type: 'boolean' },
          webSearchQuery: { type: 'string' },
        },
        required: ['reply'],
      },
      maxTokens: 800,
    });

    let parsed: any = {};
    if (typeof firstResult === 'string') {
      try { parsed = JSON.parse(firstResult); } catch { parsed = { reply: firstResult }; }
    } else {
      parsed = firstResult || {};
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
          const secondResult = await invokeLLM({
            prompt: `${systemPrompt}\n\nתוצאות חיפוש עבור "${parsed.webSearchQuery}":\n${snippets}\n\nהיסטוריה:\n${historyText}\n\nמשתמש: ${message}`,
            maxTokens: 800,
          });
          let sp: any = {};
          if (typeof secondResult === 'string') {
            try { sp = JSON.parse(secondResult); } catch { sp = { reply: secondResult }; }
          } else {
            sp = secondResult || {};
          }
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
