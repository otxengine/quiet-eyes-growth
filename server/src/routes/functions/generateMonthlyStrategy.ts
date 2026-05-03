import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { loadBusinessContext, formatContextForPrompt } from '../../lib/businessContext';
import { getSectorContext } from '../../lib/sectorPrompts';

export async function generateMonthlyStrategy(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const [reviews, leads, signals, competitors, healthScores, predictions] = await Promise.all([
      prisma.review.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 20 }),
      prisma.lead.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 20 }),
      prisma.marketSignal.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 15 }),
      prisma.competitor.findMany({ where: { linked_business: businessProfileId }, take: 5 }),
      prisma.healthScore.findMany({ where: { linked_business: businessProfileId } }),
      prisma.prediction.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 5 }),
    ]);

    const bizCtx = await loadBusinessContext(businessProfileId);
    const ctxPrompt = formatContextForPrompt(bizCtx, 'generateMonthlyStrategy');
    const sectorCtx = getSectorContext(profile.category);

    const health = healthScores[0];
    const avgRating = reviews.length > 0
      ? (reviews.reduce((s, r) => s + (r.rating || 4), 0) / reviews.length).toFixed(1)
      : 'N/A';
    const hotLeads = leads.filter(l => l.status === 'hot');
    const opportunities = signals.filter(s => s.category === 'opportunity');
    const threats = signals.filter(s => s.category === 'threat');

    const todayDate = new Date().toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });

    const contextBlock = [
      `עסק: ${profile.name} (${profile.category}, ${profile.city})`,
      profile.description ? `תיאור: ${profile.description}` : '',
      `ציון בריאות: ${health?.overall_score || 'N/A'}/100`,
      `ממוצע דירוגים: ${avgRating} (${reviews.length} ביקורות)`,
      `לידים חמים: ${hotLeads.length} | סה"כ לידים: ${leads.length}`,
      `הזדמנויות שוק: ${opportunities.length} | איומים: ${threats.length}`,
      competitors.length > 0 ? `מתחרים: ${competitors.map(c => `${c.name} (${c.rating || '?'}⭐)`).join(', ')}` : '',
      predictions.length > 0 ? `תחזיות AI: ${predictions.slice(0, 3).map(p => p.summary || '').filter(Boolean).join('; ')}` : '',
    ].filter(Boolean).join('\n');

    const result = await invokeLLM({
      prompt: `אתה יועץ עסקי אסטרטגי לעסקים ישראלים. צור תכנית אסטרטגית חודשית ל${todayDate}.
${ctxPrompt}
${sectorCtx}
${contextBlock}

צור אסטרטגיה חודשית ממוקדת. החזר JSON:
{
  "summary": "סיכום מנהלים — 2-3 משפטים על מצב העסק והיעד החודשי",
  "focus_theme": "נושא המיקוד של החודש (ביטוי קצר)",
  "top_goal": "היעד המספרי הראשי לחודש הקרוב",
  "initiatives": [
    {
      "title": "שם היוזמה",
      "description": "תיאור ב-1-2 משפטים",
      "expected_impact": "השפעה צפויה (כמותית אם אפשר)",
      "effort": "low|medium|high",
      "priority": "high|medium|low",
      "category": "acquisition|retention|reputation|marketing|operations"
    }
  ],
  "kpis": [
    { "metric": "שם המדד", "target": "יעד מספרי", "current": "מצב נוכחי" }
  ],
  "risks": [
    { "risk": "תיאור הסיכון", "likelihood": "high|medium|low", "impact": "high|medium|low", "mitigation": "אמצעי מניעה" }
  ],
  "quick_wins": ["פעולה מהירה 1", "פעולה מהירה 2", "פעולה מהירה 3"]
}`,
      response_json_schema: { type: 'object' },
    });

    // Store as a special ProactiveAlert (reuse suggested_action for the full JSON)
    const strategyContent = JSON.stringify(result);
    const actionMeta = JSON.stringify({
      action_label: 'פתח אסטרטגיה',
      action_type: 'task',
      prefilled_text: result?.summary || '',
      urgency_hours: 720,
      impact_reason: 'תכנית אסטרטגית חודשית מגדילה הכנסות ב-15-30% בממוצע',
    });

    const existing = await prisma.proactiveAlert.findFirst({
      where: { linked_business: businessProfileId, alert_type: 'monthly_strategy' },
      orderBy: { created_date: 'desc' },
    });

    if (existing) {
      await prisma.proactiveAlert.update({
        where: { id: existing.id },
        data: {
          title: `אסטרטגיה חודשית — ${todayDate}`,
          description: result?.summary || '',
          suggested_action: strategyContent,
          source_agent: actionMeta,
          is_dismissed: false,
          is_acted_on: false,
          created_at: new Date().toISOString(),
        },
      });
    } else {
      await prisma.proactiveAlert.create({
        data: {
          linked_business: businessProfileId,
          alert_type: 'monthly_strategy',
          title: `אסטרטגיה חודשית — ${todayDate}`,
          description: result?.summary || '',
          suggested_action: strategyContent,
          priority: 'high',
          source_agent: actionMeta,
          is_dismissed: false,
          is_acted_on: false,
          created_at: new Date().toISOString(),
        },
      });
    }

    await writeAutomationLog('generateMonthlyStrategy', businessProfileId, startTime, 1);
    console.log(`generateMonthlyStrategy done for ${profile.name}`);
    return res.json({ strategy: result, generated: true });
  } catch (err: any) {
    console.error('generateMonthlyStrategy error:', err.message);
    await writeAutomationLog('generateMonthlyStrategy', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
