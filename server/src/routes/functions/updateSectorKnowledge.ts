/**
 * updateSectorKnowledge — cross-business sector learning engine
 *
 * Aggregates data from ALL businesses in each sector to build cumulative
 * sector intelligence that grows over time.
 *
 * Data sources (all businesses in sector):
 *   ProactiveAlert  → which alert types actually get acted on (conversion rates)
 *   Lead            → conversion rates, top sources, closed-deal patterns
 *   Review          → positive/negative themes, avg rating
 *   MarketSignal    → which signal categories correlate with action
 *   Competitor      → rating benchmarks, price ranges
 *   HealthScore     → sector baseline health
 *   RawSignal       → signal frequency by type
 *
 * Output: SectorKnowledge.winner_lead_dna filled with rich JSON patterns
 * that agents read via getSectorContext() before generating insights.
 *
 * Runs: end of every runFullScan + daily cron
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { invokeLLM } from '../../lib/llm';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { refreshMissionsIfStale } from '../../lib/missionPlanner';

const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

export async function updateSectorKnowledge(req: Request, res: Response) {
  const { businessProfileId } = req.body;

  if (businessProfileId && shouldSkipAgent(businessProfileId, 'updateSectorKnowledge', MIN_INTERVAL_MS)) {
    return res.json({ updated: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  try {
    // Aggregate across ALL businesses (or just the sector of this business)
    const allProfiles = businessProfileId
      ? await prisma.businessProfile.findMany({ where: { id: businessProfileId } })
      : await prisma.businessProfile.findMany();

    if (allProfiles.length === 0) return res.json({ updated: 0, message: 'No profiles' });

    // Group by sub_sector (from AI-parsed sector_profile) when available,
    // fall back to category. This ensures UI/UX designer and graphic designer
    // don't share the same SectorKnowledge bucket.
    const bySector = new Map<string, typeof allProfiles>();
    for (const p of allProfiles) {
      if (!p.category) continue;
      let sectorKey = p.category;
      if (p.sector_profile) {
        try {
          const sp = JSON.parse(p.sector_profile);
          if (sp.sub_sector) sectorKey = sp.sub_sector;
        } catch {}
      }
      const list = bySector.get(sectorKey) || [];
      list.push(p);
      bySector.set(sectorKey, list);
    }

    let totalUpdated = 0;

    for (const [sector, sectorProfiles] of bySector.entries()) {
      const ids = sectorProfiles.map(p => p.id);

      // ── Pull ALL data types from ALL businesses in this sector ────────────
      const [
        alerts,
        leads,
        reviews,
        marketSignals,
        rawSignals,
        competitors,
        healthScores,
      ] = await Promise.all([
        prisma.proactiveAlert.findMany({
          where: { linked_business: { in: ids } },
          select: { alert_type: true, is_acted_on: true, priority: true },
        }),
        prisma.lead.findMany({
          where: { linked_business: { in: ids } },
          select: { source: true, status: true, lifecycle_stage: true, score: true, service_needed: true, closed_value: true },
        }),
        prisma.review.findMany({
          where: { linked_business: { in: ids } },
          select: { rating: true, sentiment: true, text: true },
          orderBy: { created_date: 'desc' },
          take: 300,
        }),
        prisma.marketSignal.findMany({
          where: { linked_business: { in: ids } },
          select: { category: true, impact_level: true, confidence: true, is_read: true },
        }),
        prisma.rawSignal.findMany({
          where: { linked_business: { in: ids } },
          select: { signal_type: true, sentiment: true },
          orderBy: { created_date: 'desc' },
          take: 200,
        }),
        prisma.competitor.findMany({
          where: { linked_business: { in: ids } },
          select: { rating: true, price_range: true, review_count: true },
        }),
        prisma.healthScore.findMany({
          where: { linked_business: { in: ids } },
          select: { overall_score: true },
          orderBy: { created_date: 'desc' },
          take: ids.length,
        }),
      ]);

      // ── Alert conversion rates ────────────────────────────────────────────
      const alertMap = new Map<string, { total: number; acted: number }>();
      for (const a of alerts) {
        const t = a.alert_type || 'unknown';
        const e = alertMap.get(t) || { total: 0, acted: 0 };
        e.total++;
        if (a.is_acted_on) e.acted++;
        alertMap.set(t, e);
      }
      const alertConversionRates: Record<string, number> = {};
      for (const [type, { total, acted }] of alertMap.entries()) {
        if (total >= 2) alertConversionRates[type] = Math.round((acted / total) * 100);
      }
      const topAlertType = Object.entries(alertConversionRates)
        .sort(([, a], [, b]) => b - a)[0]?.[0] || null;

      // ── Lead patterns ─────────────────────────────────────────────────────
      const closedLeads = leads.filter(l =>
        l.lifecycle_stage === 'closed_won' || l.status === 'completed'
      );
      const conversionRate = leads.length > 0
        ? Math.round((closedLeads.length / leads.length) * 100)
        : 0;

      const sourceCount = new Map<string, number>();
      for (const l of closedLeads) {
        const s = l.source || 'unknown';
        sourceCount.set(s, (sourceCount.get(s) || 0) + 1);
      }
      const topLeadSources = [...sourceCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([s]) => s);

      const serviceCount = new Map<string, number>();
      for (const l of closedLeads) {
        if (!l.service_needed) continue;
        serviceCount.set(l.service_needed, (serviceCount.get(l.service_needed) || 0) + 1);
      }
      const topClosedServices = [...serviceCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([s]) => s);

      // ── Review themes ─────────────────────────────────────────────────────
      const ratedReviews = reviews.filter(r => r.rating);
      const avgRating = ratedReviews.length > 0
        ? ratedReviews.reduce((s, r) => s + (r.rating || 0), 0) / ratedReviews.length
        : null;

      const negativeTexts = reviews
        .filter(r => r.sentiment === 'negative' && r.text)
        .slice(0, 15)
        .map(r => (r.text || '').substring(0, 120));

      const positiveTexts = reviews
        .filter(r => r.sentiment === 'positive' && r.text)
        .slice(0, 15)
        .map(r => (r.text || '').substring(0, 120));

      // ── Signal patterns ───────────────────────────────────────────────────
      const sigCatCount = new Map<string, number>();
      for (const s of marketSignals) {
        const t = s.category || 'unknown';
        sigCatCount.set(t, (sigCatCount.get(t) || 0) + 1);
      }
      const topSignalCategories = [...sigCatCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([t, n]) => ({ type: t, count: n }));

      const rawSigCount = new Map<string, number>();
      for (const s of rawSignals) {
        const t = s.signal_type || 'unknown';
        rawSigCount.set(t, (rawSigCount.get(t) || 0) + 1);
      }

      // ── Competitor benchmarks ─────────────────────────────────────────────
      const ratedComp = competitors.filter(c => c.rating);
      const avgCompRating = ratedComp.length > 0
        ? ratedComp.reduce((s, c) => s + (c.rating || 0), 0) / ratedComp.length
        : null;

      // ── Health score baseline ─────────────────────────────────────────────
      const avgHealth = healthScores.length > 0
        ? Math.round(healthScores.reduce((s, h) => s + (h.overall_score || 0), 0) / healthScores.length)
        : null;

      // ── LLM synthesis ─────────────────────────────────────────────────────
      const skip = !negativeTexts.length && !positiveTexts.length && leads.length < 3;
      let llmResult: any = null;

      if (!skip) {
        const contextBlock = [
          `Sector: ${sector} | Businesses: ${ids.length} | Reviews: ${reviews.length} | Leads: ${leads.length} | Alerts: ${alerts.length}`,
          '',
          'ALERT CONVERSION RATES (% acted on):',
          Object.entries(alertConversionRates).length > 0
            ? Object.entries(alertConversionRates).map(([t, r]) => `  ${t}: ${r}%`).join('\n')
            : '  insufficient data',
          '',
          `LEAD PATTERNS: ${leads.length} total | ${closedLeads.length} closed | ${conversionRate}% conversion`,
          topLeadSources.length > 0 ? `  Top sources of closed deals: ${topLeadSources.join(', ')}` : '',
          topClosedServices.length > 0 ? `  Top requested services in closed deals: ${topClosedServices.join(', ')}` : '',
          '',
          `REVIEWS (avg ${avgRating?.toFixed(1) || '?'}★ across ${reviews.length} reviews):`,
          negativeTexts.length > 0 ? `  Negative themes (sample): ${negativeTexts.slice(0, 5).join(' | ')}` : '',
          positiveTexts.length > 0 ? `  Positive themes (sample): ${positiveTexts.slice(0, 5).join(' | ')}` : '',
          '',
          'TOP SIGNAL CATEGORIES:',
          topSignalCategories.map(s => `  ${s.type}: ${s.count}`).join('\n'),
          avgCompRating ? `\nCOMPETITOR AVG RATING: ${avgCompRating.toFixed(1)}★ (${ratedComp.length} competitors)` : '',
          avgHealth ? `SECTOR HEALTH BASELINE: ${avgHealth}/100` : '',
        ].filter(l => l !== '').join('\n');

        llmResult = await invokeLLM({
          model: 'sonnet',
          maxTokens: 1000,
          prompt: `You are a sector intelligence analyst for Israeli small businesses.
Synthesize this aggregated data from ${ids.length} businesses in the "${sector}" sector.

${contextBlock}

Extract actionable patterns that will help NEW businesses in this sector immediately.
ALL string values must be in Hebrew.

Return ONLY valid JSON:
{
  "key_insights": "2-3 משפטים — מה שעובד הכי טוב בסקטור הזה ולמה",
  "common_complaints": "5 תלונות לקוחות נפוצות, מופרדות בפסיק",
  "trending_services": "5 שירותים/מוצרים מבוקשים ביותר, מופרדות בפסיק",
  "winning_patterns": "3 דפוסי הצלחה שחוזרים על עצמם — מה שמוביל לסגירת עסקאות",
  "risk_patterns": "2-3 דפוסי כישלון נפוצים — מה שגורם לנטישה",
  "peak_demand": "מתי ואיפה הביקוש הגבוה ביותר (עונה, יום, שעה)",
  "price_range": "טווח מחירים טיפוסי בסקטור",
  "best_content_types": "סוגי תוכן שמייצרים הכי הרבה engagement בסקטור הזה"
}`,
          response_json_schema: { type: 'object' },
          skipCache: true,
        });
      }

      const toStr = (v: any) => Array.isArray(v) ? v.join(', ') : (v || '');

      // ── Build rich learning JSON (stored in winner_lead_dna) ──────────────
      const richLearning = JSON.stringify({
        businesses_analyzed:    ids.length,
        alert_conversion_rates: alertConversionRates,
        top_alert_type:         topAlertType,
        lead_conversion_rate_pct: conversionRate,
        top_lead_sources:       topLeadSources,
        top_closed_services:    topClosedServices,
        avg_competitor_rating:  avgCompRating ? Math.round(avgCompRating * 10) / 10 : null,
        sector_health_baseline: avgHealth,
        total_reviews_analyzed: reviews.length,
        total_leads_analyzed:   leads.length,
        total_alerts_analyzed:  alerts.length,
        total_signals_analyzed: marketSignals.length,
        top_signal_categories:  topSignalCategories,
        raw_signal_distribution: Object.fromEntries([...rawSigCount.entries()].slice(0, 10)),
        winning_patterns:       llmResult?.winning_patterns || '',
        risk_patterns:          llmResult?.risk_patterns    || '',
        peak_demand:            llmResult?.peak_demand      || '',
        best_content_types:     llmResult?.best_content_types || '',
        key_insights:           llmResult?.key_insights     || '',
        last_learned:           new Date().toISOString(),
      });

      // ── Upsert sector record ──────────────────────────────────────────────
      // Use sub_sector as the sector key for more precise matching
      const existing = await prisma.sectorKnowledge.findFirst({ where: { sector } });

      const upsertData = {
        avg_rating:             avgRating ? Math.round(avgRating * 10) / 10 : undefined,
        common_complaints:      llmResult ? toStr(llmResult.common_complaints) : undefined,
        trending_services:      llmResult ? toStr(llmResult.trending_services) : undefined,
        price_range:            llmResult?.price_range || undefined,
        competitor_count:       competitors.length,
        total_signals_analyzed: marketSignals.length,
        winner_lead_dna:        richLearning,
        last_updated:           new Date().toISOString(),
      };

      if (existing) {
        await prisma.sectorKnowledge.update({
          where: { id: existing.id },
          data: Object.fromEntries(Object.entries(upsertData).filter(([, v]) => v !== undefined)),
        });
      } else {
        // Determine human-readable label for the sector
        const firstProfile = sectorProfiles[0];
        let sectorLabel = sector;
        if (firstProfile?.sector_profile) {
          try {
            const sp = JSON.parse(firstProfile.sector_profile);
            sectorLabel = sp.sector_label_he || sector;
          } catch {}
        }
        await prisma.sectorKnowledge.create({
          data: {
            sector,
            region: firstProfile?.city || 'ישראל',
            avg_rating:             avgRating ? Math.round(avgRating * 10) / 10 : null,
            common_complaints:      llmResult ? toStr(llmResult.common_complaints) : '',
            trending_services:      llmResult ? toStr(llmResult.trending_services) : sectorLabel,
            price_range:            llmResult?.price_range || '',
            competitor_count:       competitors.length,
            total_signals_analyzed: marketSignals.length,
            winner_lead_dna:        richLearning,
            last_updated:           new Date().toISOString(),
          },
        });
      }

      console.log(
        `[updateSectorKnowledge] ${sector}: ${ids.length} businesses | ` +
        `${alerts.length} alerts | ${leads.length} leads | ${reviews.length} reviews | ` +
        `conversion=${conversionRate}%`
      );
      totalUpdated++;

      // ── Propagate new sector wisdom: refresh stale missions for all businesses ──
      // Each business whose missions are >7 days old (or never had sector wisdom)
      // gets a silent background refresh so they benefit from cross-business learning.
      // Fire-and-forget — don't block the sector update response.
      for (const p of sectorProfiles) {
        refreshMissionsIfStale(p.id).catch(() => {});
      }
    }

    if (businessProfileId) setLastRun(businessProfileId, 'updateSectorKnowledge');
    await writeAutomationLog('updateSectorKnowledge', businessProfileId || 'global', startTime, totalUpdated);
    return res.json({ updated: totalUpdated, sectors_learned: totalUpdated });

  } catch (err: any) {
    console.error('[updateSectorKnowledge] error:', err.message);
    await writeAutomationLog('updateSectorKnowledge', businessProfileId || 'global', startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
