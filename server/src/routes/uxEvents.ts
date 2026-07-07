import { Router, Request, Response } from 'express';
import { prisma } from '../db';

const router = Router();

// POST /api/events/ux — receive UX tracking events from the frontend (KAN-88 AC5)
router.post('/', async (req: Request, res: Response) => {
  const { eventType, businessId, payload } = req.body;
  if (!eventType) return res.status(400).json({ error: 'eventType required' });

  await prisma.systemEvent.create({
    data: {
      business_id: businessId || 'anonymous',
      event_type:  eventType,
      source:      'frontend',
      payload:     payload ? JSON.stringify(payload) : null,
      routing_status: 'processed', // skip routing engine
    },
  }).catch(() => {}); // best-effort — never fail a user action for tracking

  res.json({ ok: true });
});

export default router;
