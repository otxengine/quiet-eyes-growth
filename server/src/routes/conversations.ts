import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

// GET /api/conversations/all/:businessId
// Returns all conversations for a business with lead status
router.get('/all/:businessId', async (req, res) => {
  const { businessId } = req.params;

  const rows = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      c.id,
      c.sender_id,
      c.platform,
      c.status,
      c.last_message_at,
      c.handoff_reason,
      c.context,
      l.id        AS lead_id,
      l.name      AS lead_name,
      l.status    AS lead_status
    FROM conversations c
    JOIN meta_connections mc ON mc.id = c.meta_connection_id
    LEFT JOIN leads l ON l.contact_phone = c.sender_id AND l.linked_business = $1
    WHERE mc.business_profile_id = $1
    ORDER BY c.last_message_at DESC
  `, businessId);

  const result = rows.map(r => {
    let lastMsg = '';
    try {
      const msgs = JSON.parse(r.context ?? '[]');
      const last = msgs[msgs.length - 1];
      lastMsg = last?.content?.slice(0, 80) || '';
    } catch {}
    return {
      id:              r.id,
      sender_id:       r.sender_id,
      platform:        r.platform,
      status:          r.status,
      last_message_at: r.last_message_at,
      handoff_reason:  r.handoff_reason,
      last_message:    lastMsg,
      lead_id:         r.lead_id   || null,
      lead_name:       r.lead_name || null,
      lead_status:     r.lead_status || null,
    };
  });

  return res.json(result);
});

// GET /api/conversations/by-phone/:phone
// Returns the most recent bot conversation for a given WhatsApp sender ID
router.get('/by-phone/:phone', async (req, res) => {
  const { phone } = req.params;

  const conversation = await prisma.conversation.findFirst({
    where: { sender_id: phone },
    orderBy: { last_message_at: 'desc' },
  });

  if (!conversation) return res.json(null);

  let rawMessages: Array<{ role: string; content: string }> = [];
  try { rawMessages = JSON.parse(conversation.context ?? '[]'); } catch {}

  const messages = rawMessages.map(m => ({
    role:    m.role === 'assistant' ? 'bot' : 'user',
    text:    m.content,
    time:    conversation.last_message_at,
  }));

  return res.json({
    id:              conversation.id,
    status:          conversation.status,
    human_takeover:  conversation.status === 'human_handoff',
    platform:        conversation.platform,
    last_message_at: conversation.last_message_at,
    handoff_reason:  conversation.handoff_reason,
    messages,
  });
});

// PATCH /api/conversations/:id/reactivate
// Resets bot — clears context and sets status back to active
router.patch('/:id/reactivate', async (req, res) => {
  const { id } = req.params;

  const conversation = await prisma.conversation.update({
    where: { id },
    data:  { status: 'active', context: JSON.stringify([]), handoff_reason: null },
  });

  return res.json({ ok: true, id: conversation.id });
});

export default router;