import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import { sendWhatsAppMessage } from '../_shared/metaWhatsApp.ts';

// ============================================================
// CHANNEL WEBHOOK — Entry point for ALL incoming messages
// Handles: Meta WhatsApp real webhook, manual/internal API calls
// Meta requires 200 response quickly — heavy work delegated to whatsappBotHandler
// ============================================================

Deno.serve(async (req) => {
  try {

    // --------------------------------------------------------
    // GET: Meta webhook verification handshake
    // --------------------------------------------------------
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      if (mode === 'subscribe' && challenge) {
        const base44 = createClientFromRequest(req);
        const profiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
        const matching = profiles.find((p: any) => p.channels_webhook_secret === token);

        if (matching || !token) {
          console.log(`[channelWebhook] Verification OK`);
          return new Response(challenge, { status: 200 });
        }
        return new Response('Forbidden', { status: 403 });
      }
      return Response.json({ status: 'WhatsApp webhook endpoint active' });
    }

    // --------------------------------------------------------
    // POST: Incoming message
    // --------------------------------------------------------
    const base44 = createClientFromRequest(req);
    const rawBody = await req.json().catch(() => ({}));

    // Detect Meta Cloud API payload vs internal call
    if (rawBody.object === 'whatsapp_business_account' && rawBody.entry) {
      return await handleMetaWebhook(base44, rawBody);
    }
    return await handleInternalCall(base44, rawBody);

  } catch (err: any) {
    console.error('[channelWebhook] Fatal:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
});

// ============================================================
// HANDLER A: Real Meta Cloud API webhook
// ============================================================
async function handleMetaWebhook(base44: any, body: any): Promise<Response> {
  const processed: any[] = [];

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value?.messages?.length) continue; // Skip delivery receipts, read status

      const phoneNumberId = value.metadata?.phone_number_id;

      for (const msg of value.messages) {
        // Handle both text and interactive reply (button tap)
        let messageText = '';
        if (msg.type === 'text') {
          messageText = msg.text?.body || '';
        } else if (msg.type === 'interactive') {
          messageText = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';
        } else {
          continue; // Skip image, audio etc.
        }

        if (!messageText) continue;

        const senderPhone = msg.from; // e.g. "972501234567"
        const senderName = value.contacts?.find((c: any) => c.wa_id === senderPhone)?.profile?.name || 'לקוח';
        const messageId = msg.id;

        console.log(`[channelWebhook] Meta msg from ${senderPhone}: "${messageText.substring(0, 60)}"`);

        // Match business profile by phone_number_id
        const profiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
        const profile = profiles.find((p: any) => p.meta_wa_phone_number_id === phoneNumberId)
          || profiles.find((p: any) => p.bot_enabled);

        if (!profile) {
          console.error(`[channelWebhook] No profile for phone_number_id: ${phoneNumberId}`);
          continue;
        }

        const result = await processIncomingMessage(base44, {
          senderPhone,
          senderName,
          messageText,
          messageId,
          platform: 'whatsapp',
          profile,
          phoneNumberId: phoneNumberId || profile.meta_wa_phone_number_id || '',
        });

        processed.push(result);
      }
    }
  }

  // Meta requires fast 200 response or it retries
  return Response.json({ processed: processed.length });
}

// ============================================================
// HANDLER B: Internal/manual call
// ============================================================
async function handleInternalCall(base44: any, body: any): Promise<Response> {
  const { platform, business_id, message, sender, webhook_secret } = body;

  if (!platform || !business_id || !message) {
    return Response.json({ error: 'Missing: platform, business_id, message' }, { status: 400 });
  }

  const profiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
  const profile = profiles.find((p: any) => p.id === business_id);
  if (!profile) return Response.json({ error: 'Business not found' }, { status: 404 });

  if (profile.channels_webhook_secret && webhook_secret !== profile.channels_webhook_secret) {
    return Response.json({ error: 'Invalid webhook secret' }, { status: 401 });
  }

  const result = await processIncomingMessage(base44, {
    senderPhone: sender?.id || sender?.phone || '',
    senderName: sender?.name || 'לקוח',
    messageText: message,
    messageId: `manual_${Date.now()}`,
    platform,
    profile,
    phoneNumberId: profile.meta_wa_phone_number_id || '',
  });

  return Response.json(result);
}

