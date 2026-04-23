import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import { sendWhatsAppMessage, sendInteractiveButtons, buildWaLink } from '../_shared/metaWhatsApp.ts';

// Send a question, using interactive buttons when the question type supports it
async function sendQuestion(
  phoneNumberId: string,
  accessToken: string,
  phone: string,
  question: string,
  profile: any
): Promise<void> {
  const urgencyQ = /מתי|דחוף|urgency/i.test(question);
  const budgetQ = /תקציב|מחיר|עלות|budget/i.test(question);

  if (urgencyQ) {
    await sendInteractiveButtons(phoneNumberId, accessToken, phone, question, [
      { id: 'today', title: 'היום דחוף ⚡' },
      { id: 'week', title: 'השבוע' },
      { id: 'month', title: 'בחודש הקרוב' },
    ]);
  } else if (budgetQ) {
    const minB = parseInt((profile.min_budget || '500').replace(/[^\d]/g, '')) || 500;
    await sendInteractiveButtons(phoneNumberId, accessToken, phone, question, [
      { id: 'low', title: `עד ₪${minB.toLocaleString()}` },
      { id: 'mid', title: `₪${minB.toLocaleString()}-${(minB * 3).toLocaleString()}` },
      { id: 'high', title: `מעל ₪${(minB * 3).toLocaleString()}` },
    ]);
  } else {
    await sendWhatsAppMessage(phoneNumberId, accessToken, phone, question);
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const { mode, lead_id, event, data, sender_message, sender_phone } = body;

  // ===========================
  // MODE: NEW LEAD — start qualification
  // ===========================
  if (event?.type === 'create' || mode === 'new_lead') {
    const leadData = data || {};
    if (!leadData.linked_business) return Response.json({ skipped: true, reason: 'No linked business' });

    const profiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
    const profile = profiles.find((p: any) => p.id === leadData.linked_business);
    if (!profile || !profile.bot_enabled) return Response.json({ skipped: true, reason: 'Bot not enabled' });

    const phoneMatch = leadData.contact_info?.match(/[\d\-+()]{7,}/);
    const phone = phoneMatch ? phoneMatch[0].replace(/[^0-9+]/g, '') : null;
    if (!phone) return Response.json({ skipped: true, reason: 'No phone number on lead' });

    // Load ML winner DNA to customize greeting
    const sectorAll = await base44.asServiceRole.entities.SectorKnowledge.filter({});
    const sk = sectorAll.find((s: any) => s.sector === profile.category);
    const winnerDNA = (() => { try { return JSON.parse(sk?.winner_lead_dna || 'null'); } catch { return null; } })();

    // Build personalized greeting
    const topService = winnerDNA?.top_services?.[0] || profile.relevant_services?.split(',')[0]?.trim() || '';
    const greeting = profile.bot_greeting ||
      `שלום${leadData.name ? ' ' + leadData.name : ''}! 👋 ברוכים הבאים ל${profile.name}. אשמח לעזור לך${topService ? ' עם ' + topService : ''}.`;

    const questions = (profile.bot_qualification_questions ||
      'מה השירות שאתה מחפש?\nמה התקציב המשוער שלך?\nמתי אתה צריך את השירות?\nבאיזה אזור אתה נמצא?')
      .split('\n').map((q: string) => q.trim()).filter(Boolean);

    const openingMessage = `${greeting}\n\n${questions[0] || 'איך אוכל לעזור לך?'}`;

    const conversationState = {
      step: 0,
      total_steps: questions.length,
      questions,
      answers: [] as any[],
      phone,
      started_at: new Date().toISOString(),
    };

    const leadIdFinal = leadData.id || event?.entity_id;
    await base44.asServiceRole.entities.Lead.update(leadIdFinal, {
      questionnaire_answers: JSON.stringify(conversationState),
    });

    // Create ConversationHistory record
    await base44.asServiceRole.entities.ConversationHistory.create({
      linked_business: leadData.linked_business,
      sender_id: phone,
      sender_name: leadData.name || '',
      platform: 'whatsapp',
      messages: JSON.stringify([
        { role: 'bot', text: openingMessage, time: new Date().toISOString() }
      ]),
      status: 'active',
      qualification_step: 0,
      total_steps: questions.length,
      lead_created: true,
      lead_id: String(leadIdFinal),
      human_takeover: false,
      summary: `שיחת סינון התחילה עם ${leadData.name || 'ליד חדש'}`,
      last_message_at: new Date().toISOString(),
    });

    // Send real message or generate link
    const sendResult = await sendWhatsAppMessage(
      profile.meta_wa_phone_number_id || '',
      profile.meta_wa_access_token || '',
      phone,
      openingMessage
    );

    console.log(`[whatsappBotHandler] Opening for lead ${leadData.name}, sent: ${sendResult.success}`);
    return Response.json({
      success: true,
      action: 'opening_sent',
      real_send: sendResult.success,
      message_id: sendResult.messageId,
      whatsapp_link: sendResult.waLink,
      message: openingMessage,
    });
  }

  // ===========================
  // MODE: REPLY — continue or complete qualification
  // ===========================
  if ((mode === 'reply' || mode === 'incoming') && sender_phone && sender_message) {
    const allLeads = await base44.asServiceRole.entities.Lead.filter({});
    const lead = allLeads.find((l: any) => {
      const ph = (l.contact_info || '').replace(/[^0-9+]/g, '');
      const sid = sender_phone.replace(/[^0-9+]/g, '');
      return ph && sid && ph.length >= 7 && (ph.includes(sid) || sid.includes(ph));
    });

    if (!lead) return Response.json({ error: 'Lead not found for this phone' }, { status: 404 });

    const profiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
    const profile = profiles.find((p: any) => p.id === lead.linked_business);
    if (!profile) return Response.json({ error: 'Profile not found' }, { status: 404 });

    // Check if human has taken over
    const convos = await base44.asServiceRole.entities.ConversationHistory.filter({ lead_id: String(lead.id) });
    const convo = convos[0];
    if (convo?.human_takeover) {
      console.log(`[whatsappBotHandler] Human takeover active for ${lead.name} — bot silent`);
      return Response.json({ skipped: true, reason: 'Human takeover active', human_handling: true });
    }

    // Parse qualification state
    let state: any;
    try { state = JSON.parse(lead.questionnaire_answers || '{}'); } catch (_) { state = {}; }

    if (!state.questions?.length) {
      const questions = (profile.bot_qualification_questions ||
        'מה השירות שאתה מחפש?\nמה התקציב המשוער שלך?\nמתי אתה צריך?\nאיזור?')
        .split('\n').map((q: string) => q.trim()).filter(Boolean);
      state = { step: 0, questions, answers: [], total_steps: questions.length };
    }

    state.answers = state.answers || [];
    state.answers.push({
      question: state.questions[state.step] || `שאלה ${state.step + 1}`,
      answer: sender_message,
      answered_at: new Date().toISOString(),
    });
    state.step++;

    let botResponse = '';
    let qualificationComplete = false;
    let finalAnalysis: any = null;

    if (state.step < state.total_steps) {
      // More questions remain — use interactive buttons where appropriate
      botResponse = state.questions[state.step];
      // Send question now with buttons (sendQuestion handles the send)
      await sendQuestion(
        profile.meta_wa_phone_number_id || '',
        profile.meta_wa_access_token || '',
        sender_phone,
        botResponse,
        profile
      );
    } else {
      // All questions answered — analyze with ML-enhanced criteria
      qualificationComplete = true;

      const sectorAll = await base44.asServiceRole.entities.SectorKnowledge.filter({});
      const sk = sectorAll.find((s: any) => s.sector === profile.category);
      const winnerDNA = (() => { try { return JSON.parse(sk?.winner_lead_dna || 'null'); } catch { return null; } })();

      const mlCriteriaContext = (profile.bot_use_ml_criteria !== false && winnerDNA) ? `
ML WINNER DNA (from ${winnerDNA.total_won} closed deals):
- Average winning budget: ₪${winnerDNA.avg_budget}
- Top winning sources: ${winnerDNA.top_sources?.join(', ')}
- Top winning services: ${winnerDNA.top_services?.join(', ')}
- Average days to close: ${winnerDNA.avg_days_to_close} days
Use this to calibrate the score — leads matching winner patterns should score 20+ points higher.
` : '';

      const answersText = state.answers.map((a: any) => `Q: ${a.question}\nA: ${a.answer}`).join('\n---\n');

      finalAnalysis = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `You are analyzing a lead qualification conversation for "${profile.name}" (${profile.category}, ${profile.city}).

BUSINESS QUALIFICATION CRITERIA:
Good lead: ${profile.bot_good_lead_criteria || 'relevant service, appropriate budget, urgency'}
Bad lead: ${profile.bot_bad_lead_criteria || 'too low budget, irrelevant service'}
Services offered: ${profile.relevant_services || profile.bot_services_info || 'not specified'}
Minimum budget: ${profile.min_budget || 'not set'}

${mlCriteriaContext}

CONVERSATION WITH "${lead.name}":
${answersText}

Return JSON:
{
  "score": 0-100,
  "status": "hot|warm|cold",
  "service_needed": "specific service from answers",
  "budget_range": "budget from answers",
  "urgency": "היום|השבוע|החודש|מתעניין",
  "summary": "2-sentence Hebrew summary of this lead",
  "fit_score": 0-100,
  "fit_reasoning": "why this score in Hebrew",
  "closing_message": "warm Hebrew WhatsApp closing message — if hot/warm: say someone will contact soon; if cold: thank them and keep door open",
  "should_notify_owner": true if hot/warm
}`,
        model: 'gemini_3_flash',
        response_json_schema: {
          type: 'object',
          properties: {
            score: { type: 'number' },
            status: { type: 'string' },
            service_needed: { type: 'string' },
            budget_range: { type: 'string' },
            urgency: { type: 'string' },
            summary: { type: 'string' },
            fit_score: { type: 'number' },
            fit_reasoning: { type: 'string' },
            closing_message: { type: 'string' },
            should_notify_owner: { type: 'boolean' },
          }
        }
      });

      await base44.asServiceRole.entities.Lead.update(lead.id, {
        score: finalAnalysis.score || lead.score,
        status: finalAnalysis.status || lead.status,
        service_needed: finalAnalysis.service_needed || lead.service_needed,
        budget_range: finalAnalysis.budget_range || lead.budget_range,
        urgency: finalAnalysis.urgency || lead.urgency,
        questionnaire_answers: JSON.stringify({
          fit_score: finalAnalysis.fit_score,
          fit_reasoning: finalAnalysis.fit_reasoning,
          summary: finalAnalysis.summary,
          answers: state.answers,
          completed_at: new Date().toISOString(),
        }),
      });

      botResponse = finalAnalysis.closing_message || 'תודה רבה! נחזור אליך בהקדם. 🙏';

      // Notify owner if hot/warm
      if (finalAnalysis.should_notify_owner && (profile.wa_alert_hot_lead || profile.push_whatsapp_alerts)) {
        const alertPhone = profile.wa_alert_phone || profile.push_whatsapp_number;
        if (alertPhone) {
          const ownerMsg = `🔥 ליד חדש מוסמך!\n${lead.name || 'לקוח'} | ${finalAnalysis.service_needed || ''}\nתקציב: ${finalAnalysis.budget_range || '?'} | ציון: ${finalAnalysis.score}/100\nסיכום: ${finalAnalysis.summary || ''}`;
          await sendWhatsAppMessage(
            profile.meta_wa_phone_number_id || '',
            profile.meta_wa_access_token || '',
            alertPhone,
            ownerMsg
          );
        }
      }

      // Trigger CRM sync
      try {
        await base44.asServiceRole.functions.invoke('syncLeadToCrm', {
          event: { type: 'update' },
          data: { ...lead, score: finalAnalysis.score, status: finalAnalysis.status, service_needed: finalAnalysis.service_needed, linked_business: lead.linked_business },
        });
      } catch (_) {}
    }

    // Update or keep qualification state
    if (!qualificationComplete) {
      await base44.asServiceRole.entities.Lead.update(lead.id, {
        questionnaire_answers: JSON.stringify(state),
      });
    }

    // Update ConversationHistory
    if (convo) {
      let messages: any[] = [];
      try { messages = JSON.parse(convo.messages || '[]'); } catch (_) {}
      messages.push({ role: 'user', text: sender_message, time: new Date().toISOString() });
      messages.push({ role: 'bot', text: botResponse, time: new Date().toISOString() });

      await base44.asServiceRole.entities.ConversationHistory.update(convo.id, {
        messages: JSON.stringify(messages),
        qualification_step: state.step,
        status: qualificationComplete
          ? (finalAnalysis?.status === 'cold' ? 'rejected' : 'qualified')
          : 'active',
        summary: qualificationComplete
          ? `סיכום: ${finalAnalysis?.summary || 'שיחה הושלמה'}`
          : `שלב ${state.step}/${state.total_steps}`,
        last_message_at: new Date().toISOString(),
      });
    }

    // Send closing message (next-question was already sent by sendQuestion above)
    let sendSuccess = !qualificationComplete; // already sent if not complete
    let waLink = '';
    if (qualificationComplete) {
      const sendResult = await sendWhatsAppMessage(
        profile.meta_wa_phone_number_id || '',
        profile.meta_wa_access_token || '',
        sender_phone,
        botResponse
      );
      sendSuccess = sendResult.success;
      waLink = sendResult.waLink || '';
    }

    return Response.json({
      success: true,
      action: qualificationComplete ? 'qualification_complete' : 'next_question',
      step: state.step,
      total_steps: state.total_steps,
      bot_response: botResponse,
      real_send: sendSuccess,
      whatsapp_link: waLink,
      lead_status: qualificationComplete ? finalAnalysis?.status : undefined,
    });
  }

  // ===========================
  // MODE: HUMAN_TAKEOVER — stop bot, alert owner
  // ===========================
  if (mode === 'human_takeover' && lead_id) {
    const leads = await base44.asServiceRole.entities.Lead.filter({ id: lead_id });
    const lead = leads[0];
    if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 });

    const convos = await base44.asServiceRole.entities.ConversationHistory.filter({ lead_id: String(lead_id) });
    if (convos[0]) {
      await base44.asServiceRole.entities.ConversationHistory.update(convos[0].id, {
        human_takeover: true,
        human_takeover_at: new Date().toISOString(),
        status: 'handed_off',
      });
    }

    return Response.json({ success: true, message: 'Human takeover activated — bot is now silent' });
  }

  return Response.json({ error: 'Invalid mode' }, { status: 400 });
});
