import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const profiles = await base44.entities.BusinessProfile.filter({ created_by: user.email });
  const profile = profiles[0];
  if (!profile) return Response.json({ error: 'No business profile' }, { status: 404 });

  const bpId = profile.id;
  const params = { businessProfileId: bpId };
  const results: Record<string, any> = {};
  const startTime = new Date().toISOString();

  console.log(`[runFullScan] Starting for "${profile.name}" (${profile.category}, ${profile.city})`);

  for (const [step, fn] of [
    ['collectWebSignals', 'collectWebSignals'],
    ['collectSocialSignals', 'collectSocialSignals'],
    ['scanAllReviews', 'scanAllReviews'],
    ['runMarketIntelligence', 'runMarketIntelligence'],
    ['runCompetitorIdentification', 'runCompetitorIdentification'],
    ['runLeadGeneration', 'runLeadGeneration'],
    ['findSocialLeads', 'findSocialLeads'],
    ['detectTrends', 'detectTrends'],
    ['runPredictions', 'runPredictions'],
    ['calculateHealthScore', 'calculateHealthScore'],
    ['generateProactiveAlerts', 'generateProactiveAlerts'],
    ['generateMorningBriefing', 'generateMorningBriefing'],
  ] as [string, string][]) {
    try {
      const r = await base44.functions.invoke(fn, params);
      results[step] = r.data;
      console.log(`[runFullScan] ✓ ${step}:`, JSON.stringify(r.data).slice(0, 100));
    } catch (e: any) {
      results[step] = { error: e.message };
      console.error(`[runFullScan] ✗ ${step} FAILED:`, e.message);
    }
  }

  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'runFullScan',
      start_time: startTime,
      end_time: new Date().toISOString(),
      status: Object.values(results).some((r: any) => r?.error) ? 'error' : 'success',
      items_processed: 1,
      linked_business: bpId,
    });
  } catch (_) {}

  return Response.json({ success: true, profile: profile.name, results });
});
