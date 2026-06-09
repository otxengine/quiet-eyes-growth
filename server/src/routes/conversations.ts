import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

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