/**
 * Master Meta Webhook
 *
 * GET  /api/webhooks/meta  — Verification challenge (Meta calls this once on registration)
 * POST /api/webhooks/meta  — All incoming messages for ALL tenants
 *
 * Flow for each incoming message:
 *  1. Verify HMAC-SHA256 signature (rejects tampered payloads)
 *  2. Acknowledge with 200 immediately (Meta requires < 5 s)
 *  3. Extract destination ID (phone_number_id or page_id) from payload
 *  4. Look up MetaConnection + decrypt access token
 *  5. Load conversation context (last 20 turns)
 *  6. Skip if conversation is in human_handoff state
 *  7. Call AI (Claude via invokeLLM) with system prompt + context
 *  8. Send AI reply via Graph API
 *  9. If AI signals handoff: update DB + trigger pass_thread_control (Messenger)
 */

import { Router, Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { prisma } from '../../db';
import { decryptToken } from '../../lib/crypto';
import { metaApi } from '../../lib/metaApi';
import { invokeLLM } from '../../lib/llm';

const router = Router();

// ── Signature Verification ────────────────────────────────────────────────────

/**
 * Meta signs every webhook POST with HMAC-SHA256 using the App Secret.
 * The signature is sent in the X-Hub-Signature-256 header as "sha256=<hex>".
 * We use timingSafeEqual to prevent timing attacks.
 */
function verifyMetaSignature(rawBody: Buffer, signatureHeader: string): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret || !signatureHeader) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const received = signatureHeader.replace('sha256=', '');

  // Pad to the same length before comparing to avoid length-based side channels
  try {
    return timingSafeEqual(
      Buffer.from(expected.padEnd(64, '0'), 'hex'),
      Buffer.from(received.padEnd(64, '0'), 'hex')
    ) && expected === received;
  } catch {
    return false;
  }
}

// ── Verification Challenge (GET) ──────────────────────────────────────────────

router.get('/', (req: Request, res: Response) => {
  const mode      = req.query['hub.mode']         as string;
  const token     = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge']    as string;

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    console.log('[Meta webhook] Verification challenge accepted');
    return res.status(200).send(challenge);
  }

  console.warn('[Meta webhook] Verification failed — token mismatch');
  return res.sendStatus(403);
});

// ── Master POST Handler ───────────────────────────────────────────────────────

router.post('/', (req: Request, res: Response) => {
  console.log('[Meta webhook] POST received from', req.ip);

  // 1. Verify signature using the raw body captured before JSON parsing
  const rawBody   = (req as any).rawBody as Buffer | undefined;
  const signature = req.headers['x-hub-signature-256'] as string ?? '';

  if (!rawBody || !verifyMetaSignature(rawBody, signature)) {
    console.warn('[Meta webhook] Invalid signature — rejecting. sig present:', !!signature, '| rawBody present:', !!rawBody);
    return res.sendStatus(403);
  }

  // 2. Acknowledge immediately — Meta retries if it doesn't get 200 within 5 s
  res.sendStatus(200);

  // 3. Process asynchronously so we never block the response
  processPayload(req.body).catch(err => {
    console.error('[Meta webhook] Processing error:', err.message);
  });
});

// ── Payload Router ────────────────────────────────────────────────────────────

async function processPayload(payload: any): Promise<void> {
  const object: string = payload.object ?? '';

  for (const entry of payload.entry ?? []) {
    if (object === 'whatsapp_business_account') {
      await handleWhatsAppEntry(entry);
    } else if (object === 'page') {
      await handleMessengerEntry(entry);
    }
  }
}

// ── WhatsApp Cloud API ────────────────────────────────────────────────────────

async function handleWhatsAppEntry(entry: any): Promise<void> {
  for (const change of entry.changes ?? []) {
    if (change.field !== 'messages') continue;

    const value         = change.value ?? {};
    const phoneNumberId = value.metadata?.phone_number_id as string;
    if (!phoneNumberId) continue;

    for (const message of value.messages ?? []) {
      // Only process inbound text messages for now; ignore status updates
      if (message.type !== 'text') continue;

      await handleIncomingMessage({
        platform:      'whatsapp',
        destinationId: phoneNumberId,
        senderId:      message.from as string,
        text:          message.text?.body as string ?? '',
      });
    }
  }
}

// ── Facebook Messenger ────────────────────────────────────────────────────────

async function handleMessengerEntry(entry: any): Promise<void> {
  const pageId: string = entry.id;

  for (const event of entry.messaging ?? []) {
    // Skip echo messages (messages sent by the page itself)
    if (event.message?.is_echo) continue;
    if (!event.message?.text) continue;

    await handleIncomingMessage({
      platform:      'messenger',
      destinationId: pageId,
      senderId:      event.sender?.id as string,
      text:          event.message.text as string,
    });
  }
}

