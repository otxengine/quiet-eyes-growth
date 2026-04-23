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
    const allProfiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = allProfiles[0];
  }
  if (!profile) return Response.json({ error: 'No business profile', tracked: 0 }, { status: 404 });

  const competitors = await base44.asServiceRole.entities.Competitor.filter({ linked_business: profile.id });
  if (competitors.length === 0) return Response.json({ tracked: 0, changes: 0 });

  let tracked = 0;
  let changes = 0;

  for (const comp of competitors.slice(0, 10)) {
    try {
      const searchResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `חפש באינטרנט מידע על מחירים עבור "${comp.name}" ${profile.city} מחירים מחירון.
מצא את המחירים העדכניים ביותר של "${comp.name}" (${comp.category || profile.category}).
החזר כל מידע על מחירים שאתה מוצא — שירותים, מחירון, עלויות.`,
        model: 'gemini_3_flash',
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            pricing_info: { type: "string" },
            found: { type: "boolean" }
          }
        }
      });

      if (!searchResult?.found || !searchResult?.pricing_info) continue;

      const analysis = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `You are monitoring competitor pricing for an Israeli small business.
Business: ${profile.name}, Category: ${profile.category}, City: ${profile.city}
Competitor: ${comp.name}
Web data found:
${searchResult.pricing_info}

Previous known prices for this competitor: ${comp.last_known_prices || 'none'}

Extract any pricing information you can find. Then determine:
- current_prices: summary of prices found (Hebrew, 1-2 lines)
- price_changed: true/false — did prices change from last known?
- change_description: what changed (Hebrew, 1 line) or "none"
- change_direction: "up" / "down" / "same" / "unknown"`,
        response_json_schema: {
          type: "object",
          properties: {
            current_prices: { type: "string" },
            price_changed: { type: "boolean" },
            change_description: { type: "string" },
            change_direction: { type: "string" }
          }
        }
      });

      if (!analysis?.current_prices) continue;
      tracked++;

      const updateData = {
        last_known_prices: analysis.current_prices,
        last_price_check: new Date().toISOString(),
      };
      if (analysis.price_changed) {
        updateData.price_changed_at = new Date().toISOString();
      }
      await base44.asServiceRole.entities.Competitor.update(comp.id, updateData);

      if (analysis.price_changed) {
        changes++;
        await base44.asServiceRole.entities.MarketSignal.create({
          summary: `${comp.name} שינה מחירים — ${analysis.change_description}`,
          impact_level: 'high',
          category: 'competitor_move',
          recommended_action: analysis.change_direction === 'down'
            ? 'שקול להתאים מחירים או להדגיש ערך מוסף'
            : 'הזדמנות — המתחרה העלה מחירים',
          confidence: 80,
          is_read: false,
          detected_at: new Date().toISOString(),
          linked_business: profile.id,
        });

        // WhatsApp alert if enabled
        if (profile.wa_alert_phone && profile.wa_alert_high_impact) {
          const phone = profile.wa_alert_phone.replace(/[\s\-]/g, '').replace(/^0/, '972');
          const msg = `⚠️ שינוי מחירים אצל ${comp.name}:\n${analysis.change_description}\nמחירים: ${analysis.current_prices}`;
          await base44.asServiceRole.entities.PendingAlert.create({
            alert_type: 'high_impact_signal',
            message: msg,
            whatsapp_url: `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`,
            phone,
            is_sent: false,
            linked_business: profile.id,
          });
        }
      }
    } catch (err) {
      console.error(`Price tracking error for ${comp.name}:`, err.message);
    }
  }

  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'trackCompetitorPrices',
      start_time: new Date(Date.now() - 5000).toISOString(),
      end_time: new Date().toISOString(),
      status: 'success',
      items_processed: tracked,
      linked_business: profile.id,
    });
  } catch (_) {}

  console.log(`trackCompetitorPrices: ${tracked} tracked, ${changes} changes`);
  return Response.json({ tracked, changes });
});