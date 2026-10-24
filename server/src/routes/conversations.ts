import { Router } from 'express';
import { prisma } from '../db';
import { getUserId } from '../middleware/auth';
import { requireOwnsRecord } from '../middleware/businessAccess';
import { getUserBusinessIds } from '../lib/ownership';

const router = Router();
const ownsConversation = requireOwnsRecord(async id =>
  (await prisma.conversation.findUnique({ where: { id }, select: { metaConnection: { select: { business_profile_id: true } } } }))
    ?.metaConnection.business_profile_id);

// GET /api/conversations/by-phone/:phone
// Returns the most recent bot conversation for a given WhatsApp sender ID
router.get('/by-phone/:phone', async (req, res) => {
  const { phone } = req.params;
  const userId = getUserId(req);
  if (!userId) return res.json(null);

  // Sender ids aren't unique across tenants: only search the caller's own Meta connections.
  const ownedIds = await getUserBusinessIds(userId);
  const conversation = await prisma.conversation.findFirst({
    where: { sender_id: phone, metaConnection: { business_profile_id: { in: ownedIds } } },
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
router.patch('/:id/reactivate', ownsConversation, async (req, res) => {
  const id = String(req.params.id);

  const conversation = await prisma.conversation.update({
    where: { id },
    data:  { status: 'active', context: JSON.stringify([]), handoff_reason: null },
  });

  return res.json({ ok: true, id: conversation.id });
});

export default router;