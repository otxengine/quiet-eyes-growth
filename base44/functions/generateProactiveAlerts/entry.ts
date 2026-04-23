import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  let profile;

  if (body.businessProfileId) {
    const all = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = all.find(p => p.id === body.businessProfileId);
  }
  if (!profile) {
    try {
      const user = await base44.auth.me();
      if (user) {
        const profiles = await base44.entities.BusinessProfile.filter({ created_by: user.email });
        profile = profiles[0];
      }
    } catch (_) {}
  }
  if (!profile) {
    const allProfiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = allProfiles[0];
  }
  if (!profile) return Response.json({ error: 'No business profile', alerts_created: 0 }, { status: 404 });

  const bpId = profile.id;
  const startTime = new Date().toISOString();
  const now = startTime;
  const dayAgo = new Date(Date.now() - 24 * 3600000).toISOString();

  // Gather cross-entity data
  const [signals, leads, reviews, competitors, predictions, healthScores] = await Promise.all([
    base44.asServiceRole.entities.MarketSignal.filter({ linked_business: bpId }, '-detected_at', 20),
    base44.asServiceRole.entities.Lead.filter({ linked_business: bpId }, '-created_date', 20),
    base44.asServiceRole.entities.Review.filter({ linked_business: bpId }, '-created_date', 10),
    base44.asServiceRole.entities.Competitor.filter({ linked_business: bpId }),
    base44.asServiceRole.entities.Prediction.filter({ linked_business: bpId }, '-predicted_at', 5),
    base44.asServiceRole.entities.HealthScore.filter({ linked_business: bpId }),
  ]);

  // Dismiss old alerts (>3 days old)
  const existingAlerts = await base44.asServiceRole.entities.ProactiveAlert.filter({ linked_business: bpId });
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
  for (const alert of existingAlerts) {
    if (!alert.is_dismissed && (alert.created_at || alert.created_date) < threeDaysAgo) {
      await base44.asServiceRole.entities.ProactiveAlert.update(alert.id, { is_dismissed: true });
    }
  }

  const alertsToCreate = [];

  // 1. Urgent negative reviews
  const urgentNegReviews = reviews.filter(r => r.sentiment === 'negative' && r.response_status === 'pending');
  if (urgentNegReviews.length > 0) {
    alertsToCreate.push({
      alert_type: 'risk',
      title: `${urgentNegReviews.length} ביקורות שליליות ללא תגובה`,
      description: `נמצאו ${urgentNegReviews.length} ביקורות שליליות שממתינות לתגובתך. תגובה מהירה חשובה לשמירת המוניטין.`,
      suggested_action: 'עבור לעמוד המוניטין והגב לביקורות',
      action_url: '/reviews',
      priority: urgentNegReviews.length >= 3 ? 'critical' : 'high',
      source_agent: 'מנתח המוניטין',
    });
  }

  // 2. Hot leads needing attention
  const hotLeadsRecent = leads.filter(l => l.status === 'hot' && (l.created_at || l.created_date) >= dayAgo);
  if (hotLeadsRecent.length > 0) {
    alertsToCreate.push({
      alert_type: 'opportunity',
      title: `${hotLeadsRecent.length} לידים חמים חדשים!`,
      description: `${hotLeadsRecent.map(l => l.name).join(', ')} — לידים בעלי פוטנציאל גבוה שנכנסו ב-24 שעות האחרונות.`,
      suggested_action: `צור קשר מיידי עם ${hotLeadsRecent[0].name}`,
      action_url: '/leads',
      priority: 'high',
      source_agent: 'המסנן',
    });
  }

  // 3. High-impact market signals
  const highImpactSignals = signals.filter(s => s.impact_level === 'high' && !s.is_read && (s.detected_at || s.created_date) >= dayAgo);
  if (highImpactSignals.length > 0) {
    alertsToCreate.push({
      alert_type: highImpactSignals[0].category === 'threat' ? 'risk' : 'opportunity',
      title: `תובנה בהשפעה גבוהה: ${highImpactSignals[0].summary}`,
      description: `${highImpactSignals.length} תובנות בהשפעה גבוהה ממתינות לצפייה. ${highImpactSignals[0].recommended_action || ''}`,
      suggested_action: 'בדוק את התובנות בעמוד המודיעין',
      action_url: '/signals',
      priority: 'high',
      source_agent: 'המנתח',
    });
  }

  // 4. Competitor changes
  const recentlyScanned = competitors.filter(c => c.last_scanned && c.last_scanned >= dayAgo);
  const trendingUp = recentlyScanned.filter(c => c.trend_direction === 'up');
  if (trendingUp.length > 0) {
    alertsToCreate.push({
      alert_type: 'risk',
      title: `${trendingUp.length} מתחרים במגמת עלייה`,
      description: `${trendingUp.map(c => c.name).join(', ')} מראים שיפור בדירוגים. בדוק מה הם עושים אחרת.`,
      suggested_action: 'נתח את האסטרטגיה של המתחרים',
      action_url: '/competitors',
      priority: 'medium',
      source_agent: 'הצופה',
    });
  }

  // 5. Health score milestone
  const health = healthScores[0];
  if (health) {
    if (health.overall_score >= 80) {
      alertsToCreate.push({
        alert_type: 'milestone',
        title: `ציון בריאות מצוין: ${health.overall_score}/100 🎯`,
        description: 'העסק שלך במצב מעולה! המשך כך.',
        suggested_action: 'בדוק את הדאשבורד לפרטים',
        action_url: '/',
        priority: 'low',
        source_agent: 'מנתח הבריאות',
      });
    } else if (health.overall_score < 50) {
      alertsToCreate.push({
        alert_type: 'action_needed',
        title: `ציון בריאות נמוך: ${health.overall_score}/100`,
        description: 'יש מספר תחומים שדורשים שיפור. בדוק את ההמלצות.',
        suggested_action: 'עיין בדוח הבריאות ובצע פעולות מתקנות',
        action_url: '/agents',
        priority: 'high',
        source_agent: 'מנתח הבריאות',
      });
    }
  }

  // 6. Challenge suggestion
  const pendingReviewCount = reviews.filter(r => r.response_status === 'pending').length;
  if (pendingReviewCount > 0 || hotLeadsRecent.length > 0) {
    const challengeItems = [];
    if (pendingReviewCount > 0) challengeItems.push(`הגב ל-${Math.min(pendingReviewCount, 3)} ביקורות`);
    if (hotLeadsRecent.length > 0) challengeItems.push(`צור קשר עם ${Math.min(hotLeadsRecent.length, 2)} לידים חמים`);
    alertsToCreate.push({
      alert_type: 'challenge',
      title: `אתגר יומי 🏆`,
      description: challengeItems.join(' + '),
      suggested_action: challengeItems[0],
      action_url: pendingReviewCount > 0 ? '/reviews' : '/leads',
      priority: 'low',
      source_agent: 'מערכת QuietEyes',
    });
  }

  // Create alerts (avoid duplicates with existing active alerts)
  const activeAlertTitles = existingAlerts.filter(a => !a.is_dismissed).map(a => a.title);
  let created = 0;

  for (const alert of alertsToCreate) {
    if (activeAlertTitles.some(t => t === alert.title)) continue;
    await base44.asServiceRole.entities.ProactiveAlert.create({
      linked_business: bpId,
      ...alert,
      is_dismissed: false,
      is_acted_on: false,
      created_at: now,
    });
    created++;
  }

  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'generateProactiveAlerts',
      start_time: startTime,
      end_time: new Date().toISOString(),
      status: 'success',
      items_processed: created,
      linked_business: bpId,
    });
  } catch (_) {}

  console.log(`generateProactiveAlerts complete: ${created} alerts created`);
  return Response.json({ alerts_created: created, total_candidates: alertsToCreate.length });
});