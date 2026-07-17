import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { getCompetitorReviewInsightsData } from './getCompetitorReviewInsights';

const GOOGLE_SOURCES = ['google_business_api', 'google_places', 'serp_google_maps_reviews'];

function summarizeTopics(reviews: { topic_sentiment: string | null }[]): string {
  const counts: Record<string, { pos: number; neg: number }> = {};
  for (const r of reviews) {
    if (!r.topic_sentiment) continue;
    try {
      const ts = JSON.parse(r.topic_sentiment);
      for (const [topic, polarity] of Object.entries(ts)) {
        if (!counts[topic]) counts[topic] = { pos: 0, neg: 0 };
        if (polarity === 'positive') counts[topic].pos++;
        else if (polarity === 'negative') counts[topic].neg++;
      }
    } catch {}
  }
  const sorted = Object.entries(counts).sort(([, a], [, b]) => (b.pos + b.neg) - (a.pos + a.neg)).slice(0, 8);
  return sorted.length > 0
    ? sorted.map(([topic, { pos, neg }]) => `• ${topic}: ${pos}+ / ${neg}−`).join('\n')
    : 'אין נתוני נושאים';
}

/**
 * KAN-151 — Page-scoped reputation advisor chat (R3-5).
 * Builds Appendix-B context from R3-2 (topic series) + R3-4 (competitor insights)
 * and grounds the LLM on provided data only — no fabrication of rivals or ratings.
 *
 * Body: { businessProfileId, competitorIds?, focusedCompetitorId?, mode?, message, history? }
 * Returns: { reply: string }
 */
export async function reputationAdvisorChat(req: Request, res: Response) {
  const {
    businessProfileId,
    competitorIds,
    focusedCompetitorId,
    mode = 'selected_set',
    message,
    history = [],
  } = req.body;

  if (!businessProfileId || !message) {
    return res.status(400).json({ error: 'Missing businessProfileId or message' });
  }

  try {
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const baseWhere = { created_date: { gte: since }, source_origin: { in: GOOGLE_SOURCES } };

    const competitors = await prisma.competitor.findMany({
      where: {
        linked_business: businessProfileId,
        is_dismissed: false,
        ...(Array.isArray(competitorIds) && competitorIds.length ? { id: { in: competitorIds } } : {}),
      },
      select: { id: true, name: true, rating: true, review_count: true },
    });

    const [profile, ownReviews, ...compReviews] = await Promise.all([
      prisma.businessProfile.findUnique({
        where: { id: businessProfileId },
        select: { name: true, category: true, city: true },
      }),
      prisma.review.findMany({
        where: { ...baseWhere, linked_business: businessProfileId },
        select: { rating: true, topic_sentiment: true },
      }),
      ...competitors.map(c =>
        prisma.review.findMany({
          // ponytail: spread-ternary avoids strict object-literal check on un-regenerated Prisma client
          where: { ...baseWhere, ...(true ? { linked_competitor: c.id } : {}) },
          select: { topic_sentiment: true },
        }),
      ),
    ]);

    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    const ownRatings = (ownReviews as any[]).map((r: any) => r.rating).filter(Boolean);
    const avgRating = ownRatings.length > 0
      ? (ownRatings.reduce((s: number, r: number) => s + r, 0) / ownRatings.length).toFixed(1)
      : null;

    const ownTopics = summarizeTopics(ownReviews as any[]);

    const competitorLines = competitors.length > 0
      ? competitors.map((c, i) => {
          const topics = summarizeTopics((compReviews[i] ?? []) as any[]);
          return `${c.name}: ${c.rating ?? '?'}/5 (${c.review_count ?? '?'} ביקורות)\n  ${topics.replace(/\n/g, '\n  ')}`;
        }).join('\n\n')
      : 'אין מתחרים בקבוצה';

    let focusedBlock = '';
    if (focusedCompetitorId) {
      try {
        const ins = await getCompetitorReviewInsightsData(businessProfileId, focusedCompetitorId);
        focusedBlock = `\n=== פוקוס מתחרה: ${ins.competitor_name} ===
דירוג: ${ins.rating ?? '?'}/5 | ${ins.review_count ?? '?'} ביקורות${(ins as any).trend ? ` | מגמה: ${(ins as any).trend}` : ''}
נושאים חיוביים: ${(ins.top_positive_themes as string[]).join(', ') || 'אין'}
נושאים שליליים: ${(ins.top_negative_themes as string[]).join(', ') || 'אין'}${ins.hebrew_summary ? `\nסיכום: ${ins.hebrew_summary}` : ''}`;
      } catch { /* non-fatal */ }
    }

    const historyText = (Array.isArray(history) ? history : [])
      .slice(-6)
      .map((m: any) => `${m.role === 'ai' ? 'עוזר' : 'משתמש'}: ${(m.text || m.content || '').slice(0, 400)}`)
      .join('\n');

    const contextBlock = `=== עסק ===
שם: ${(profile as any).name} | קטגוריה: ${(profile as any).category} | עיר: ${(profile as any).city}
דירוג ממוצע Google (90 ימים): ${avgRating ?? 'אין נתונים'}/5 | ${ownRatings.length} ביקורות
מצב: ${mode === 'selected_set' ? 'קבוצת מתחרים נבחרת' : 'ממוצע שוק'}

=== נושאים עצמיים (Google, 90 ימים) ===
${ownTopics}

=== מתחרים בקבוצה ===
${competitorLines}${focusedBlock}`;

    const systemPrompt = `אתה יועץ מוניטין AI עבור עסק ישראלי קטן.
ענה בעברית בלבד.
השתמש אך ורק בנתונים שסופקו — אל תמציא מתחרים, דירוגים, או נושאים שאינם מופיעים בקונטקסט.
אם מבקשים מידע שאינו בקונטקסט — אמור זאת במפורש: "אין לי נתונים על X".
ציין מספרים ספציפיים (ציונים, ספירות, נושאים) מהנתונים שסופקו.
תפקידך ייעוצי בלבד — אין לפרסם תגובות או לפעול על ביקורות.

${contextBlock}`;

    const raw = await invokeLLM({
      prompt: `${historyText ? `היסטוריה:\n${historyText}\n\n` : ''}שאלה: ${message.slice(0, 1000)}`,
      model: 'sonnet',
      maxTokens: 1000,
      skipCache: true,
      systemPrompt,
      usePromptCache: true,
    });

    return res.json({ reply: typeof raw === 'string' ? raw : JSON.stringify(raw) });
  } catch (err: any) {
    console.error('[reputationAdvisorChat]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
