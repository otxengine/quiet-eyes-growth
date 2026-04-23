/**
 * Layer 7 Agent handlers — OTX advanced agents.
 *
 * Each handler:
 *   1. Resolves / creates the Supabase businesses row
 *   2. Reads input from Prisma tables (leads, reviews, competitors, signals)
 *   3. Calls Claude for AI analysis
 *   4. Writes results to the matching OTX table (if table exists)
 *   5. *** Syncs findings into the main Prisma tables ***
 *        (MarketSignal, ProactiveAlert, Action) so the full system sees them
 *   6. Returns items_created count
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { invokeLLM } from '../../lib/llm';

// ─── Shared helpers ───────────────────────────────────────────────────────────

function mapSector(category: string | null): string {
  const m: Record<string, string> = {
    מסעדה: 'restaurant', restaurant: 'restaurant',
    כושר: 'fitness',     fitness: 'fitness',
    יופי: 'beauty',      beauty: 'beauty',
    salon: 'beauty',     spa: 'beauty',
  };
  return m[category?.toLowerCase() ?? ''] ?? 'local';
}

async function ensureOtxBusiness(businessProfileId: string) {
  const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
  if (!profile) return null;

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM businesses WHERE id = $1::uuid LIMIT 1`,
      businessProfileId,
    );
    if (rows[0]) return { otxId: rows[0].id, profile };
  } catch {}

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM businesses WHERE name = $1 LIMIT 1`,
      profile.name,
    );
    if (rows[0]) return { otxId: rows[0].id, profile };
  } catch {}

  const sector  = mapSector(profile.category);
  const geoCity = profile.city || 'תל אביב';
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO businesses (id, name, sector, geo_city, price_tier)
       VALUES ($1::uuid, $2, $3, $4, 'mid')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      businessProfileId, profile.name, sector, geoCity,
    );
    if (rows[0]) return { otxId: rows[0].id, profile };
  } catch {}

  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM businesses LIMIT 1`;
    if (rows[0]) return { otxId: rows[0].id, profile };
  } catch {}

  // Return with Prisma ID even if OTX table doesn't exist yet
  return { otxId: businessProfileId, profile };
}

/** Write to OTX table, silently ignore if table doesn't exist */
async function otxInsert(sql: string, ...args: any[]) {
  try {
    await prisma.$queryRawUnsafe(sql, ...args);
  } catch (e: any) {
    // Table might not exist yet — non-fatal
    if (!e.message?.includes('does not exist')) throw e;
  }
}

// ─── Agent 15: ViralCatalyst ──────────────────────────────────────────────────