// ============================================================
// CORE PROCESSOR
// ============================================================
async function processIncomingMessage(base44: any, ctx: {
  senderPhone: string;
  senderName: string;
  messageText: string;
  messageId: string;
  platform: string;
  profile: any;
  phoneNumberId: string;
}): Promise<any> {
  const { senderPhone, senderName, messageText, messageId, platform, profile, phoneNumberId } = ctx;

  if (!profile.bot_enabled) {
    return { skipped: true, reason: 'bot_disabled' };
  }

  // ---- Find existing lead ----
  const allLeads = await base44.asServiceRole.entities.Lead.filter({ linked_business: profile.id });
  const normalizedSender = senderPhone.replace(/[^0-9]/g, '');
  const existingLead = allLeads.find((l: any) => {
    const ph = (l.contact_info || l.contact_phone || '').replace(/[^0-9]/g, '');
    return ph.length >= 7 && (ph.includes(normalizedSender) || normalizedSender.includes(ph));
  });

  // ---- Find existing conversation ----
  const convos = existingLead
    ? await base44.asServiceRole.entities.ConversationHistory.filter({ lead_id: String(existingLead.id) })
    : [];
  const existingConvo = convos[0];

  // ---- Human takeover: bot is completely silent ----
  if (existingConvo?.human_takeover) {
    console.log(`[processIncoming] Human takeover — bot silent for ${senderName}`);
    return { skipped: true, reason: 'human_takeover' };
  }

  // ---- Off-hours auto-reply (only for new visitors) ----
  if (profile.bot_off_hours_message && !existingLead) {
    const nowIsrael = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
    const currentTotal = nowIsrael.getHours() * 60 + nowIsrael.getMinutes();

    const parseTime = (t: string) => {
      const [h, m] = (t || '09:00').split(':').map(Number);
      return h * 60 + (m || 0);
    };

    const startTotal = parseTime(profile.bot_working_hours_start || '09:00');
    const endTotal = parseTime(profile.bot_working_hours_end || '20:00');

    if (currentTotal < startTotal || currentTotal > endTotal) {
      const offMsg = profile.bot_off_hours_message ||
        `שלום! 🌙 אנחנו סגורים כרגע. נחזור אליך מחר בשעות ${profile.bot_working_hours_start || '09:00'}-${profile.bot_working_hours_end || '20:00'}. תשאיר הודעה ונחזור! 😊`;

      // Create lead so we remember them
      await base44.asServiceRole.entities.Lead.create({
        name: senderName,
        source: platform,
        contact_info: senderPhone,
        contact_phone: senderPhone,
        city: profile.city,
        status: 'cold',
        score: 30,
        notes: `פנה מחוץ לשעות פעילות. הודעה: "${messageText.substring(0, 200)}"`,
        linked_business: profile.id,
        created_at: new Date().toISOString(),
      });

      const sendResult = await sendWhatsAppMessage(phoneNumberId, profile.meta_wa_access_token || '', senderPhone, offMsg);
      return { success: true, strategy: 'off_hours', real_send: sendResult.success };
    }
  }

  let botResponse = '';
  let responseStrategy = 'qualification';

  if (existingLead && existingConvo?.status === 'active') {
    // EXISTING LEAD IN QUALIFICATION FLOW — delegate to whatsappBotHandler
    try {
      const botResult = await base44.asServiceRole.functions.invoke('whatsappBotHandler', {
        mode: 'reply',
        sender_phone: senderPhone,
        sender_message: messageText,
      });
      botResponse = botResult?.bot_response || '';
      responseStrategy = botResult?.action === 'qualification_complete' ? 'handoff' : 'qualification';
    } catch (err: any) {
      console.error('[channelWebhook] Bot handler error:', err.message);
      botResponse = 'תודה! נחזור אליך בקרוב. 🙏';
    }
  } else if (existingLead && existingConvo && existingConvo.status !== 'active') {
    // RETURNING CUSTOMER — AI freeform response
    responseStrategy = 'ai_freeform';
    botResponse = await generateAIResponse(base44, messageText, profile, existingLead, existingConvo);
  } else {
    // NEW VISITOR — detect intent
    const intent = await detectIntent(base44, messageText, profile);

    if (intent.is_spam || intent.confidence < 20) {
      return { skipped: true, reason: 'low_confidence_intent' };
    }

    if (intent.wants_info) {
      // Answer question + soft call-to-action
      responseStrategy = 'ai_freeform';
      const aiAnswer = await generateAIResponse(base44, messageText, profile, null, null);
      const topService = profile.relevant_services?.split(',')[0]?.trim() || 'השירותים שלנו';
      botResponse = `${aiAnswer}\n\nרוצה שנקבע שיחה קצרה? אשמח לספר עוד על ${topService}. 😊`;
    } else {
      // Start qualification — create lead + delegate to bot handler
      responseStrategy = 'qualification';

      const newLead = await base44.asServiceRole.entities.Lead.create({
        name: senderName,
        source: platform,
        contact_info: senderPhone,
        contact_phone: senderPhone,
        city: profile.city,
        status: 'warm',
        score: 40,
        lifecycle_stage: 'new',
        linked_business: profile.id,
        created_at: new Date().toISOString(),
      });

      try {
        const startResult = await base44.asServiceRole.functions.invoke('whatsappBotHandler', {
          mode: 'new_lead',
          event: { type: 'create' },
          data: { ...newLead, linked_business: profile.id },
        });
        botResponse = startResult?.message || profile.bot_greeting || `שלום ${senderName}! 👋 ברוכים הבאים ל${profile.name}.`;
      } catch (err: any) {
        botResponse = profile.bot_greeting || `שלום ${senderName}! 👋 ברוכים הבאים ל${profile.name}. איך אוכל לעזור?`;
      }

      const sendResult = await sendWhatsAppMessage(phoneNumberId, profile.meta_wa_access_token || '', senderPhone, botResponse);
      return { success: true, strategy: 'new_lead_started', real_send: sendResult.success, wa_link: sendResult.waLink };
    }
  }

  // ---- Update conversation history ----
  if (existingConvo) {
    let messages: any[] = [];
    try { messages = JSON.parse(existingConvo.messages || '[]'); } catch (_) {}
    messages.push({ role: 'user', text: messageText, time: new Date().toISOString(), message_id: messageId });
    if (botResponse) messages.push({ role: 'bot', text: botResponse, time: new Date().toISOString() });

    await base44.asServiceRole.entities.ConversationHistory.update(existingConvo.id, {
      messages: JSON.stringify(messages),
      last_message_at: new Date().toISOString(),
    });
  } else if (existingLead && botResponse) {
    await base44.asServiceRole.entities.ConversationHistory.create({
      linked_business: profile.id,
      lead_id: String(existingLead.id),
      sender_id: senderPhone,
      sender_name: senderName,
      platform,
      messages: JSON.stringify([
        { role: 'user', text: messageText, time: new Date().toISOString() },
        { role: 'bot', text: botResponse, time: new Date().toISOString() },
      ]),
      status: 'active',
      human_takeover: false,
      last_message_at: new Date().toISOString(),
      summary: `שיחה עם ${senderName}`,
    });
  }

  // ---- Send response ----
  if (botResponse) {
    const sendResult = await sendWhatsAppMessage(phoneNumberId, profile.meta_wa_access_token || '', senderPhone, botResponse);
    return { success: true, strategy: responseStrategy, bot_response: botResponse, real_send: sendResult.success, wa_link: sendResult.waLink };
  }

  return { skipped: true, reason: 'no_response_generated' };
}

