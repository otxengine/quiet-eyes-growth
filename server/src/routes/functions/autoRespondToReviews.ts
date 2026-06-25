import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { loadBusinessContext } from '../../lib/businessContext';
import { executeOrQueue } from '../../services/execution/executeOrQueue';
import { getSectorReviewResponse } from '../../lib/sectorPrompts';
import { getAllMissions } from '../../lib/missionPlanner';
import { validateAction } from '../../lib/constraintValidator';
import { publishEvent } from '../../lib/eventBus';

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

    // Respect the auto_respond_enabled toggle in Settings
    if (profile.auto_respond_enabled === false) {
      await writeAutomationLog('autoRespondToReviews', businessProfileId, startTime, 0);
      return res.json({ responses_created: 0, skipped: true, reason: 'auto_respond_disabled' });
    }

    const { name, category } = profile;

    // Load business tone preference
    const bizCtx = await loadBusinessContext(businessProfileId);
    const tone = bizCtx?.preferredTone || profile.tone_preference || 'professional';
    const toneInstruction = tone === 'casual'
      ? 'casual and friendly tone, short and human reply'
      : tone === 'warm'
      ? 'warm and personal tone, without being salesy'
      : 'professional and trustworthy tone, specific to the review';

    // Mission intelligence: sector-tuned review response templates
    const allMissions = getAllMissions(profile);
    const reviewTemplates = allMissions?.content?.review_response_templates_he;
    const positiveTemplate = reviewTemplates?.positive || '';
    const negativeTemplate = reviewTemplates?.negative || '';
    const neutralTemplate  = reviewTemplates?.neutral  || '';

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600000).toISOString();

    // Priority 1: negative/low reviews from last 30 days
    const negativeReviews = await prisma.review.findMany({
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
      take: 8,
    });

    // Also grab all-time unresponded negative reviews if we got fewer than 5
    const allNegative = negativeReviews.length < 5
      ? await prisma.review.findMany({
          where: {
            linked_business: businessProfileId,
            suggested_response: null,
            OR: [{ sentiment: 'negative' }, { rating: { lte: 3 } }],
          },
          orderBy: { created_date: 'desc' },
          take: 8,
        })
      : negativeReviews;

    // Priority 2: positive reviews with no response — brand building (last 14 days, cap 3)
    const positiveReviews = await prisma.review.findMany({
      where: {
        linked_business: businessProfileId,
        suggested_response: null,
        response_status: 'pending',
        sentiment: 'positive',
        rating: { gte: 4 },
        created_date: { gte: new Date(Date.now() - 14 * 86400000).toISOString() },
      },
      orderBy: { created_date: 'desc' },
      take: 3,
    });

    // Merge: negative first, then positive (deduplicated by id)
    const seenIds = new Set<string>();
    const merged: typeof allNegative = [];
    for (const r of [...allNegative, ...positiveReviews]) {
      if (!seenIds.has(r.id)) { seenIds.add(r.id); merged.push(r); }
    }
    const toProcess = merged.slice(0, 10);

    const existingAlerts = await prisma.proactiveAlert.findMany({
      where: { linked_business: businessProfileId, is_dismissed: false, alert_type: 'negative_review' },
      select: { title: true },
    });
    const existingTitles = new Set(existingAlerts.map(a => a.title));

    let processed = 0;

    for (const review of toProcess) {
      try {
        const isNegative = (review.rating || 5) <= 3;
        const isNeutral  = (review.rating || 5) === 3 || (review.rating || 5) === 4;
        const sectorExample = getSectorReviewResponse(category, isNegative ? 'negative' : 'positive');

        // Pick the right mission template based on sentiment
        const missionTemplate = isNegative
          ? negativeTemplate
          : isNeutral
          ? neutralTemplate
          : positiveTemplate;

        // Generate Hebrew response
        const responseText = await invokeLLM({
          model: 'sonnet',
          maxTokens: 300,
          profile,
          prompt: `You are a reputation management expert for Israeli small businesses.
Write a review response that turns ${isNegative ? 'a disappointed customer into a returning one' : 'a satisfied customer into a loyal ambassador'} — and convinces every new reader to choose this business.

Reviewer: ${review.reviewer_name || 'לקוח'}
Rating: ${review.rating || '?'}/5
Review text: "${(review.text || '').substring(0, 500)}"

Tone: ${toneInstruction}
${missionTemplate ? `Sector-tuned style guide (DO NOT copy, use as tone/structure inspiration):\n"${missionTemplate}"` : `Sector example: "${sectorExample}"`}

Critical rules:
1. Open by addressing the reviewer by name (if given) — not "שלום" or "לקוח יקר"
2. Reference ONE specific thing they mentioned — shows you actually read it
3. ${isNegative ? 'Take ownership without excuses. Offer a specific fix or personal conversation (not a hotline)' : 'Express genuine gratitude + reinforce one specific value they mentioned'}
4. 2-4 sentences ONLY — tight, human, specific
5. NEVER use: "מצטערים לשמוע", "נשמח לסייע", "ברשותנו", "כרגיל" — these are generic and kill trust
6. End with an invitation or a forward-looking note, not a corporate sign-off
Write ONLY the final response text in Hebrew.`,
        });

        const suggestedResponse = typeof responseText === 'string'
          ? responseText.trim()
          : '';

        if (!suggestedResponse) continue;

        // OTX-004: validate generated reply against business constraints
        const validation = await validateAction(businessProfileId, {
          type: 'review_reply',
          content: suggestedResponse,
          platform: 'google',
        });
        const validatedReply = validation.action.content || suggestedResponse;

        // Always pre-fill suggested_response so user can preview in UI
        await prisma.review.update({
          where: { id: review.id },
          data: { suggested_response: validatedReply, response_status: 'suggested' },
        });

        const reviewerLabel = review.reviewer_name || 'לקוח';

        // OTX-001: publish event so routing engine can trigger other agents
        publishEvent({
          businessId: businessProfileId,
          eventType: 'new_review',
          source: 'autoRespondToReviews',
          payload: { reviewId: review.id, rating: review.rating, sentiment: review.sentiment },
          contextAttrs: { category: profile.category, city: profile.city, impact: review.rating <= 2 ? 'high' : 'medium' },
        }).catch(() => {});

        // Queue or auto-execute the review reply based on autonomy_level
        const { executed, autoActionId } = await executeOrQueue({
          businessProfileId,
          agentName: 'autoRespondToReviews',
          actionType: 'review_reply',
          description: `תגובה לביקורת של ${reviewerLabel} (${review.rating || '?'}⭐)`,
          payload: {
            reviewId: review.id,
            replyText: validatedReply,
            googleReviewId: (review as any).google_review_id || null,
          },
          revenueImpact: 200,
          autoExecuteAfterHours: 4,
          // OTX-003: confidence based on review negativity
          confidenceScore: review.rating <= 2 ? 90 : 75,
          predictedImpact: review.rating <= 2 ? 'high' : 'medium',
          constraintNotes: validation.constraintNotes,
        });

        // ProactiveAlert for dashboard visibility — only for negative/low reviews (skip for positive)
        const alertTitle = isNegative
          ? `ביקורת שלילית: ${reviewerLabel} (${review.rating || '?'}⭐)`
          : null;
        if (!executed && alertTitle && !existingTitles.has(alertTitle)) {
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
              title: alertTitle!,
              description: (review.text || '').substring(0, 150),
              suggested_action: `פרסם תגובה מקצועית ל${reviewerLabel}`,
              priority: (review.rating || 5) <= 2 ? 'high' : 'medium',
              source_agent: actionMeta,
              is_dismissed: false,
              is_acted_on: false,
              created_at: new Date().toISOString(),
              linked_business: businessProfileId,
            },
          });
          if (alertTitle) existingTitles.add(alertTitle);
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