// ── Core Message Handler ──────────────────────────────────────────────────────

interface IncomingMessage {
  platform:      'whatsapp' | 'messenger';
  destinationId: string; // phone_number_id or page_id
  senderId:      string;
  text:          string;
}


// ── Dynamic Prompt Builder ────────────────────────────────────────────────────

function buildDynamicPrompt(bp: {
  name?: string | null;
  category?: string | null;
  city?: string | null;
  bot_greeting?: string | null;
  bot_qualification_questions?: string | null;
  bot_good_lead_criteria?: string | null;
  bot_bad_lead_criteria?: string | null;
  bot_services_info?: string | null;
}): string {
  const questions = (bp.bot_qualification_questions ?? '')
    .split('\n')
    .map(q => q.trim())
    .filter(Boolean);

  const parts: string[] = [
    `You are a WhatsApp sales assistant for "${bp.name ?? 'this business'}"${bp.category ? ` (${bp.category})` : ''}${bp.city ? `, based in ${bp.city}` : ''}.`,
    '',
    "Your job: have a natural, friendly conversation to understand the customer's needs and qualify them as a lead.",
    '',
  ];

  if (bp.bot_greeting) {
    parts.push(`Opening greeting to use on the very first message: "${bp.bot_greeting}"`);
    parts.push('');
  }

  if (questions.length > 0) {
    parts.push('Ask these qualification questions ONE AT A TIME, naturally woven into the conversation:');
    questions.forEach((q, i) => parts.push(`  ${i + 1}. ${q}`));
    parts.push('');
  }

  if (bp.bot_services_info) {
    parts.push('Information about our services (use this to answer customer questions):');
    parts.push(bp.bot_services_info);
    parts.push('');
  }

  if (bp.bot_good_lead_criteria) {
    parts.push('Signs of a great lead (customers who match these are a strong fit):');
    parts.push(bp.bot_good_lead_criteria);
    parts.push('');
  }

  if (bp.bot_bad_lead_criteria) {
    parts.push('Signs of a poor fit (these customers are unlikely to convert):');
    parts.push(bp.bot_bad_lead_criteria);
    parts.push('');
  }

  parts.push('Rules:');
  parts.push('- Always respond in the same language the customer uses (Hebrew or English)');
  parts.push('- Keep messages short and conversational — this is WhatsApp, not email');
  parts.push('- Ask only ONE question at a time');
  parts.push('- If the customer asks to speak to a human, or you cannot help, begin your reply ONLY with the exact token [HANDOFF]');
  parts.push('- When ALL qualification questions have been answered, output this on its own line BEFORE your closing message:');
  parts.push('  [LEAD_QUALIFIED score=<0-100>|name=<customer name or Unknown>|budget=<budget amount or Unknown>|service=<service needed>]');
  parts.push('  SCORING RULES (follow strictly):');
  parts.push('  - 85-100: Budget clearly meets good criteria AND no bad criteria matched. Use this range when the customer is a clear fit.');
  parts.push('  - 50-84: Budget is in range but customer refused to share some info. Max 5 point deduction per missing piece of info.');
  parts.push('  - 10-49: Budget is borderline or unclear.');
  parts.push('  - 0-9: Customer explicitly matches the bad criteria (e.g. stated budget is below the minimum threshold).');
  parts.push('  Do NOT give warm scores (40-79) just because info is missing. If budget criteria is met, default to 85.');
  parts.push('  After the token, send a warm closing message e.g. "Thanks! Our team will be in touch shortly."');

  return parts.join('\n');
}

