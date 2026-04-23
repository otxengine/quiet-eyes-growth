import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const startTime = new Date().toISOString();

  let profile;
  if (body.businessProfileId) {
    const all = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = all.find((p: any) => p.id === body.businessProfileId);
  }
  if (!profile) {
    const all = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = all[0];
  }
  if (!profile) return Response.json({ error: 'No business profile' }, { status: 404 });

  const bpId = profile.id;
  const now = new Date();

  const d90 = new Date(now.getTime() - 90 * 86400000).toISOString();
  const d31 = new Date(now.getTime() - 31 * 86400000).toISOString();
  const d180 = new Date(now.getTime() - 180 * 86400000).toISOString();
  const d30 = new Date(now.getTime() - 30 * 86400000).toISOString();

  let archivedLeads = 0;
  let retentionCandidates = 0;
  let historicalReviews = 0;
  let rawSignalsCleaned = 0;
  let winBackAlerts = 0;

  // --- 1. Archive stale cold/lost leads (>90 days) ---
  const staleLeads = await base44.asServiceRole.entities.Lead.filter(
    { linked_business: bpId },
    '-created_date',
    200
  );

  for (const lead of staleLeads) {
    if (lead.is_archived) continue;
    const createdAt = lead.created_at || lead.created_date || '';
    if (!createdAt) continue;

    const isStale = (lead.status === 'cold' || lead.status === 'lost') && createdAt < d90;
    if (isStale) {
      await base44.asServiceRole.entities.Lead.update(lead.id, {
        is_archived: true,
        archived_at: now.toISOString(),
      });
      archivedLeads++;
    }
  }

  // --- 2. Mark retention candidates (completed >31 days ago) ---
  const completedLeads = staleLeads.filter(
    (l: any) => !l.is_archived && !l.retention_candidate &&
    (l.status === 'completed' || l.lifecycle_stage === 'closed_won') &&
    (l.closed_at || l.created_at || '') < d31
  );

  for (const lead of completedLeads) {
    await base44.asServiceRole.entities.Lead.update(lead.id, { retention_candidate: true });
    retentionCandidates++;

    // Win-back WhatsApp alert if phone exists
    if (lead.contact_phone) {
      try {
        await base44.asServiceRole.entities.PendingAlert.create({
          alert_type: 'win_back',
          message: `שלום ${lead.name}! זה כבר קצת זמן שלא דיברנו. יש לנו הצעות חדשות שיכולות לעניין אותך — נשמח לעדכן!`,
          phone: lead.contact_phone,
          is_sent: false,
          linked_business: bpId,
        });
        winBackAlerts++;
      } catch (_) {}
    }
  }

  // --- 3. Mark old reviews as historical (>180 days) ---
  const allReviews = await base44.asServiceRole.entities.Review.filter(
    { linked_business: bpId },
    '-created_date',
    500
  );

  for (const review of allReviews) {
    if (review.is_historical) continue;
    const createdAt = review.created_at || review.created_date || '';
    if (!createdAt) continue;

    if (createdAt < d180) {
      const year = new Date(createdAt).getFullYear();
      await base44.asServiceRole.entities.Review.update(review.id, {
        is_historical: true,
        review_year: year,
      });
      historicalReviews++;
    }
  }

  // --- 4. Clean up raw signals older than 30 days ---
  try {
    const rawSignals = await base44.asServiceRole.entities.RawSignal.filter(
      { linked_business: bpId },
      '-created_date',
      500
    );
    for (const sig of rawSignals) {
      const createdAt = sig.created_at || sig.created_date || '';
      if (createdAt && createdAt < d30) {
        await base44.asServiceRole.entities.RawSignal.delete(sig.id);
        rawSignalsCleaned++;
      }
    }
  } catch (_) {}

  // --- 5. AutomationLog ---
  const itemsProcessed = archivedLeads + retentionCandidates + historicalReviews + rawSignalsCleaned;
  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'applyDataFreshness',
      start_time: startTime,
      end_time: new Date().toISOString(),
      status: 'success',
      items_processed: itemsProcessed,
      linked_business: bpId,
    });
  } catch (_) {}

  console.log(`applyDataFreshness: archived=${archivedLeads}, retention=${retentionCandidates}, historical=${historicalReviews}, rawCleaned=${rawSignalsCleaned}, winBack=${winBackAlerts}`);
  return Response.json({
    archived_leads: archivedLeads,
    retention_candidates: retentionCandidates,
    historical_reviews: historicalReviews,
    raw_signals_cleaned: rawSignalsCleaned,
    win_back_alerts: winBackAlerts,
  });
});
