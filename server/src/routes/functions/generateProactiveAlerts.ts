import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { invokeLLM } from '../../lib/llm';
import { loadBusinessContext, formatContextForPrompt } from '../../lib/businessContext';
import { insightAutoResolve } from './insightAutoResolve';
import { getBusinessSectorContext } from '../../lib/sectorInsightConfig';
import { getAgentMission, getAllMissions } from '../../lib/missionPlanner';
import { getSectorContentStrategy } from '../../lib/sectorPrompts';
import { getSectorContext as getAccumulatedSectorCtx } from '../../lib/sectorContext';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { getTrendContext } from '../../lib/trendContext';

const MIN_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours between LLM generations

export async function generateProactiveAlerts(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    // Auto-resolve stale / condition-cleared alerts before generating new ones
    const resolved = await insightAutoResolve(businessProfileId);

    // Cooldown: only run the expensive LLM generation every 4 hours
    if (shouldSkipAgent(businessProfileId, 'generateProactiveAlerts', MIN_INTERVAL_MS)) {
      return res.json({ alerts_created: 0, items_created: 0, skipped: true, reason: 'cooldown', auto_resolved: resolved });
    }

    // Throttle: check how many active alerts exist — don't overwhelm the user
    const activeCount = await prisma.proactiveAlert.count({
      where: { linked_business: businessProfileId, is_dismissed: false, is_acted_on: false },
    });
    const HARD_CAP = 10; // skip generation entirely if already crowded
    const SOFT_CAP = 6;  // generate max 2 new ones if moderately full
    if (activeCount >= HARD_CAP) {
      console.log(`[generateProactiveAlerts] skipping — ${activeCount} active alerts already (>=${HARD_CAP})`);
      return res.json({ alerts_created: 0, items_created: 0, skipped: true, reason: 'too_many_active' });
    }
    const maxNewAlerts = activeCount >= SOFT_CAP ? 2 : 4;

    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000).toISOString();

    const [recentReviews, hotLeads, signals, competitors, pendingAlerts, audienceSignal, demandGaps, lostLeads, recentCompetitorMoves] = await Promise.all([
      prisma.review.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 20 }),
      prisma.lead.findMany({ where: { linked_business: businessProfileId, status: 'hot' }, orderBy: { created_date: 'desc' }, take: 15 }),
      prisma.marketSignal.findMany({ where: { linked_business: businessProfileId }, orderBy: { detected_at: 'desc' }, take: 20 }),
      prisma.competitor.findMany({ where: { linked_business: businessProfileId }, take: 8 }),
      prisma.proactiveAlert.findMany({ where: { linked_business: businessProfileId, is_dismissed: false } }),
      prisma.marketSignal.findFirst({ where: { linked_business: businessProfileId, category: 'tiktok_audience' }, orderBy: { detected_at: 'desc' } }),
      prisma.marketSignal.findMany({ where: { linked_business: businessProfileId, category: 'demand_gap' }, orderBy: { detected_at: 'desc' }, take: 5 }),
      prisma.lead.findMany({ where: { linked_business: businessProfileId, status: { in: ['lost', 'cold'] } }, orderBy: { created_date: 'desc' }, take: 10 }),
      // Specific competitor moves from last 7 days for context
      prisma.marketSignal.findMany({ where: { linked_business: businessProfileId, category: 'competitor_move', detected_at: { gte: new Date(Date.now() - 7 * 86400000).toISOString() } }, orderBy: { detected_at: 'desc' }, take: 5 }),
    ]);

    const existingTitles = new Set(pendingAlerts.map(a => a.title));

    // Fuzzy dedup: 7-day window for active alerts
    const sevenDaysAgoStr = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
    const recentAlerts = pendingAlerts.filter(a => (a.created_at || '') >= sevenDaysAgoStr);
    const recentFuzzyKeys = new Set(
      recentAlerts.map(a => `${a.alert_type}:${(a.title || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 50)}`)
    );

    // Dismissed dedup: suppress alerts the user manually dismissed for 30 days
    // so they don't come back on the very next scan cycle
    const thirtyDaysAgoStr = new Date(Date.now() - 30 * 24 * 3600000).toISOString();
    const recentlyDismissed = await prisma.proactiveAlert.findMany({
      where: {
        linked_business: businessProfileId,
        is_dismissed: true,
        created_at: { gte: thirtyDaysAgoStr },
      },
      select: { alert_type: true, title: true },
    });
    for (const a of recentlyDismissed) {
      recentFuzzyKeys.add(`${a.alert_type}:${(a.title || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 50)}`);
    }

    // Also block alert_types that were acted on in the past 3 days (user already acted)
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600000).toISOString();
    const recentlyActedTypes = new Set(
      pendingAlerts
        .filter(a => a.is_acted_on && (a.created_at || '') >= threeDaysAgo)
        .map(a => a.alert_type)
    );

    // Load recently completed alerts for prompt context (last 7 days)
    const recentlyCompleted = await prisma.proactiveAlert.findMany({
      where: { linked_business: businessProfileId, is_acted_on: true, created_at: { gte: sevenDaysAgoStr } },
      select: { title: true, alert_type: true },
      orderBy: { created_at: 'desc' },
      take: 8,
    });

    const negativeReviews = recentReviews.filter(r => r.sentiment === 'negative' || (r.rating || 5) <= 2);
    const avgRating = recentReviews.length > 0
      ? (recentReviews.reduce((s, r) => s + (r.rating || 4), 0) / recentReviews.length).toFixed(1)
      : null;

    // Parse TikTok audience for better persona targeting
    let audienceInfo = '';
    if (audienceSignal?.source_description) {
      try {
        const aud = JSON.parse(audienceSignal.source_description);
        const pa = aud.primary_audience;
        if (pa) {
          audienceInfo = `קהל יעד מאומת: גיל ${pa.age_range}, ${pa.gender_skew}. כאבים: ${(pa.pain_points || []).join(', ')}. Hooks: ${(aud.hooks_that_work || []).slice(0, 2).join(' | ')}`;
        }
      } catch {}
    }

    // Rich lead context — include days waiting and service requested
    const hotLeadDetails = hotLeads.slice(0, 5).map(l => {
      const daysAgo = l.created_date
        ? Math.floor((Date.now() - new Date(l.created_date).getTime()) / 86400000)
        : null;
      return `${l.name || 'ליד'} (שירות: ${l.service_needed || 'לא צוין'}${daysAgo !== null ? `, מחכה ${daysAgo} ימים` : ''})`;
    });

    // Rich review context — include actual negative review texts
    const negativeReviewTexts = negativeReviews.slice(0, 3).map(r =>
      `  ⚠ "${(r.text || '').substring(0, 100)}" (${r.rating || '?'}★, מ: ${r.reviewer_name || 'אנונימי'})`
    );

    // Recent competitor moves — specific actions
    const competitorMoveTexts = recentCompetitorMoves.slice(0, 3).map(s =>
      `  → ${s.summary}`
    );

    const contextBlock = [
      `עסק: ${profile.name} (${profile.category}, ${profile.city})`,
      profile.description ? `תיאור: ${profile.description}` : '',
      profile.relevant_services ? `שירותים: ${profile.relevant_services}` : '',

      // Reviews — with actual text
      recentReviews.length > 0
        ? [
            `ביקורות: ${recentReviews.length} סה"כ | ממוצע ${avgRating}⭐ | ${negativeReviews.length} שליליות`,
            negativeReviewTexts.length > 0 ? `ביקורות שליליות אחרונות:\n${negativeReviewTexts.join('\n')}` : '',
          ].filter(Boolean).join('\n')
        : 'ביקורות: אין עדיין',

      // Hot leads — with details
      hotLeads.length > 0
        ? `לידים חמים (${hotLeads.length}):\n${hotLeadDetails.map(l => `  • ${l}`).join('\n')}`
        : 'לידים חמים: אין',

      lostLeads.length > 0
        ? `לידים שאבדו / קרים: ${lostLeads.length}`
        : '',

      // Competitor moves — specific
      recentCompetitorMoves.length > 0
        ? `מהלכי מתחרים (7 ימים אחרונים):\n${competitorMoveTexts.join('\n')}`
        : '',

      signals.length > 0
        ? `אותות שוק:\n${signals.slice(0, 5).map(s => `  • [${s.category || 'שוק'}] ${s.summary}`).join('\n')}`
        : '',

      demandGaps.length > 0
        ? `פערי ביקוש:\n${demandGaps.slice(0, 3).map(g => `  • ${g.summary}`).join('\n')}`
        : '',

      competitors.length > 0
        ? `מתחרים (${competitors.length}): ${competitors.slice(0, 5).map(c => `${c.name}(${c.rating || '?'}⭐)`).join(', ')}`
        : 'מתחרים: לא זוהו',

      audienceInfo ? `קהל יעד: ${audienceInfo}` : '',
    ].filter(Boolean).join('\n');

    // Sector-specific intelligence blocks
    const sectorInsightBlock = getBusinessSectorContext(profile);
    const sectorContentBlock = getSectorContentStrategy(profile.category);
    const accumulatedSectorCtx = await getAccumulatedSectorCtx(profile.category);

    // Mission intelligence — if available, inject agent-specific priorities
    const alertMission = getAgentMission<{
      priority_alert_types?: string[];
      opportunity_triggers_he?: string[];
      ignore_signal_types?: string[];
    }>(profile, 'generateProactiveAlerts');
    const allMissions = getAllMissions(profile);
    const missionBlock = alertMission ? `
=== תכנית משימות מותאמת (נוצרה ע"י AI בעת ההרשמה) ===
סוגי התראות בעדיפות: ${(alertMission.priority_alert_types || []).join(', ')}
טריגרים להזדמנויות: ${(alertMission.opportunity_triggers_he || []).join(' | ')}
סיכום עסק: ${allMissions?.business_summary || ''}
${allMissions?.osint_persona ? `OSINT persona: ${allMissions.osint_persona}` : ''}
=== סוף תכנית משימות ===` : '';

    const todayDate = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });

    const isNewBusiness = recentReviews.length === 0 && hotLeads.length === 0 && signals.length === 0;

    // Inject learned business context (tone, channels, rejected patterns)
    const bizCtx = await loadBusinessContext(businessProfileId);
    const ctxPrompt = formatContextForPrompt(bizCtx, 'generateProactiveAlerts');

    // AI intelligence context (sector profile + deep profile)
    const trendCtx = await getTrendContext(businessProfileId, 'generateProactiveAlerts');

    // Build recently-done context so agent doesn't re-suggest what was already handled
    const recentlyDoneBlock = recentlyCompleted.length > 0
      ? `\nAlready handled in the past 7 days (DO NOT re-suggest these):\n${recentlyCompleted.map(a => `  • [${a.alert_type}] ${a.title}`).join('\n')}`
      : '';

    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 2500,
      skipCache: true,
      prompt: `You are a senior proactive monitoring system for small Israeli businesses. Today: ${todayDate}.
Your task: identify the MOST CONCRETE and SECTOR-SPECIFIC opportunities and risks. Every insight must reference a real data point (reviewer name, lead name, competitor name, specific number).
Return ONLY valid JSON. ALL string values must be in Hebrew.

${ctxPrompt}
${sectorInsightBlock}
${trendCtx.sectorBlock}
${trendCtx.deepProfileBlock}
${missionBlock}

${sectorContentBlock}
${accumulatedSectorCtx ? `\n${accumulatedSectorCtx}` : ''}
=== נתוני העסק ===
${contextBlock}
${recentlyDoneBlock}

${isNewBusiness ? `⚠️ New business: no historical data yet.
Generate 2-3 initial CRITICAL recommendations for this sector — what every new business must do in the first week.
` : ''}

Non-negotiable quality rules:
1. TITLE: must include a specific name / number / action — e.g. "negative review from X", "3 hot leads waiting", "TikTok trend to leverage"
2. DESCRIPTION: a concrete fact from the data — no generic generalizations
3. SUGGESTED_ACTION: imperative verb + channel + content (e.g. "Post a Reel on TikTok about X", "Send personal WhatsApp to Y", "Reply to Z's review")
4. PREFILLED_TEXT: ready-to-use text the user can copy and send directly — 40-80 words, in the business's name, human + professional tone.
   For posts: includes Hook + body + CTA + relevant hashtags.
   For replies: includes customer name, reference to content, resolution.
   For WhatsApp: friendly, short, with clear CTA.
5. ACTION_TYPE: post_publish=social media post (generates full post) | respond=reply to review/customer | call=phone call | task=internal task | promote=paid promotion
6. PLATFORM: choose by: instagram=visual content 18-40 | tiktok=viral 16-30 | facebook=local 30+ | google=reviews/SEO | whatsapp=direct communication | general=cross-platform
7. URGENCY_HOURS: realistic time — negative review=2h, hot lead=4h, market opportunity=24h, content=48h

Generate ${maxNewAlerts} diverse, non-duplicate alerts. Return ONLY valid JSON:
{"alerts":[{
  "title": "כותרת ספציפית עם פרטים",
  "description": "הסבר ממוקד מה קרה ולמה זה חשוב עכשיו (עד 120 תווים)",
  "alert_type": "negative_review|hot_lead|competitor_move|competitor_attack|market_opportunity|retention_risk|demand_gap|content_opportunity|reputation_risk",
  "priority": "critical|high|medium|low",
  "suggested_action": "פעולה ספציפית מפורטת — ערוץ + תוכן + קהל",
  "action_label": "פועל + עצם (עד 4 מילים)",
  "action_type": "post_publish|respond|call|task|promote",
  "action_platform": "instagram|facebook|tiktok|google|whatsapp|wolt|ten_bis|general",
  "platform_reason": "מדוע פלטפורמה זו — משפט אחד עם נימוק",
  "prefilled_text": "טקסט מוכן שאפשר לשלוח/לפרסם ישירות בעברית — 40-80 מילים",
  "urgency_hours": 4,
  "impact_reason": "מה יקרה אם לא יפעלו עכשיו — נזק קונקרטי"
}]}`,
      response_json_schema: { type: 'object' },
    });

    const rawAlerts: any[] = result?.alerts || [];

    // Memory suppression — filter alerts matching rejected patterns
    const rejectedPatterns: string[] = (bizCtx as any)?.rejected_patterns
      ? ((bizCtx as any).rejected_patterns as string).split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
      : [];

    const filteredAlerts = rawAlerts.filter(alert => {
      if (!alert.title) return false;
      const text = `${alert.title} ${alert.description || ''}`.toLowerCase();
      return !rejectedPatterns.some(p => p && text.includes(p));
    });

    // Insight clustering — group by alert_type, keep highest-priority per type
    const priorityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    const byType: Record<string, any[]> = {};
    for (const alert of filteredAlerts) {
      const t = alert.alert_type || 'general';
      if (!byType[t]) byType[t] = [];
      byType[t].push(alert);
    }
    const alerts = Object.values(byType).map(group => {
      if (group.length === 1) return group[0];
      group.sort((a: any, b: any) => (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0));
      const best = { ...group[0] };
      if (group.length > 1) {
        best.description = `${best.description || ''} (כולל ${group.length - 1} תופעות דומות נוספות)`.trim();
      }
      return best;
    });

    let created = 0;

    for (const alert of alerts) {
      if (created >= maxNewAlerts) break;
      if (!alert.title || existingTitles.has(alert.title)) continue;
      // Fuzzy dedup: same alert_type + similar title within 7 days
      const fuzzyKey = `${alert.alert_type}:${(alert.title as string).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 50)}`;
      if (recentFuzzyKeys.has(fuzzyKey)) continue;
      // Skip types that were already acted on in the past 3 days
      if (recentlyActedTypes.has(alert.alert_type)) continue;

      // Store action metadata in source_agent as JSON (unified with MarketSignal format)
      const actionMeta = JSON.stringify({
        action_label:    alert.action_label || alert.suggested_action?.split(' ').slice(0, 3).join(' ') || 'פתח משימה',
        action_type:     alert.action_type || 'task',
        action_platform: alert.action_platform || '',
        platform_reason: alert.platform_reason || '',
        prefilled_text:  alert.prefilled_text || alert.prefilled_content || '',
        urgency_hours:   alert.urgency_hours || 24,
        impact_reason:   alert.impact_reason || '',
      });

      await prisma.proactiveAlert.create({
        data: {
          title: alert.title,
          description: alert.description || '',
          alert_type: alert.alert_type || 'general',
          priority: alert.priority || 'medium',
          suggested_action: alert.suggested_action || '',
          source_agent: actionMeta,  // repurposed field for action metadata
          is_dismissed: false,
          is_acted_on: false,
          created_at: new Date().toISOString(),
          linked_business: businessProfileId,
        },
      });
      existingTitles.add(alert.title);
      recentFuzzyKeys.add(fuzzyKey);
      created++;
    }

    setLastRun(businessProfileId, 'generateProactiveAlerts');
    await writeAutomationLog('generateProactiveAlerts', businessProfileId, startTime, created);
    console.log(`generateProactiveAlerts done: ${created} alerts created`);
    return res.json({ alerts_created: created, items_created: created });
  } catch (err: any) {
    console.error('generateProactiveAlerts error:', err.message);
    await writeAutomationLog('generateProactiveAlerts', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
