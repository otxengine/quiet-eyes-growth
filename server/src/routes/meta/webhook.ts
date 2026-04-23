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
  // 1. Verify signature using the raw body captured before JSON parsing
  const rawBody   = (req as any).rawBody as Buffer | undefined;
  const signature = req.headers['x-hub-signature-256'] as string ?? '';

  if (!rawBody || !verifyMetaSignature(rawBody, signature)) {
    console.warn('[Meta webhook] Invalid signature — rejecting payload');
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

  // 4b. Decrypt access token (throws if tampered)
  const accessToken = decryptToken(connection.encrypted_token);

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

  // 8. Call AI
  const aiResult = await runAgent(msg.text, history, agentConfig);

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

// ── AI Agent Runner ───────────────────────────────────────────────────────────

interface AIResult {
  responseText:   string;
  requiresHuman:  boolean;
  handoffReason?: string;
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

  return {
    responseText:  cleanResponse,
    requiresHuman,
    handoffReason: requiresHuman ? 'LLM requested human handoff' : undefined,
  };
}

export default router;
