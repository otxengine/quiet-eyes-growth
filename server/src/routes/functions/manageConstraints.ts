/**
 * manageConstraints.ts — OTX-004
 * CRUD endpoints for business constraint rules.
 * GET  → return current constraints
 * POST → update constraints
 */

import { Request, Response } from 'express';
import { getConstraints, updateConstraints, ensureConstraints } from '../../lib/constraintValidator';

export async function getBusinessConstraints(req: Request, res: Response) {
  const { businessProfileId } = req.query as { businessProfileId: string };
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const constraints = await getConstraints(businessProfileId);
    return res.json({ constraints });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateBusinessConstraints(req: Request, res: Response) {
  const { businessProfileId, ...updates } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    await ensureConstraints(businessProfileId);
    const updated = await updateConstraints(businessProfileId, updates);
    return res.json({ success: true, constraints: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
