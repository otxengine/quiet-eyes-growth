import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { loadBusinessContext } from '../../lib/businessContext';
import { executeOrQueue } from '../../services/execution/executeOrQueue';
import { getSectorContext, getSectorReviewResponse } from '../../lib/sectorPrompts';

/**
 * autoRespondToReviews — proactively generates suggested responses for
 * negative/unresponded reviews and pre-fills them so the owner just clicks Approve.
 */
export async function autoRespondToReviews(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category } = profile;

    // Load business tone preference
    const bizCtx = await loadBusinessContext(businessProfileId);
    const tone = bizCtx?.preferredTone || profile.tone_preference || 'professional';
    const toneInstruction = tone === 'casual'
      ? 'טון קליל וחברותי, תשובה קצרה ואנושית'
      : tone === 'warm'
      ? 'טון חם ואישי, מבלי להיות מכירתי'
      : 'טון מקצועי ואמין, ספציפי לביקורת';

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600000).toISOString();

    // Find reviews that need a response: no suggested_response yet, negative or low rating, last 30 days
    const reviews = await prisma.review.findMany({
      where: {
        linked_business: businessProfileId,
        suggested_response: null,
        created_date: { gte: new Date(thirtyDaysAgo) },
        OR: [
          { sentiment: 'negative' },
          { rating: { lte: 3 } },
        ],
      },
      orderBy: { created_date: 'desc' },
      take: 10,
    });

    // Also grab all-time unresponded negative reviews if we got fewer than 5
    const allUnresponded = reviews.length < 5
      ? await prisma.review.findMany({
          where: {
            linked_business: businessProfileId,
            suggested_response: null,
            OR: [{ sentiment: 'negative' }, { rating: { lte: 3 } }],
          },
          orderBy: { created_date: 'desc' },
          take: 10,
        })
      : reviews;

    const toProcess = allUnresponded.slice(0, 10);

    const existingAlerts = await prisma.proactiveAlert.findMany({
      where: { linked_business: businessProfileId, is_dismissed: false, alert_type: 'negative_review' },
      select: { title: true },
    });
    const existingTitles = new Set(existingAlerts.map(a => a.title));

    let processed = 0;

    for (const review of toProcess) {
      try {
        const isNegative = (review.rating || 5) <= 3;
        const sectorCtx = getSectorContext(category);
        const sectorExample = getSectorReviewResponse(category, isNegative ? 'negative' : 'positive');

        // Generate Hebrew response
        const responseText = await invokeLLM({
          prompt: `כתוב תגובה מקצועית בעברית לביקורת הבאה עבור העסק "${name}" (${category}).

שם המבקר: ${review.reviewer_name || 'לקוח'}
דירוג: ${review.rating || '?'}/5
טקסט הביקורת: "${review.text.substring(0, 400)}"

הנחיות סגנון: ${toneInstruction}
${sectorCtx}
דוגמת תגובה לסקטור זה (התאם לביקורת הספציפית): "${sectorExample}"

כללים:
- 2-4 משפטים בלבד
- פתח בפנייה אישית לשם אם ידוע
- הכר בבעיה הספציפית שצוינה — אל תהיה גנרי
- הזמן לפנות ישירות לסגירת הפנייה
- אל תכתוב תירוצים
כתוב את טקסט התגובה בלבד.`,
        });

        const suggestedResponse = typeof responseText === 'string'
          ? responseText.trim()
          : '';

        if (!suggestedResponse) continue;

        // Always pre-fill suggested_response so user can preview in UI
        await prisma.review.update({
          where: { id: review.id },
          data: { suggested_response: suggestedResponse, response_status: 'suggested' },
        });

        const reviewerLabel = review.reviewer_name || 'לקוח';

        // Queue or auto-execute the review reply based on autonomy_level
        const { executed, autoActionId } = await executeOrQueue({
          businessProfileId,
          agentName: 'autoRespondToReviews',
          actionType: 'review_reply',
          description: `תגובה לביקורת של ${reviewerLabel} (${review.rating || '?'}⭐)`,
          payload: {
            reviewId: review.id,
            replyText: suggestedResponse,
            googleReviewId: (review as any).google_review_id || null,
          },
          revenueImpact: 200,
          autoExecuteAfterHours: 4,
        });

        // ProactiveAlert for dashboard visibility (skip if already auto-executed)
        const alertTitle = `ביקורת שלילית: ${reviewerLabel} (${review.rating || '?'}⭐)`;
        if (!executed && !existingTitles.has(alertTitle)) {
          const actionMeta = JSON.stringify({
            action_label: 'פרסם תגובה',
            action_type: 'respond',
            prefilled_text: suggestedResponse,
            urgency_hours: 12,
            impact_reason: 'תגובה מהירה לביקורת שלילית מגדילה אמון ב-30% ומונעת השפעה על דירוג',
            auto_action_id: autoActionId,
          });

          await prisma.proactiveAlert.create({
            data: {
              alert_type: 'negative_review',
              title: alertTitle,
              description: review.text.substring(0, 150),
              suggested_action: `פרסם תגובה מקצועית ל${reviewerLabel}`,
              priority: (review.rating || 5) <= 2 ? 'high' : 'medium',
              source_agent: actionMeta,
              is_dismissed: false,
              is_acted_on: false,
              created_at: new Date().toISOString(),
              linked_business: businessProfileId,
            },
          });
          existingTitles.add(alertTitle);
        }

        processed++;
      } catch (_) {}
    }

    await writeAutomationLog('autoRespondToReviews', businessProfileId, startTime, processed);
    console.log(`autoRespondToReviews done: ${processed} reviews processed`);
    return res.json({ reviews_processed: processed, responses_generated: processed });
  } catch (err: any) {
    console.error('autoRespondToReviews error:', err.message);
    await writeAutomationLog('autoRespondToReviews', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
