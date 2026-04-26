import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { invokeLLM } from '../../lib/llm';

export async function updateSectorKnowledge(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { category, city } = profile;

    const [signals, competitors, reviews] = await Promise.all([
      prisma.rawSignal.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 50 }),
      prisma.competitor.findMany({ where: { linked_business: businessProfileId } }),
      prisma.review.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 30 }),
    ]);

    if (signals.length + competitors.length + reviews.length < 5) {
      return res.json({ updated: 0, message: 'Not enough data yet' });
    }

    const avgRating = reviews.length > 0
      ? (reviews.reduce((s, r) => s + (r.rating || 4), 0) / reviews.length).toFixed(1)
      : null;

    const commonComplaints = reviews
      .filter(r => r.sentiment === 'negative' && r.text)
      .slice(0, 5)
      .map(r => r.text?.substring(0, 100))
      .join('; ');

    const result = await invokeLLM({
      prompt: `אתה חוקר שוק לעסקים ישראלים. סנתז ידע על הסקטור.

קטגוריה: ${category}, אזור: ${city}
נתונים:
- ${competitors.length} מתחרים: ${competitors.map(c => `${c.name}(${c.rating || '?'}⭐)`).join(', ')}
- ${reviews.length} ביקורות, ממוצע ${avgRating || 'לא ידוע'}
- תלונות נפוצות: ${commonComplaints || 'לא זוהו'}
- ${signals.length} אותות שוק שנאספו

חלץ ידע על הסקטור:
- avg_rating: דירוג ממוצע בסקטור (מספר)
- common_complaints: תלונות נפוצות (עד 5, מופרד בפסיקים)
- trending_services: שירותים/מוצרים מבוקשים (עד 5)
- price_range: טווח מחירים טיפוסי בסקטור
- competitor_count: מספר מתחרים פעילים
- key_insights: תובנות מרכזיות על הסקטור (עד 3 משפטים)

החזר JSON: {"knowledge": {...}}`,
      response_json_schema: { type: 'object' },
    });

    const knowledge = result?.knowledge;
    if (!knowledge) return res.json({ updated: 0 });

    // Normalize array fields to strings (LLM sometimes returns arrays)
    const toStr = (v: any) => Array.isArray(v) ? v.join(', ') : (v || '');

    const existing = await prisma.sectorKnowledge.findMany({ where: { sector: category, region: city } });

    if (existing.length > 0) {
      await prisma.sectorKnowledge.update({
        where: { id: existing[0].id },
        data: {
          avg_rating: knowledge.avg_rating || null,
          common_complaints: toStr(knowledge.common_complaints),
          trending_services: toStr(knowledge.trending_services),
          price_range: knowledge.price_range || '',
          competitor_count: knowledge.competitor_count || competitors.length,
          total_signals_analyzed: signals.length,
          last_updated: new Date().toISOString(),
        },
      });
    } else {
      await prisma.sectorKnowledge.create({
        data: {
          sector: category,
          region: city,
          avg_rating: knowledge.avg_rating || null,
          common_complaints: toStr(knowledge.common_complaints),
          trending_services: toStr(knowledge.trending_services),
          price_range: knowledge.price_range || '',
          competitor_count: knowledge.competitor_count || competitors.length,
          total_signals_analyzed: signals.length,
          last_updated: new Date().toISOString(),
        },
      });
    }

    await writeAutomationLog('updateSectorKnowledge', businessProfileId, startTime, 1);
    console.log(`updateSectorKnowledge done: ${category}/${city}`);
    return res.json({ updated: 1, sector: category, region: city });
  } catch (err: any) {
    console.error('updateSectorKnowledge error:', err.message);
    await writeAutomationLog('updateSectorKnowledge', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