export async function runViralCatalyst(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  const startTime = new Date().toISOString();
  try {
    const biz = await ensureOtxBusiness(businessProfileId);
    if (!biz) return res.status(404).json({ error: 'Business profile not found' });
    const { otxId, profile } = biz;
    const sector = mapSector(profile.category);

    const result = await invokeLLM({
      prompt: `אתה מומחה שיווק ויראלי ישראלי. צור 3 תבניות תוכן ויראלי לעסק "${profile.name}" (${profile.category}, ${profile.city}).
לכל תבנית: format, platform, virality_score, peak_hour, script_template (עד 80 מילה בעברית).
JSON array של 3 אובייקטים:
[{"pattern_type":"format","pattern_value":"...","platform":"instagram","virality_score":0.75,"peak_hour":19,"script_template":"...","summary":"תיאור קצר 1-2 משפטים"}]`,
      response_json_schema: { type: 'array' },
    });

    const patterns: any[] = Array.isArray(result) ? result.slice(0, 3) : [];
    let inserted = 0;

    for (const p of patterns) {
      const types     = ['format', 'music', 'hashtag', 'timing', 'hook'];
      const platforms = ['tiktok', 'instagram', 'facebook', 'youtube'];
      const pType     = types.includes(p.pattern_type) ? p.pattern_type : 'format';
      const platform  = platforms.includes(p.platform) ? p.platform : 'instagram';

      await otxInsert(
        `INSERT INTO viral_patterns (business_id, pattern_type, pattern_value, platform, virality_score, peak_hour, script_template, source_url, confidence_score)
         VALUES ($1::uuid,$2,$3,$4,$5::numeric,$6::int,$7,$8,$9::numeric)`,
        otxId, pType, p.pattern_value || 'תוכן ויראלי', platform,
        Math.min(0.999, Math.max(0, p.virality_score ?? 0.7)),
        p.peak_hour ?? 19, p.script_template || '',
        `internal://viral-catalyst/${sector}`, 0.72,
      );

      // ── Sync to main system ──
      await prisma.marketSignal.create({
        data: {
          linked_business: businessProfileId,
          summary: `תבנית ויראלית ל${platform}: ${p.pattern_value || p.pattern_type} (שעת שיא: ${p.peak_hour ?? 19}:00)`,
          category: 'social',
          impact_level: p.virality_score >= 0.8 ? 'high' : 'medium',
          confidence: p.virality_score ?? 0.72,
          recommended_action: p.script_template ? `השתמש בסקריפט: ${p.script_template.slice(0, 80)}` : 'צור תוכן לפי התבנית',
          detected_at: new Date().toISOString(),
          source_description: 'Viral Catalyst AI',
          is_read: false,
        },
      });
      inserted++;
    }

    await writeAutomationLog('runViralCatalyst', businessProfileId, startTime, inserted, 'success');
    return res.json({ items_created: inserted, message: `${inserted} תבניות ויראליות נוצרו` });
  } catch (err: any) {
    console.error('[runViralCatalyst]', err.message);
    await writeAutomationLog('runViralCatalyst', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ─── Agent 16: InfluenceIntegrityAuditor ─────────────────────────────────────

export async function runInfluenceIntegrity(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  const startTime = new Date().toISOString();
  try {
    const biz = await ensureOtxBusiness(businessProfileId);
    if (!biz) return res.status(404).json({ error: 'Business profile not found' });
    const { otxId, profile } = biz;

    const reviews = await prisma.review.findMany({
      where: { linked_business: businessProfileId },
      orderBy: { created_date: 'desc' },
      take: 20,
    });

    const reviewSummary = reviews.slice(0, 10)
      .map(r => `${r.reviewer_name || 'אנונימי'} (${r.rating || '?'}★): ${(r.text || '').slice(0, 80)}`)
      .join('\n');

    const result = await invokeLLM({
      prompt: `אתה מומחה אבטחת מידע ואותנטיות ביקורות. נתח ביקורות לעסק "${profile.name}".
ביקורות:
${reviewSummary || 'אין ביקורות זמינות'}

JSON:
{"organic_pct":75.0,"bot_pct":10.0,"coordinated_pct":15.0,"verdict":"organic","recommendation":"...","risk_summary":"..."}
verdict: organic/suspicious/manipulated`,
      response_json_schema: { type: 'object' },
    });

    const verdicts = ['organic', 'suspicious', 'manipulated'];
    const verdict  = verdicts.includes(result?.verdict) ? result.verdict : 'organic';

    await otxInsert(
      `INSERT INTO influence_integrity_scores (business_id, organic_pct, bot_pct, coordinated_pct, verdict, recommendation, source_url, confidence_score)
       VALUES ($1::uuid,$2::numeric,$3::numeric,$4::numeric,$5,$6,$7,$8::numeric)`,
      otxId,
      result?.organic_pct ?? 80, result?.bot_pct ?? 10, result?.coordinated_pct ?? 10,
      verdict,
      result?.recommendation || 'ביקורות נראות אותנטיות',
      `internal://influence-integrity/${profile.name}`, 0.68,
    );

    // ── Sync to main system ──
    await prisma.marketSignal.create({
      data: {
        linked_business: businessProfileId,
        summary: `ביקורת אמינות: ${result?.organic_pct ?? 80}% אורגני, ${result?.bot_pct ?? 10}% חשוד | verdict: ${verdict}`,
        category: 'reputation',
        impact_level: verdict === 'manipulated' ? 'high' : verdict === 'suspicious' ? 'medium' : 'low',
        confidence: (result?.organic_pct ?? 80) / 100,
        recommended_action: result?.recommendation || 'המשך מעקב שוטף',
        detected_at: new Date().toISOString(),
        source_description: 'Influence Integrity Auditor',
        is_read: false,
      },
    });

    if (verdict === 'suspicious' || verdict === 'manipulated') {
      await prisma.proactiveAlert.create({
        data: {
          linked_business: businessProfileId,
          alert_type: 'reputation_risk',
          title: `⚠️ ביקורות חשודות זוהו — ${verdict}`,
          description: result?.risk_summary || `${result?.bot_pct ?? 10}% מהביקורות נראות לא אורגניות`,
          suggested_action: result?.recommendation || 'בדוק את מקור הביקורות ושקול פנייה לפלטפורמה',
          priority: verdict === 'manipulated' ? 'high' : 'medium',
          source_agent: 'runInfluenceIntegrity',
          created_at: new Date().toISOString(),
          is_dismissed: false,
        },
      });
    }

    await writeAutomationLog('runInfluenceIntegrity', businessProfileId, startTime, 1, 'success');
    return res.json({ items_created: 1, verdict, message: `verdict: ${verdict} | אמינות ${result?.organic_pct ?? 80}%` });
  } catch (err: any) {
    console.error('[runInfluenceIntegrity]', err.message);
    await writeAutomationLog('runInfluenceIntegrity', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ─── Agent 17: DeepContextVisionAgent ────────────────────────────────────────

export async function runDeepContextVision(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  const startTime = new Date().toISOString();
  try {
    const biz = await ensureOtxBusiness(businessProfileId);
    if (!biz) return res.status(404).json({ error: 'Business profile not found' });
    const { otxId, profile } = biz;

    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
      take: 5,
    });
    const compSummary = competitors.map(c => c.name).join(', ') || 'אין מתחרים ידועים';

    const result = await invokeLLM({
      prompt: `אתה מומחה ניתוח עסקי. צור תובנה אסטרטגית לעסק "${profile.name}" (${profile.category}, ${profile.city}).
מתחרים: ${compSummary}

JSON:
{"business_insight":"...","unmet_demand_detected":true,"demand_description":"...","sentiment_visual":"positive","recommended_action":"..."}
sentiment_visual: positive/neutral/negative/urgent`,
      response_json_schema: { type: 'object' },
    });

    const sentiments = ['positive', 'neutral', 'negative', 'urgent'];
    const sentiment  = sentiments.includes(result?.sentiment_visual) ? result.sentiment_visual : 'neutral';

    await otxInsert(
      `INSERT INTO visual_osint_signals (business_id, media_url, platform, business_insight, unmet_demand_detected, sentiment_visual, source_url, confidence_score)
       VALUES ($1::uuid,$2,$3,$4,$5::boolean,$6,$7,$8::numeric)`,
      otxId,
      `https://google.com/search?q=${encodeURIComponent(profile.name)}`,
      'google',
      result?.business_insight || `ניתוח של ${profile.name}`,
      result?.unmet_demand_detected ?? false,
      sentiment,
      `internal://deep-context-vision/${profile.name}`, 0.65,
    );

    // ── Sync to main system ──
    await prisma.marketSignal.create({
      data: {
        linked_business: businessProfileId,
        summary: result?.business_insight || `ניתוח עומק: ${profile.name}`,
        category: 'market',
        impact_level: result?.unmet_demand_detected ? 'high' : 'medium',
        confidence: 0.65,
        recommended_action: result?.recommended_action || 'בחן הזדמנות זו',
        detected_at: new Date().toISOString(),
        source_description: 'Deep Context Vision AI',
        is_read: false,
      },
    });

    if (result?.unmet_demand_detected) {
      await prisma.action.create({
        data: {
          linked_business: businessProfileId,
          type: 'expansion',
          title: `ביקוש לא מסופק זוהה`,
          reasoning: result?.demand_description || result?.business_insight,
          impact_estimate: 'medium',
          execution_plan: result?.recommended_action || 'בחן הוספת שירות חדש לקטלוג',
          status: 'proposed',
          created_at: new Date().toISOString(),
        },
      });
    }

    await writeAutomationLog('runDeepContextVision', businessProfileId, startTime, 1, 'success');
    return res.json({ items_created: 1, unmet_demand: result?.unmet_demand_detected, message: result?.business_insight || 'תובנה ויזואלית נוצרה' });
  } catch (err: any) {
    console.error('[runDeepContextVision]', err.message);
    await writeAutomationLog('runDeepContextVision', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ─── Agent 18: RetentionSentinel ─────────────────────────────────────────────

export async function runRetentionSentinel(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  const startTime = new Date().toISOString();
  try {
    const biz = await ensureOtxBusiness(businessProfileId);
    if (!biz) return res.status(404).json({ error: 'Business profile not found' });
    const { otxId, profile } = biz;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const atRisk = await prisma.lead.findMany({
      where: {
        linked_business: businessProfileId,
        status: 'closed_won',
        closed_at: { lt: thirtyDaysAgo },
      },
      take: 10,
      orderBy: { closed_at: 'asc' },
    });

    let inserted = 0;
    for (const lead of atRisk.slice(0, 5)) {
      const ref = lead.closed_at || lead.created_at || lead.created_date?.toISOString();
      const daysSince = ref ? Math.floor((Date.now() - new Date(ref).getTime()) / 86400000) : 45;
      const risk = daysSince > 90 ? 'critical' : daysSince > 60 ? 'high' : daysSince > 30 ? 'medium' : 'low';
      const churnProb = Math.min(0.95, 0.2 + daysSince * 0.01);

      await otxInsert(
        `INSERT INTO retention_alerts (business_id, customer_identifier, risk_level, churn_probability, last_interaction_days, recommended_offer, source_url, confidence_score)
         VALUES ($1::uuid,$2,$3,$4::numeric,$5::int,$6,$7,$8::numeric)
         ON CONFLICT DO NOTHING`,
        otxId, lead.name || lead.id, risk,
        Math.round(churnProb * 1000) / 1000, daysSince,
        `הצע ל${lead.name || 'לקוח'} הנחת נאמנות 10%`,
        `internal://retention-sentinel/${lead.id}`, 0.75,
      );

      // ── Sync to main system ──
      if (risk === 'high' || risk === 'critical') {
        await prisma.proactiveAlert.create({
          data: {
            linked_business: businessProfileId,
            alert_type: 'retention_risk',
            title: `${lead.name || 'לקוח'} לא חזר — ${daysSince} ימים`,
            description: `לקוח סגר עסקה לפני ${daysSince} ימים ולא שב. סיכון עזיבה: ${Math.round(churnProb * 100)}%`,
            suggested_action: `הצע ל${lead.name || 'לקוח'} הנחת נאמנות 10% על ביקור הבא`,
            priority: risk === 'critical' ? 'high' : 'medium',
            source_agent: 'runRetentionSentinel',
            created_at: new Date().toISOString(),
            is_dismissed: false,
          },
        });
      }
      inserted++;
    }

    if (inserted === 0) {
      await otxInsert(
        `INSERT INTO retention_alerts (business_id, customer_identifier, risk_level, churn_probability, last_interaction_days, recommended_offer, source_url, confidence_score)
         VALUES ($1::uuid,$2,$3,$4::numeric,$5::int,$6,$7,$8::numeric)`,
        otxId, 'סריקה_כללית', 'low', 0.1, 0,
        'אין לקוחות בסיכון עזיבה', 'internal://retention-sentinel/scan', 0.8,
      );
      inserted = 1;
    }

    // ── Sync summary signal ──
    await prisma.marketSignal.create({
      data: {
        linked_business: businessProfileId,
        summary: atRisk.length > 0
          ? `${atRisk.length} לקוחות לשימור — לא חזרו 30+ ימים`
          : 'שימור לקוחות: אין סיכונים נוכחיים',
        category: 'retention',
        impact_level: atRisk.length >= 3 ? 'high' : atRisk.length >= 1 ? 'medium' : 'low',
        confidence: 0.78,
        recommended_action: atRisk.length > 0
          ? `צור קשר עם ${atRisk.length} לקוחות לשימור`
          : 'המשך מעקב שוטף',
        detected_at: new Date().toISOString(),
        source_description: 'Retention Sentinel AI',
        is_read: false,
      },
    });

    await writeAutomationLog('runRetentionSentinel', businessProfileId, startTime, inserted, 'success');
    return res.json({ items_created: inserted, at_risk: atRisk.length, message: `${atRisk.length} לקוחות בסיכון זוהו` });
  } catch (err: any) {
    console.error('[runRetentionSentinel]', err.message);
    await writeAutomationLog('runRetentionSentinel', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ─── Agent 19: NegotiationPricingCoach ───────────────────────────────────────

export async function runNegotiationPricing(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  const startTime = new Date().toISOString();
  try {
    const biz = await ensureOtxBusiness(businessProfileId);
    if (!biz) return res.status(404).json({ error: 'Business profile not found' });
    const { otxId, profile } = biz;

    const [hotLeads, competitors] = await Promise.all([
      prisma.lead.findMany({ where: { linked_business: businessProfileId, status: 'hot' }, take: 5 }),
      prisma.competitor.findMany({ where: { linked_business: businessProfileId }, take: 5 }),
    ]);

    const leadContext = hotLeads.length > 0
      ? `${hotLeads.length} לידים חמים, שירות: ${hotLeads[0].service_needed || 'לא מוגדר'}`
      : 'אין לידים חמים';
    const compContext = competitors.map(c => c.name).join(', ') || 'אין מתחרים ידועים';

    const result = await invokeLLM({
      prompt: `אתה מאמן תמחור ישראלי. נתח שוק לעסק "${profile.name}" (${profile.category}).
לידים: ${leadContext}. מתחרים: ${compContext}.

JSON:
{"market_supply":"balanced","competitor_avg_price":450,"recommended_price_modifier":5,"recommended_tactic":"standard","tactic_reason":"...","confidence_pct":72,"insight":"תובנת תמחור מרכזית בעברית"}
market_supply: scarce/balanced/flooded
recommended_tactic: premium/standard/discount/bundle`,
      response_json_schema: { type: 'object' },
    });

    const supplies = ['scarce', 'balanced', 'flooded'];
    const tactics  = ['premium', 'standard', 'discount', 'bundle'];
    const supply   = supplies.includes(result?.market_supply) ? result.market_supply : 'balanced';
    const tactic   = tactics.includes(result?.recommended_tactic) ? result.recommended_tactic : 'standard';
    const validUntil = new Date(Date.now() + 6 * 3600000).toISOString();

    await otxInsert(
      `INSERT INTO pricing_recommendations (business_id, lead_context, market_supply, competitor_avg_price, recommended_price_modifier, recommended_tactic, tactic_reason, confidence_pct, valid_until, source_url, confidence_score)
       VALUES ($1::uuid,$2,$3,$4::numeric,$5::numeric,$6,$7,$8::int,$9::timestamptz,$10,$11::numeric)`,
      otxId, leadContext, supply,
      result?.competitor_avg_price ?? 450,
      result?.recommended_price_modifier ?? 0,
      tactic,
      result?.tactic_reason || `מבוסס על ניתוח שוק`,
      result?.confidence_pct ?? 70,
      validUntil,
      `internal://negotiation-pricing/${profile.name}`,
      (result?.confidence_pct ?? 70) / 100,
    );

    // ── Sync to main system ──
    await prisma.marketSignal.create({
      data: {
        linked_business: businessProfileId,
        summary: result?.insight || `תמחור: טקטיקת "${tactic}" מומלצת — ${result?.recommended_price_modifier ?? 0}% שינוי מחיר`,
        category: 'market',
        impact_level: Math.abs(result?.recommended_price_modifier ?? 0) > 10 ? 'high' : 'medium',
        confidence: (result?.confidence_pct ?? 70) / 100,
        recommended_action: result?.tactic_reason || `החל טקטיקת ${tactic}`,
        detected_at: new Date().toISOString(),
        source_description: 'Negotiation Pricing Coach AI',
        is_read: false,
      },
    });

    await prisma.action.create({
      data: {
        linked_business: businessProfileId,
        type: 'pricing',
        title: `שנה מחיר: ${result?.recommended_price_modifier ?? 0}% (${tactic})`,
        reasoning: result?.tactic_reason || `ניתוח שוק: ${supply}`,
        impact_estimate: 'medium',
        execution_plan: `טקטיקה: ${tactic} | מחיר ממוצע מתחרים: ₪${result?.competitor_avg_price ?? 450}`,
        status: 'proposed',
        created_at: new Date().toISOString(),
      },
    });

    await writeAutomationLog('runNegotiationPricing', businessProfileId, startTime, 1, 'success');
    return res.json({
      items_created: 1,
      tactic,
      modifier: result?.recommended_price_modifier ?? 0,
      message: `טקטיקה: ${tactic} | מודיפייר: ${result?.recommended_price_modifier ?? 0}% | תקף 6 שעות`,
    });
  } catch (err: any) {
    console.error('[runNegotiationPricing]', err.message);
    await writeAutomationLog('runNegotiationPricing', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ─── Agent 20: CampaignAutoPilot ─────────────────────────────────────────────

export async function runCampaignAutopilot(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  const startTime = new Date().toISOString();
  try {
    const biz = await ensureOtxBusiness(businessProfileId);
    if (!biz) return res.status(404).json({ error: 'Business profile not found' });
    const { otxId, profile } = biz;

    const [recentSignals, hotLeads] = await Promise.all([
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 5,
      }),
      prisma.lead.findMany({ where: { linked_business: businessProfileId, status: 'hot' }, take: 3 }),
    ]);

    const triggerContext = recentSignals[0]?.summary || `${hotLeads.length} לידים חמים הצטברו`;

    const result = await invokeLLM({
      prompt: `אתה מנהל קמפיינים ישראלי. צור טיוטת קמפיין לרשתות חברתיות עבור "${profile.name}" (${profile.category}).
הקשר: ${triggerContext}

JSON (בעברית):
{"headline":"כותרת עד 10 מילה","body_text":"טקסט עד 50 מילה","cta_text":"CTA עד 5 מילה","platform":"instagram","estimated_reach":500,"duration_hours":24,"campaign_insight":"מדוע הקמפיין הזה נכון עכשיו"}`,
      response_json_schema: { type: 'object' },
    });

    const platforms = ['instagram', 'facebook', 'tiktok', 'youtube', 'google'];
    const platform  = platforms.includes(result?.platform) ? result.platform : 'instagram';
    const recTime   = new Date(Date.now() + 2 * 3600000).toISOString();

    await otxInsert(
      `INSERT INTO campaign_drafts (business_id, trigger_event, platform, headline, body_text, cta_text, estimated_reach, recommended_time, duration_hours, auto_publish, status, source_url, confidence_score)
       VALUES ($1::uuid,$2,$3,$4,$5,$6,$7::int,$8::timestamptz,$9::int,false,'draft',$10,$11::numeric)`,
      otxId, triggerContext.slice(0, 200), platform,
      result?.headline || `מבצע ל${profile.name}`,
      result?.body_text || 'הצטרפו אלינו!',
      result?.cta_text || 'צרו קשר',
      result?.estimated_reach ?? 300, recTime,
      result?.duration_hours ?? 24,
      `internal://campaign-autopilot/${profile.name}`, 0.78,
    );

    // ── Sync to main system ──
    await prisma.marketSignal.create({
      data: {
        linked_business: businessProfileId,
        summary: result?.campaign_insight || `טיוטת קמפיין ל${platform}: "${result?.headline || 'קמפיין חדש'}"`,
        category: 'social',
        impact_level: (result?.estimated_reach ?? 300) >= 500 ? 'high' : 'medium',
        confidence: 0.78,
        recommended_action: `פרסם קמפיין: "${result?.headline}" | CTA: ${result?.cta_text || 'צרו קשר'}`,
        detected_at: new Date().toISOString(),
        source_description: 'Campaign Autopilot AI',
        is_read: false,
      },
    });

    await prisma.action.create({
      data: {
        linked_business: businessProfileId,
        type: 'campaign',
        title: result?.headline || `קמפיין ${platform}`,
        reasoning: result?.campaign_insight || triggerContext,
        impact_estimate: 'medium',
        execution_plan: `${result?.body_text} | CTA: ${result?.cta_text} | פלטפורמה: ${platform} | משך: ${result?.duration_hours ?? 24}ש'`,
        status: 'proposed',
        created_at: new Date().toISOString(),
      },
    });

    await writeAutomationLog('runCampaignAutopilot', businessProfileId, startTime, 1, 'success');
    return res.json({
      items_created: 1,
      platform,
      headline: result?.headline,
      message: `טיוטת קמפיין נוצרה ל${platform} — ממתין לאישור`,
    });
  } catch (err: any) {
    console.error('[runCampaignAutopilot]', err.message);
    await writeAutomationLog('runCampaignAutopilot', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ─── Agent 21: ServiceExpansionScout ─────────────────────────────────────────

export async function runExpansionScout(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  const startTime = new Date().toISOString();
  try {
    const biz = await ensureOtxBusiness(businessProfileId);
    if (!biz) return res.status(404).json({ error: 'Business profile not found' });
    const { otxId, profile } = biz;

    const [allLeads, allSignals] = await Promise.all([
      prisma.lead.findMany({ where: { linked_business: businessProfileId }, take: 30 }),
      prisma.marketSignal.findMany({ where: { linked_business: businessProfileId }, take: 20 }),
    ]);

    const serviceCounts: Record<string, number> = {};
    for (const l of allLeads) {
      const svc = l.service_needed || '';
      if (svc) serviceCounts[svc] = (serviceCounts[svc] || 0) + 1;
    }
    const topService  = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1])[0];
    const signalSummary = allSignals.slice(0, 5).map(s => s.summary || '').filter(Boolean).join('; ');

    const result = await invokeLLM({
      prompt: `אתה יועץ אסטרטגי לעסקים ישראלים. זהה הזדמנות הרחבת שירות ל"${profile.name}" (${profile.category}, ${profile.city}).
שירות הנפוץ: ${topService ? `${topService[0]} (${topService[1]} פניות)` : 'לא מזוהה'}
אותות שוק: ${signalSummary || 'אין'}

JSON:
{"opportunity_title":"כותרת הזדמנות","unmet_demand_description":"...","demand_signal_count":5,"estimated_monthly_revenue":8000,"estimated_investment":3000,"roi_months":3,"why_now":"מדוע ההזדמנות רלוונטית עכשיו"}`,
      response_json_schema: { type: 'object' },
    });

    await otxInsert(
      `INSERT INTO expansion_opportunities (business_id, opportunity_title, unmet_demand_description, demand_signal_count, geo, estimated_monthly_revenue, estimated_investment, roi_months, source_url, confidence_score)
       VALUES ($1::uuid,$2,$3,$4::int,$5,$6::numeric,$7::numeric,$8::int,$9,$10::numeric)`,
      otxId,
      result?.opportunity_title || `הזדמנות הרחבה ל${profile.category}`,
      result?.unmet_demand_description || 'ביקוש לשירותים נוספים',
      result?.demand_signal_count ?? allLeads.length,
      profile.city,
      result?.estimated_monthly_revenue ?? 5000,
      result?.estimated_investment ?? 2000,
      result?.roi_months ?? 4,
      `internal://expansion-scout/${profile.name}`, 0.7,
    );

    // ── Sync to main system ──
    await prisma.marketSignal.create({
      data: {
        linked_business: businessProfileId,
        summary: `${result?.opportunity_title || 'הזדמנות הרחבה'}: ${result?.unmet_demand_description || ''}`,
        category: 'expansion',
        impact_level: (result?.estimated_monthly_revenue ?? 5000) >= 8000 ? 'high' : 'medium',
        confidence: 0.7,
        recommended_action: result?.why_now || `ROI בתוך ${result?.roi_months ?? 4} חודשים`,
        detected_at: new Date().toISOString(),
        source_description: 'Expansion Scout AI',
        is_read: false,
      },
    });

    await prisma.action.create({
      data: {
        linked_business: businessProfileId,
        type: 'expansion',
        title: result?.opportunity_title || 'הזדמנות הרחבת שירות',
        reasoning: result?.why_now || result?.unmet_demand_description,
        impact_estimate: 'high',
        execution_plan: `הכנסה חודשית: ₪${result?.estimated_monthly_revenue ?? 5000} | השקעה: ₪${result?.estimated_investment ?? 2000} | ROI: ${result?.roi_months ?? 4} חודשים`,
        status: 'proposed',
        created_at: new Date().toISOString(),
      },
    });

    await writeAutomationLog('runExpansionScout', businessProfileId, startTime, 1, 'success');
    return res.json({
      items_created: 1,
      opportunity: result?.opportunity_title,
      roi_months: result?.roi_months,
      message: `${result?.opportunity_title || 'הזדמנות הרחבה'} — ROI בתוך ${result?.roi_months ?? 4} חודשים`,
    });
  } catch (err: any) {
    console.error('[runExpansionScout]', err.message);
    await writeAutomationLog('runExpansionScout', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ─── Agent 22: ReputationWarRoom ─────────────────────────────────────────────

export async function runReputationWarRoom(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  const startTime = new Date().toISOString();
  try {
    const biz = await ensureOtxBusiness(businessProfileId);
    if (!biz) return res.status(404).json({ error: 'Business profile not found' });
    const { otxId, profile } = biz;

    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [negReviews] = await Promise.all([
      prisma.review.findMany({
        where: {
          linked_business: businessProfileId,
          created_date: { gte: sevenDaysAgo },
          OR: [{ sentiment: 'negative' }, { rating: { lte: 2 } }],
        },
        take: 10,
      }),
    ]);

    const hasSpike    = negReviews.length >= 2;
    const severity    = negReviews.length >= 5 ? 'critical' : negReviews.length >= 3 ? 'high' : negReviews.length >= 1 ? 'medium' : 'low';
    const incidentType = hasSpike ? 'negative_review_spike' : 'routine_scan';
    const reviewSample = negReviews.slice(0, 3).map(r => `"${(r.text || '').slice(0, 60)}"`).join(', ');

    const result = await invokeLLM({
      prompt: `אתה מנהל מוניטין דיגיטלי. נתח מצב "${profile.name}" (${profile.category}).
${negReviews.length > 0 ? `${negReviews.length} ביקורות שליליות ב-7 ימים: ${reviewSample}` : 'אין ביקורות שליליות — בדיקה שגרתית'}

JSON:
{"description":"...","recommended_response":"2-3 משפטים פרקטיים בעברית","urgency_note":"..."}`,
      response_json_schema: { type: 'object' },
    });

    const deadline = new Date(Date.now() + (severity === 'critical' ? 2 : 12) * 3600000).toISOString();

    await otxInsert(
      `INSERT INTO reputation_incidents (business_id, severity, incident_type, description, recommended_response, response_deadline, resolved, source_url, confidence_score)
       VALUES ($1::uuid,$2,$3,$4,$5,$6::timestamptz,$7::boolean,$8,$9::numeric)`,
      otxId, severity, incidentType,
      result?.description || (hasSpike ? `ספייק ${negReviews.length} ביקורות שליליות` : 'בדיקה שגרתית'),
      result?.recommended_response || 'אין פעולה נדרשת כרגע',
      deadline, !hasSpike,
      `internal://reputation-war-room/${profile.name}`, 0.82,
    );

    // ── Sync to main system ──
    await prisma.marketSignal.create({
      data: {
        linked_business: businessProfileId,
        summary: hasSpike
          ? `⚠️ ${negReviews.length} ביקורות שליליות ב-7 ימים — ${result?.description || ''}`
          : `✓ מוניטין תקין — אין ספייק ביקורות`,
        category: 'reputation',
        impact_level: severity === 'critical' ? 'high' : severity === 'high' ? 'high' : severity === 'medium' ? 'medium' : 'low',
        confidence: 0.82,
        recommended_action: result?.recommended_response || 'המשך מעקב שוטף',
        detected_at: new Date().toISOString(),
        source_description: 'Reputation War Room AI',
        is_read: false,
      },
    });

    if (severity === 'medium' || severity === 'high' || severity === 'critical') {
      await prisma.proactiveAlert.create({
        data: {
          linked_business: businessProfileId,
          alert_type: 'reputation_crisis',
          title: `🚨 ${negReviews.length} ביקורות שליליות — נדרשת תגובה`,
          description: result?.description || `ספייק ביקורות שליליות זוהה`,
          suggested_action: result?.recommended_response || 'הגב לביקורות בהקדם',
          priority: severity === 'critical' ? 'high' : 'medium',
          source_agent: 'runReputationWarRoom',
          created_at: new Date().toISOString(),
          is_dismissed: false,
        },
      });
    }

    await writeAutomationLog('runReputationWarRoom', businessProfileId, startTime, 1, 'success');
    return res.json({
      items_created: 1,
      severity,
      negative_reviews: negReviews.length,
      message: hasSpike
        ? `⚠️ ${negReviews.length} ביקורות שליליות — severity: ${severity}`
        : `✓ מוניטין תקין`,
    });
  } catch (err: any) {
    console.error('[runReputationWarRoom]', err.message);
    await writeAutomationLog('runReputationWarRoom', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