async function handleIncomingMessage(msg: IncomingMessage): Promise<void> {
  // 4a. Find the MetaConnection for this destination ID
  const connection = await prisma.metaConnection.findFirst({
    where: msg.platform === 'whatsapp'
      ? { phone_number_id: msg.destinationId, is_active: true }
      : { page_id:         msg.destinationId, is_active: true },
    include: {
      agentConfigs: { where: { is_active: true }, take: 1 },
    },
  });

  if (!connection) {
    console.warn(`[Meta webhook] No active connection for ${msg.platform} ${msg.destinationId}`);
    return;
  }

  const agentConfig = connection.agentConfigs[0];
  if (!agentConfig) {
    console.warn(`[Meta webhook] No AI agent config for connection ${connection.id}`);
    return;
  }

  // 4b-extra. Load BusinessProfile for bot settings
  const businessProfile = connection.business_profile_id
    ? await prisma.businessProfile.findUnique({
        where: { id: connection.business_profile_id },
        select: {
          name: true, category: true, city: true,
          bot_enabled: true,
          bot_greeting: true,
          bot_qualification_questions: true,
          bot_good_lead_criteria: true,
          bot_bad_lead_criteria: true,
          bot_services_info: true,
          bot_working_hours_start: true,
          bot_working_hours_end: true,
          bot_off_hours_message: true,
        },
      })
    : null;

  // Stop if the bot has been disabled by the business owner
  if (businessProfile && businessProfile.bot_enabled === false) {
    console.log(`[Meta webhook] Bot disabled for business ${connection.business_profile_id}`);
    return;
  }

  // 4b. Decrypt access token (throws if tampered)
  const accessToken = decryptToken(connection.encrypted_token);

  // 4c. Working hours check — reply with off-hours message if outside window
  if (businessProfile?.bot_working_hours_start && businessProfile?.bot_working_hours_end) {
    const nowHour    = new Date().getHours();
    const startHour  = parseInt(businessProfile.bot_working_hours_start, 10);
    const endHour    = parseInt(businessProfile.bot_working_hours_end, 10);
    const inWindow   = nowHour >= startHour && nowHour < endHour;
    if (!inWindow && businessProfile.bot_off_hours_message) {
      await metaApi.sendTextMessage({
        platform:      msg.platform,
        recipientId:   msg.senderId,
        phoneNumberId: connection.phone_number_id ?? undefined,
        pageId:        connection.page_id ?? undefined,
        text:          businessProfile.bot_off_hours_message,
        accessToken,
      });
      return;
    }
  }

  // 5. Upsert conversation record — creates on first message, updates timestamp on subsequent
  const conversation = await prisma.conversation.upsert({
    where: {
      meta_connection_id_sender_id: {
        meta_connection_id: connection.id,
        sender_id:          msg.senderId,
      },
    },
    create: {
      meta_connection_id: connection.id,
      sender_id:          msg.senderId,
      platform:           msg.platform,
      status:             'active',
      context:            JSON.stringify([]),
      last_message_at:    new Date().toISOString(),
    },
    update: {
      last_message_at: new Date().toISOString(),
    },
  });

  // 6. Skip AI response if this thread was already escalated to a human
  if (conversation.status === 'human_handoff') {
    console.log(`[Meta webhook] Conversation ${conversation.id} in human handoff — skipping AI`);
    return;
  }

  // 7. Reconstruct context and append new user message
  const history: Array<{ role: string; content: string }> =
    JSON.parse(conversation.context ?? '[]');
  history.push({ role: 'user', content: msg.text });

  // 8. Call AI with dynamic prompt built from BusinessProfile settings
  const dynamicPrompt = businessProfile
    ? buildDynamicPrompt(businessProfile)
    : agentConfig.system_prompt;
  const aiResult = await runAgent(msg.text, history, { ...agentConfig, system_prompt: dynamicPrompt });

  // 9. Send AI reply
  await metaApi.sendTextMessage({
    platform:      msg.platform,
    recipientId:   msg.senderId,
    phoneNumberId: connection.phone_number_id ?? undefined,
    pageId:        connection.page_id ?? undefined,
    text:          aiResult.responseText,
    accessToken,
  });

  console.log(`[Meta webhook] Replied to ${msg.senderId} on ${msg.platform} (handoff=${aiResult.requiresHuman})`);

  // 10. Persist updated context (cap at 20 turns to avoid bloat)
  history.push({ role: 'assistant', content: aiResult.responseText });
  const trimmed = history.slice(-20);

  if (aiResult.requiresHuman) {
    // Create lead record if bot finished qualifying
    if (aiResult.leadQualified && aiResult.leadData) {
      await createLeadFromConversation({
        leadData:   aiResult.leadData,
        senderId:   msg.senderId,
        platform:   msg.platform,
        businessId: connection.business_profile_id,
        history:    trimmed,
      });
    }

    // Update conversation status and trigger handover
    await prisma.conversation.update({
      where: { id: conversation.id },
      data:  {
        status:         'human_handoff',
        handoff_reason: aiResult.handoffReason,
        context:        JSON.stringify(trimmed),
      },
    });

    // Messenger Handover Protocol — pass thread to the Page Inbox
    if (msg.platform === 'messenger') {
      await metaApi.passThreadControl({
        recipientPsid: msg.senderId,
        accessToken,
        metadata:      aiResult.handoffReason,
      });
    }
    // For WhatsApp, assign the conversation to a human via your WA Business dashboard
  } else {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data:  { context: JSON.stringify(trimmed) },
    });
  }
}

// ── Lead Creator ─────────────────────────────────────────────────────────────

