import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { tavilySearch, isTavilyRateLimited } from '../../lib/tavily';
import { writeAutomationLog } from '../../lib/automationLog';

export async function findLocalEvents(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city } = profile;
    const now = new Date();
    const month = now.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
    const nextMonth = new Date(now.getTime() + 30 * 86400000).toLocaleDateString('he-IL', { month: 'long' });

    if (isTavilyRateLimited()) {
      return res.json({ signals_created: 0, message: 'Tavily rate limited' });
    }

    // Search for local events: concerts, conferences, festivals, markets
    const queries = [
      `הופעות כנסים פסטיבלים ${city} ${month} ${nextMonth}`,
      `אירועים מקומיים ירידים שווקים ${city} ${month}`,
      `concerts events festivals conferences ${city} ${month}`,
      `מה קורה ב${city} ${month} ${nextMonth} אירועים`,
    ];

    const allResults: any[] = [];
    for (const q of queries) {
      if (isTavilyRateLimited()) break;
      const results = await tavilySearch(q, 4);
      allResults.push(...results);
    }

    // Deduplicate by URL
    const seen = new Set<string>();
    const unique = allResults.filter(r => {
      if (!r.url || seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    if (unique.length === 0) {
      await writeAutomationLog('findLocalEvents', businessProfileId, startTime, 0);
      return res.json({ signals_created: 0 });
    }

    const context = unique.slice(0, 12)
      .map(r => `[${r.url}]\n${r.title || ''}: ${(r.content || '').slice(0, 200)}`)
      .join('\n\n');

    let events: any[] = [];
    try {
      const analysis: any = await invokeLLM({
        model: 'haiku',
        prompt: `זהה אירועים מקומיים ממשיים בטקסט הבא: הופעות, כנסים, פסטיבלים, ירידים, שווקים, תערוכות, אירועי ספורט — כל אירוע שיכול לייצר תנועה של אנשים לאזור ${city}.

טקסט:
${context.slice(0, 4000)}

עבור עסק: "${name}" (${category} ב${city}).

החזר JSON בלבד:
{
  "events": [
    {
      "name": "שם האירוע",
      "date_text": "תאריך בטקסט — לדוגמה 15 במאי 2026 או מאי 2026",
      "date_iso": "YYYY-MM-DD אם ידוע, אחרת null",
      "venue": "מקום האירוע",
      "type": "concert|conference|festival|market|sports|community|exhibition|other",
      "expected_crowd": "large|medium|small",
      "business_opportunity": "הזדמנות קצרה לעסק זה — עד 8 מילים"
    }
  ]
}

כלול רק אירועים עם תאריך ספציפי בחודשיים הקרובים. אם אין — החזר {"events":[]}.`,
        response_json_schema: { type: 'object' },
      });
      events = (analysis?.events || []).filter(
        (e: any) => e.name && (e.date_iso || e.date_text)
      );
    } catch (_) {}

    if (events.length === 0) {
      await writeAutomationLog('findLocalEvents', businessProfileId, startTime, 0);
      return res.json({ signals_created: 0 });
    }

    // Dedup against existing local_event signals from the last 14 days
    const existing = await prisma.marketSignal.findMany({
      where: {
        linked_business: businessProfileId,
        category: 'local_event',
        detected_at: { gte: new Date(Date.now() - 14 * 86400000).toISOString() },
      },
      select: { summary: true },
    });
    const existingNames = new Set(existing.map(s => s.summary.toLowerCase()));

    let created = 0;
    for (const ev of events.slice(0, 6)) {
      if (existingNames.has(ev.name.toLowerCase())) continue;

      const typeIcon: Record<string, string> = {
        concert: '🎵', conference: '🎙️', festival: '🎪', market: '🛒',
        sports: '⚽', community: '🤝', exhibition: '🖼️', other: '📍',
      };
      const icon = typeIcon[ev.type] || '📍';

      // Compute urgency_hours from date_iso if available
      let urgencyHours = 168; // default 1 week
      if (ev.date_iso) {
        const eventMs = new Date(ev.date_iso).getTime();
        const diffHours = Math.ceil((eventMs - Date.now()) / 3600000);
        if (diffHours > 0 && diffHours < 720) urgencyHours = diffHours;
      }

      await prisma.marketSignal.create({
        data: {
          summary: ev.name,
          category: 'local_event',
          impact_level: ev.expected_crowd === 'large' ? 'high' : 'medium',
          recommended_action: ev.business_opportunity || `נצל את ${ev.name}`,
          confidence: 70,
          source_signals: 'tavily_local_search',
          source_description: JSON.stringify({
            event_type: ev.type,
            venue: ev.venue,
            date_text: ev.date_text,
            urgency_hours: urgencyHours,
            action_type: 'social_post',
            action_label: `${icon} ${ev.name}`,
          }),
          agent_name: `${icon} ${ev.name}`,
          is_read: false,
          detected_at: new Date().toISOString(),
          linked_business: businessProfileId,
        },
      }).catch(() => {});

      existingNames.add(ev.name.toLowerCase());
      created++;
    }

    await writeAutomationLog('findLocalEvents', businessProfileId, startTime, created);
    return res.json({ signals_created: created, events_found: events.length });
  } catch (err: any) {
    console.error('[findLocalEvents] error:', err.message);
    await writeAutomationLog('findLocalEvents', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