// ============================================================
// INTENT DETECTION
// ============================================================
async function detectIntent(base44: any, message: string, profile: any): Promise<{
  is_spam: boolean;
  wants_info: boolean;
  confidence: number;
}> {
  try {
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `Message to a ${profile.category} business in ${profile.city}: "${message}"

Return JSON:
- is_spam: true if spam, bot test, or totally irrelevant (just "hi", emojis, "test")
- wants_info: true if asking a specific question about services/prices
- confidence: 0-100 likelihood this is a real potential customer`,
      model: 'gemini_3_flash',
      response_json_schema: {
        type: 'object',
        properties: {
          is_spam: { type: 'boolean' },
          wants_info: { type: 'boolean' },
          confidence: { type: 'number' },
        }
      }
    });
    return result || { is_spam: false, wants_info: false, confidence: 50 };
  } catch {
    return { is_spam: false, wants_info: false, confidence: 50 };
  }
}

// ============================================================
// AI FREEFORM RESPONSE
// ============================================================
async function generateAIResponse(
  base44: any,
  message: string,
  profile: any,
  lead: any,
  convo: any
): Promise<string> {
  let history = '';
  if (convo?.messages) {
    try {
      const msgs = JSON.parse(convo.messages);
      history = msgs.slice(-6).map((m: any) => `${m.role === 'user' ? 'לקוח' : 'בוט'}: ${m.text}`).join('\n');
    } catch (_) {}
  }

  try {
    const response = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `אתה נציג של "${profile.name}" ב${profile.city} (${profile.category}).
שירותים: ${profile.bot_services_info || profile.relevant_services || 'לא הוגדר'}
טון: ${profile.tone_preference || 'ידידותי ומקצועי'}
${lead ? `לקוח: ${lead.name}, שירות: ${lead.service_needed || 'לא ידוע'}` : ''}
${history ? `היסטוריה:\n${history}` : ''}

הודעה: "${message}"

ענה בעברית, 2-4 שורות, סגנון WhatsApp. היה ספציפי. אל תתחיל עם "שלום" אם זה לא ראשון.
החזר רק את טקסט ההודעה.`,
    });
    return (typeof response === 'string' ? response : JSON.stringify(response)).trim();
  } catch {
    return 'תודה על הודעתך! נציג שלנו יחזור אליך בהקדם. 🙏';
  }
}