async function createLeadFromConversation(opts: {
  leadData:   LeadData;
  senderId:   string;
  platform:   string;
  businessId: string | null;
  history:    Array<{ role: string; content: string }>;
}): Promise<void> {
  const { leadData, senderId, platform, businessId, history } = opts;

  const chatSummary = history
    .map(m => (m.role === 'user' ? 'Customer' : 'Bot') + ': ' + m.content)
    .join('\n');

  const scoreLabel = leadData.score >= 80 ? 'hot' : leadData.score >= 40 ? 'warm' : 'cold';

  await prisma.lead.create({
    data: {
      name:                  leadData.name,
      contact_info:          platform + ': ' + senderId,
      contact_phone:         platform === 'whatsapp' ? senderId : undefined,
      source:                'WhatsApp Bot',
      source_origin:         'bot',
      score:                 leadData.score,
      score_reasoning:       'Bot scored ' + leadData.score + '/100 - ' + scoreLabel + '. Budget: ' + leadData.budget + '. Service: ' + leadData.service + '.',
      service_needed:        leadData.service !== 'Unknown' ? leadData.service : undefined,
      budget_range:          leadData.budget !== 'Unknown' ? leadData.budget : undefined,
      status:                scoreLabel,
      lifecycle_stage:       'new',
      linked_business:       businessId ?? undefined,
      platform_sourced:      true,
      questionnaire_answers: chatSummary,
      discovered_at:         new Date().toISOString(),
      freshness_score:       100,
    },
  });

  console.log('[Meta webhook] Lead created - ' + leadData.name + ' score=' + leadData.score + ' (' + scoreLabel + ')');
}

// ── AI Agent Runner ───────────────────────────────────────────────────────────

interface LeadData {
  score:   number;
  name:    string;
  budget:  string;
  service: string;
}

interface AIResult {
  responseText:   string;
  requiresHuman:  boolean;
  handoffReason?: string;
  leadQualified?: boolean;
  leadData?:      LeadData;
}

async function runAgent(
  userMessage: string,
  history: Array<{ role: string; content: string }>,
  config: { agent_type: string; system_prompt: string; handoff_keywords: string | null; max_tokens: number }
): Promise<AIResult> {

  // Fast path: check for handoff keywords before spending an LLM call
  const keywords = (config.handoff_keywords ?? '')
    .split(',')
    .map(k => k.trim().toLowerCase())
    .filter(Boolean);

  const msgLower = userMessage.toLowerCase();
  const matched  = keywords.find(kw => msgLower.includes(kw));

  if (matched) {
    return {
      responseText:  'אני מעביר אותך לנציג אנושי שיוכל לעזור לך טוב יותר. 🙏',
      requiresHuman: true,
      handoffReason: `Handoff keyword matched: "${matched}"`,
    };
  }

  // Build the full prompt — system prompt + conversation history + new user message
  const historyText = history
    .slice(0, -1) // exclude the user message we just appended (already in userMessage)
    .map(m => `${m.role === 'user' ? 'Customer' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const prompt = [
    config.system_prompt,
    '',
    historyText.length > 0 ? `Conversation so far:\n${historyText}` : '',
    '',
    `Customer: ${userMessage}`,
    '',
    'If you cannot help and human intervention is needed, begin your reply ONLY with the exact token [HANDOFF] followed by your message.',
    'Assistant:',
  ].filter(line => line !== undefined).join('\n');

  const raw = await invokeLLM({ prompt });

  // invokeLLM may return a string or parsed JSON depending on the model call
  const responseText: string = typeof raw === 'string'
    ? raw
    : (raw as any)?.text ?? JSON.stringify(raw);

  const requiresHuman = responseText.trimStart().startsWith('[HANDOFF]');
  const cleanResponse = requiresHuman
    ? responseText.replace(/^\[HANDOFF\]\s*/i, '').trim()
    : responseText.trim();

  // Detect LEAD_QUALIFIED token and extract structured data
  const leadMatch = cleanResponse.match(/\[LEAD_QUALIFIED([^\]]+)\]/i);
  if (leadMatch) console.log('[Meta webhook] LEAD_QUALIFIED token:', leadMatch[0]);
  let leadData: LeadData | undefined;
  let finalResponse = cleanResponse;
  if (leadMatch) {
    const attrs = leadMatch[1];
    // Parse pipe-delimited key=value pairs: score=75|name=John|budget=1000|service=Web
    const pairs: Record<string, string> = {};
    attrs.trim().split('|').forEach(part => {
      const eq = part.indexOf('=');
      if (eq !== -1) pairs[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
    });
    const num = (key: string) => {
      const v = pairs[key];
      return v ? parseFloat(v) : 50;
    };
    const str = (key: string) => pairs[key] ?? 'Unknown';
    leadData = { score: num('score'), name: str('name'), budget: str('budget'), service: str('service') };
    finalResponse = cleanResponse.replace(/\[LEAD_QUALIFIED[^\]]+\]\s*/i, '').trim();
  }

  return {
    responseText:  finalResponse || cleanResponse,
    requiresHuman: requiresHuman || !!leadData,
    handoffReason: requiresHuman ? 'LLM requested human handoff'
                 : leadData      ? 'Lead qualified by bot'
                 : undefined,
    leadQualified: !!leadData,
    leadData,
  };
}

export default router;
