import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { getBusinessSectorContext } from '../../lib/sectorInsightConfig';
import { getSectorContext } from '../../lib/sectorContext';
import { loadBusinessContext, formatContextForPrompt } from '../../lib/businessContext';

/**
 * generateAdvisoryInsights — the strategic business advisor engine.
 *
 * Unlike generateProactiveAlerts (which is reactive — hot leads, bad reviews),
 * this engine synthesizes ALL collected OSINT into proactive strategic insights:
 *
 *   • TikTok/social trends the business can exploit
 *   • New services/products competitors offer that you don't
 *   • Upcoming events to leverage (local, seasonal, Israeli calendar)
 *   • Viral content opportunities from detectViralSignals / early trends
 *   • Sector shifts detected from sector knowledge
 *   • Cross-source patterns (trend + competitor + demand_gap all pointing same direction)
 *   • Pricing / promotion opportunities based on competitor intelligence
 *   • Future opportunities from AI predictions
 *
 * Runs alongside generateProactiveAlerts. Both feed the /insights page.
 * Deduplication: 7-day window per alert_type slug.
 */
export async function generateAdvisoryInsights(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    // Load business memory for rejection filtering
    const bizCtx = await loadBusinessContext(businessProfileId);
    const memoryBlock = formatContextForPrompt(bizCtx, 'generateAdvisoryInsights');
    const rejectedPatterns: string[] = bizCtx?.rejectedPatterns || [];

    // ── Pull all intelligence in parallel ──────────────────────────────────────
    const [
      tiktokTrends,
      viralSignals,
      earlyTrends,
      eventSignals,
      competitorMoves,
      demandGaps,
      opportunitySignals,
      threatSignals,
      socialSignals,
      sectorKnowledge,
      predictions,
      healthScore,
      competitors,
      recentReviews,
      existingAdvisory,
      tiktokAudienceSignal,
    ] = await Promise.all([
      // Social & trend intelligence
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId, category: 'tiktok_sector_trend' },
        orderBy: { detected_at: 'desc' },
        take: 10,
      }),
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId, category: 'viral_signal' },
        orderBy: { detected_at: 'desc' },
        take: 8,
      }),
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId, category: 'early_trend' },
        orderBy: { detected_at: 'desc' },
        take: 8,
      }),
      // Events
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId, category: { in: ['event', 'local_event', 'weather_event'] } },
        orderBy: { detected_at: 'desc' },
        take: 8,
      }),
      // Competitor intelligence
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId, category: { in: ['competitor_move', 'competitor_mention'] }, detected_at: { gte: thirtyDaysAgo.toISOString() } },
        orderBy: { detected_at: 'desc' },
        take: 10,
      }),
      // Market signals
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId, category: 'demand_gap' },
        orderBy: { detected_at: 'desc' },
        take: 8,
      }),
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId, category: { in: ['opportunity', 'expansion'] } },
        orderBy: { detected_at: 'desc' },
        take: 8,
      }),
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId, category: 'threat' },
        orderBy: { detected_at: 'desc' },
        take: 5,
      }),
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId, category: { in: ['social', 'mention'] } },
        orderBy: { detected_at: 'desc' },
        take: 8,
      }),
      // Strategic context
      prisma.sectorKnowledge.findFirst({
        where: { sector: profile.category },
        orderBy: { created_date: 'desc' },
      }),
      prisma.prediction.findMany({
        where: { linked_business: businessProfileId, status: 'active' },
        orderBy: { created_date: 'desc' },
        take: 5,
      }),
      prisma.healthScore.findFirst({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
      }),
      // Competitor profiles
      prisma.competitor.findMany({
        where: { linked_business: businessProfileId },
        take: 8,
      }),
      // Recent customer voice
      prisma.review.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 15,
      }),
      // Existing advisory insights — for dedup (includes competitor_intel + competitor_move)
      prisma.proactiveAlert.findMany({
        where: {
          linked_business: businessProfileId,
          is_dismissed: false,
          alert_type: { in: [
            'trend_opportunity', 'new_service', 'promotion_strategy',
            'sector_shift', 'event_opportunity', 'competitive_gap',
            'social_viral', 'future_prediction', 'campaign_opportunity',
            'competitor_intel', 'competitor_move', 'reputation_risk',
            'competitor_attack', 'content_performance', 'review_timing',
            'micro_moment', 'sentiment_drop', 'competitor_mention',
          ]},
          created_at: { gte: sevenDaysAgo.toISOString() },
        },
        select: { alert_type: true, title: true },
      }),
      // TikTok audience profile — for campaign opportunity generation
      prisma.marketSignal.findFirst({
        where: { linked_business: businessProfileId, category: 'tiktok_audience' },
        orderBy: { detected_at: 'desc' },
      }),
    ]);

    // ── Build dedup set ────────────────────────────────────────────────────────
    const recentAdvisoryKeys = new Set(
      existingAdvisory.map(a => `${a.alert_type}:${(a.title || '').toLowerCase().slice(0, 50)}`)
    );

    // ── Build intelligence briefing ────────────────────────────────────────────

    const section = (title: string, items: string[]) =>
      items.length > 0 ? `\n### ${title}\n${items.join('\n')}` : '';

    const fmt = (signals: any[]) =>
      signals.map(s => `  • ${s.summary}${s.recommended_action ? ` → ${s.recommended_action}` : ''}`);

    // Competitor profile summary — enriched with social + pricing intel
    const competitorProfiles = competitors.slice(0, 5).map(c =>
      `  • ${c.name} (${c.rating || '?'}★, ${c.review_count || 0} ביקורות)` +
      `${(c as any).strongest_channel ? ` | ערוץ חזק: ${(c as any).strongest_channel}` : ''}` +
      `${(c as any).engagement_level  ? ` | engagement: ${(c as any).engagement_level}` : ''}` +
      `${(c as any).social_post_frequency ? ` | ${(c as any).social_post_frequency}` : ''}` +
      `${(c as any).current_promotions ? ` | מבצע פעיל: ${(c as any).current_promotions}` : ''}` +
      `${(c as any).last_known_prices  ? ` | מחירים: ${(c as any).last_known_prices}` : ''}` +
      `${c.strengths  ? ` | חוזקות: ${c.strengths}`  : ''}` +
      `${c.weaknesses ? ` | חולשות: ${c.weaknesses}` : ''}` +
      `${(c as any).sentiment_from_reviews ? ` | סנטימנט: ${(c as any).sentiment_from_reviews}` : ''}` +
      `${c.current_promotions ? ` | מבצע עכשיו: ${c.current_promotions}` : ''}`
    );

    // Sector knowledge — static fields + accumulated cross-business learning
    const sectorLines: string[] = [];
    if (sectorKnowledge) {
      if (sectorKnowledge.trending_services) sectorLines.push(`  שירותים מבוקשים בסקטור: ${sectorKnowledge.trending_services}`);
      if (sectorKnowledge.common_complaints) sectorLines.push(`  תלונות נפוצות בסקטור: ${sectorKnowledge.common_complaints}`);
      if (sectorKnowledge.price_range) sectorLines.push(`  טווח מחירים בסקטור: ${sectorKnowledge.price_range}`);
      if (sectorKnowledge.avg_rating) sectorLines.push(`  ממוצע דירוג סקטור: ${sectorKnowledge.avg_rating}★`);
    }
    // Inject accumulated learning from ALL businesses in sector
    const crossBusinessCtx = await getSectorContext(profile.category);
    if (crossBusinessCtx) sectorLines.push(crossBusinessCtx);

    // Health score context
    const healthLines: string[] = [];
    if (healthScore) {
      healthLines.push(`  ציון כולל: ${Math.round(healthScore.overall_score)}/100`);
      if (healthScore.reputation_score) healthLines.push(`  מוניטין: ${Math.round(healthScore.reputation_score)}/100`);
      if (healthScore.seo_score) healthLines.push(`  SEO מקומי: ${Math.round(healthScore.seo_score)}/100`);
      if (healthScore.reviews_needed_for_top3) healthLines.push(`  ביקורות נוספות לטופ-3 Google: ${Math.round(healthScore.reviews_needed_for_top3)}`);
    }

    // Review themes & rating trend
    const negativeThemes = recentReviews
      .filter(r => (r.rating || 5) <= 3 || r.sentiment === 'negative')
      .slice(0, 3)
      .map(r => `  ⚠ "${(r.text || '').slice(0, 80)}" (${r.rating || '?'}★)`);

    const positiveThemes = recentReviews
      .filter(r => (r.rating || 0) >= 4 || r.sentiment === 'positive')
      .slice(0, 3)
      .map(r => `  ✓ "${(r.text || '').slice(0, 60)}"`);

    // Rating trend from history snapshots
    const ratingSnapshots = await prisma.$queryRawUnsafe<any[]>(
      `SELECT avg_rating, review_count, snapped_at FROM rating_history WHERE business_id=$1 ORDER BY snapped_at DESC LIMIT 10`,
      businessProfileId
    ).catch(() => [] as any[]);

    const reputationLines: string[] = [];
    if (ratingSnapshots.length >= 2) {
      const latest = parseFloat(ratingSnapshots[0].avg_rating);
      const oldest = parseFloat(ratingSnapshots[ratingSnapshots.length - 1].avg_rating);
      const delta = +(latest - oldest).toFixed(2);
      reputationLines.push(`  דירוג עכשווי: ${latest.toFixed(2)}★ (שינוי ${delta >= 0 ? '+' : ''}${delta} ב-${ratingSnapshots.length} מדידות)`);
      if (delta < -0.2) reputationLines.push(`  ⚠ מגמת ירידה בדירוג — דורש התייחסות דחופה`);
      if (delta > 0.2) reputationLines.push(`  ✓ מגמת עלייה בדירוג — ממש חיובי, כדאי לנצל`);
    }
    const pendingResponses = recentReviews.filter(r => r.response_status === 'pending').length;
    if (pendingResponses > 0) reputationLines.push(`  ${pendingResponses} ביקורות ממתינות לתגובה`);
    const negCount = recentReviews.filter(r => r.sentiment === 'negative').length;
    if (negCount > 0) {
      const recurrThemes = recentReviews
        .filter(r => r.topics)
        .flatMap(r => (r.topics as string).split(','))
        .reduce((acc: Record<string, number>, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {});
      const topComplaint = Object.entries(recurrThemes).sort((a,b) => b[1]-a[1])[0];
      if (topComplaint) reputationLines.push(`  נושא תלונה מרכזי: "${topComplaint[0]}" (${topComplaint[1]} ביקורות)`);
    }

    // Active predictions
    const predictionLines = predictions.slice(0, 3).map(p =>
      `  • [${p.prediction_type}] ${p.title}: ${p.summary?.slice(0, 100) || ''}`
    );

    const todayDate = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const dayOfWeek = new Date().getDay(); // 0=Sun, 5=Fri
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;

    const intelligenceBriefing = [
      `## עסק: ${profile.name} | ${profile.category} | ${profile.city}`,
      profile.description ? `תיאור: ${profile.description}` : '',
      profile.relevant_services ? `שירותים: ${profile.relevant_services}` : '',
      `תאריך: ${todayDate}${isWeekend ? ' (סוף שבוע)' : ''}`,

      section('ציון בריאות עסקית', healthLines),
      section('מגמת מוניטין ודירוג', reputationLines),
      section('מודיעין סקטור', sectorLines),
      section('פרופיל מתחרים', competitorProfiles),
      section('מהלכי מתחרים (30 יום)', fmt(competitorMoves)),
      section('מגמות TikTok בסקטור', fmt(tiktokTrends)),
      section('אותות ויראליים', fmt(viralSignals)),
      section('טרנדים מוקדמים שזוהו', fmt(earlyTrends)),
      section('אירועים קרובים', fmt(eventSignals)),
      section('פערי ביקוש בשוק', fmt(demandGaps)),
      section('הזדמנויות שוק', fmt(opportunitySignals)),
      section('איומים שזוהו', fmt(threatSignals)),
      section('אותות רשתות חברתיות', fmt(socialSignals)),
      section('תחזיות AI', predictionLines),
      negativeThemes.length > 0 ? section('קולות לקוחות שליליים', negativeThemes) : '',
      positiveThemes.length > 0 ? section('חוזקות שמוזכרות', positiveThemes) : '',
    ].filter(Boolean).join('\n');

    const sectorBlock = getBusinessSectorContext(profile);

    const totalSignals = tiktokTrends.length + viralSignals.length + earlyTrends.length +
      eventSignals.length + competitorMoves.length + demandGaps.length +
      opportunitySignals.length + socialSignals.length;

    if (totalSignals === 0 && !sectorKnowledge) {
      console.log('[generateAdvisoryInsights] insufficient intelligence data, skipping');
      await writeAutomationLog('generateAdvisoryInsights', businessProfileId, startTime, 0);
      return res.json({ insights_created: 0, reason: 'no intelligence data yet' });
    }

    // Throttle: check how many active alerts exist across ALL types
    const activeCount = await prisma.proactiveAlert.count({
      where: { linked_business: businessProfileId, is_dismissed: false, is_acted_on: false },
    });
    const HARD_CAP = 10; // skip if too many already active
    const SOFT_CAP = 6;  // generate max 1-2 if moderately full
    if (activeCount >= HARD_CAP) {
      console.log(`[generateAdvisoryInsights] skipping — ${activeCount} active alerts already (>=${HARD_CAP})`);
      return res.json({ insights_created: 0, skipped: true, reason: 'too_many_active' });
    }
    const maxNewInsights = activeCount >= SOFT_CAP ? 2 : 3;

    // ── LLM synthesis ─────────────────────────────────────────────────────────
    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 3000,
      skipCache: true,
      prompt: `You are a senior business intelligence advisor and strategy consultant for Israeli small businesses.
You have just received a comprehensive intelligence briefing compiled from social media monitoring, competitor tracking, market signals, sector trends, events, and AI predictions.

Your job: synthesize this intelligence into ${maxNewInsights} HIGH-VALUE, NON-OBVIOUS strategic insights.

RULES for high-quality insights:
1. Each insight MUST reference at least one specific data point from the briefing (signal, trend name, competitor name, etc.)
2. Cross-reference multiple sources when possible — e.g., "TikTok trend X + competitor gap Y + demand signal Z all point to opportunity W"
3. NEVER give generic advice like "post more on social media" — always say WHAT, WHERE, WHY NOW
4. Include a concrete "cost of not acting" or quantified opportunity
5. Cover DIVERSE categories — do not generate 4 similar insights. Cover: trends, competitors, services, events, promotions
6. Be time-aware: if an event is soon, or a trend is peaking — say so explicitly

${sectorBlock}
${memoryBlock}
${rejectedPatterns.length > 0 ? `CRITICAL: Do NOT generate insights about these topics (user previously dismissed them): ${rejectedPatterns.slice(0, 6).join(', ')}\n` : ''}
=== INTELLIGENCE BRIEFING ===
${intelligenceBriefing}

=== INSIGHT TYPES AVAILABLE ===
- trend_opportunity: TikTok/social trend to exploit right now
- new_service: new service or product to add based on market signals
- promotion_strategy: specific promotion/pricing action to drive revenue
- sector_shift: important sector-wide change the business must adapt to
- event_opportunity: upcoming event to leverage commercially
- competitive_gap: something competitors offer or do that you don't — and should
- social_viral: viral content angle specific to this business/sector
- future_prediction: AI-predicted opportunity or risk in the next 30-60 days
- reputation_risk: reputation deterioration pattern that requires immediate action (use only if rating dropped or recurring complaint theme found)

Return ONLY valid JSON. ALL string values MUST be in Hebrew:
{"insights": [{
  "title": "כותרת ספציפית — חייב לכלול מספר/שם/פרט קונקרטי",
  "description": "תיאור של 1-2 משפטים: מה זוהה, מאיזה מקורות, ולמה זה חשוב עכשיו",
  "alert_type": "trend_opportunity|new_service|promotion_strategy|sector_shift|event_opportunity|competitive_gap|social_viral|future_prediction|reputation_risk",
  "priority": "critical|high|medium",
  "reasoning": "מה המקורות שמצביעים על זה — ציין אות/טרנד/מתחרה ספציפי",
  "opportunity_size": "הערכת ההזדמנות — ₪X פוטנציאל / X לקוחות / X% גידול",
  "cost_of_inaction": "מה יקרה אם לא יפעלו — נזק קונקרטי",
  "suggested_action": "פעולה ספציפית: מה לעשות, באיזה ערוץ, עם איזה מסר",
  "action_label": "פועל + עצם קצר (עד 4 מילים)",
  "prefilled_text": "טקסט מוכן לשימוש ישיר — פוסט/הודעה/מבצע (50-80 מילים) אם רלוונטי",
  "urgency_hours": 48,
  "data_sources": ["tiktok_trend", "competitor_move", "demand_gap"]
}]}`,
      response_json_schema: { type: 'object' },
    });

    if (!result?.insights || !Array.isArray(result.insights)) {
      console.warn('[generateAdvisoryInsights] no valid insights returned');
      await writeAutomationLog('generateAdvisoryInsights', businessProfileId, startTime, 0, 'failed', 'no insights array');
      return res.json({ insights_created: 0 });
    }

    console.log(`[generateAdvisoryInsights] LLM returned ${result.insights.length} insights`);

    // ── Save non-duplicate insights ────────────────────────────────────────────
    let created = 0;
    for (const insight of result.insights) {
      if (created >= maxNewInsights) break;
      if (!insight.title || !insight.alert_type) continue;

      const dedupKey = `${insight.alert_type}:${(insight.title as string).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 50)}`;
      if (recentAdvisoryKeys.has(dedupKey)) continue;
      // Skip insights that match previously rejected patterns
      if (rejectedPatterns.length > 0) {
        const insightText = ((insight.title || '') + ' ' + (insight.description || '')).toLowerCase();
        if (rejectedPatterns.some((p: string) => p && insightText.includes(p.toLowerCase()))) continue;
      }

      const actionMeta = JSON.stringify({
        action_label:    insight.action_label || insight.suggested_action?.split(' ').slice(0, 3).join(' ') || 'ראה תובנה',
        action_type:     'task',
        prefilled_text:  insight.prefilled_text || '',
        urgency_hours:   insight.urgency_hours || 48,
        impact_reason:   insight.cost_of_inaction || '',
        opportunity_size: insight.opportunity_size || '',
        reasoning:       insight.reasoning || '',
        data_sources:    (insight.data_sources || []).join(', '),
        advisor_type:    'strategic',
      });

      await prisma.proactiveAlert.create({
        data: {
          linked_business:  businessProfileId,
          title:            insight.title,
          description:      `${insight.description || ''}${insight.opportunity_size ? ` | פוטנציאל: ${insight.opportunity_size}` : ''}`,
          alert_type:       insight.alert_type,
          priority:         insight.priority || 'high',
          suggested_action: insight.suggested_action || '',
          source_agent:     actionMeta,
          is_dismissed:     false,
          is_acted_on:      false,
          created_at:       new Date().toISOString(),
        },
      });

      recentAdvisoryKeys.add(dedupKey);
      created++;
    }

    // ── Campaign Opportunity: auto-connect trend + TikTok audience → campaign alert ──
    const hasTrendSignals = tiktokTrends.length > 0 || viralSignals.length > 0;
    const alreadyHasCampaignOpp = existingAdvisory.some(a => a.alert_type === 'campaign_opportunity');

    if (hasTrendSignals && tiktokAudienceSignal && !alreadyHasCampaignOpp && activeCount + created < HARD_CAP) {
      try {
        let audienceData: any = null;
        try { audienceData = JSON.parse(tiktokAudienceSignal.source_description || '{}'); } catch {}

        const trendSignal = tiktokTrends[0] || viralSignals[0];
        const platform   = audienceData?.dominant_platform || 'instagram';
        const ageRange   = audienceData?.age_range || '25-40';
        const genderSkew = audienceData?.gender_skew || '';
        const bestTime   = audienceData?.optimal_posting_hours || '19:00-21:00';
        const hooks      = (audienceData?.hooks_that_work || []).slice(0, 2).join(', ');

        // Generate a ready-to-use post text for the campaign
        const postResult = await invokeLLM({
          model: 'haiku',
          maxTokens: 200,
          prompt: `כתוב פוסט שיווקי קצר בעברית לעסק "${profile.name}" (${profile.category}, ${profile.city}).
בסיס הפוסט על הטרנד: "${trendSignal?.summary?.slice(0, 120) || ''}".
קהל יעד: גיל ${ageRange}${genderSkew ? `, ${genderSkew}` : ''}.
הוקים שעובדים: ${hooks || 'ערך, דחיפות'}.
כתוב רק טקסט הפוסט: Hook + ערך + CTA. 40-60 מילים. בעברית.`,
        });

        const postText = typeof postResult === 'string' ? postResult.trim() : '';

        const campaignParams = new URLSearchParams({
          summary:      (trendSignal?.summary || '').slice(0, 100),
          platform,
          audience_age: ageRange,
          best_time:    bestTime,
        });
        const campaignUrl = `/marketing/create?${campaignParams.toString()}`;

        const alertTitle = `הזדמנות קמפיין: ${(trendSignal?.summary || 'טרנד עולה').slice(0, 60)}`;

        const existingCampOpp = await prisma.proactiveAlert.findFirst({
          where: {
            linked_business: businessProfileId,
            alert_type: 'campaign_opportunity',
            is_dismissed: false,
            created_at: { gte: sevenDaysAgo.toISOString() },
          },
          select: { id: true },
        });

        if (!existingCampOpp) {
          const campaignMeta = JSON.stringify({
            action_label:     'צור קמפיין ממוקד',
            action_type:      'create_campaign_with_audience',
            action_platform:  platform,
            prefilled_text:   postText,
            audience_age:     ageRange,
            audience_gender:  genderSkew,
            best_time:        bestTime,
            audience_hooks:   hooks,
            campaign_url:     campaignUrl,
            urgency_hours:    48,
            impact_reason:    'טרנד + קהל יעד מזוהה — חלון הזדמנות צר לפני שמתחרים יפעלו',
          });

          await prisma.proactiveAlert.create({
            data: {
              linked_business:  businessProfileId,
              title:            alertTitle,
              description:      `זוהה טרנד "${(trendSignal?.summary || '').slice(0, 80)}" ופרופיל קהל יעד מ-TikTok (גיל ${ageRange}). הזדמנות לקמפיין ממוקד עם טרגטינג מוכן.`,
              alert_type:       'campaign_opportunity',
              priority:         'high',
              suggested_action: `צור קמפיין בפלטפורמת ${platform} ממוקד לגיל ${ageRange}, שעת פרסום מומלצת: ${bestTime}`,
              source_agent:     campaignMeta,
              is_dismissed:     false,
              is_acted_on:      false,
              created_at:       new Date().toISOString(),
            },
          });
          created++;
          console.log(`[generateAdvisoryInsights] created campaign_opportunity alert for ${profile.name}`);
        }
      } catch (campErr: any) {
        console.warn('[generateAdvisoryInsights] campaign_opportunity failed:', campErr.message);
      }
    }

    await writeAutomationLog('generateAdvisoryInsights', businessProfileId, startTime, created);
    console.log(`[generateAdvisoryInsights] created ${created} advisory insights for ${profile.name}`);
    return res.json({ insights_created: created, total_signals_analyzed: totalSignals });

  } catch (err: any) {
    console.error('[generateAdvisoryInsights] error:', err.message);
    await writeAutomationLog('generateAdvisoryInsights', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
