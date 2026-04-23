import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { action_type, was_accepted, outcome_description, impact_score, linked_business, linked_action } = body;

    if (!action_type || was_accepted === undefined) {
      return Response.json({ error: 'Missing required fields: action_type, was_accepted' }, { status: 400 });
    }

    const log = await base44.asServiceRole.entities.OutcomeLog.create({
      action_type,
      was_accepted,
      outcome_description: outcome_description || '',
      impact_score: impact_score || 5,
      created_at: new Date().toISOString(),
      linked_business: linked_business || '',
      linked_action: linked_action || '',
    });

    return Response.json({ message: 'Outcome logged', log_id: log.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});