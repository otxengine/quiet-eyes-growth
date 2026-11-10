/**
 * Delivery of the competitor report to the customer: who receives it, and the unsubscribe link every
 * customer email must carry. Recipients are business_profiles.report_recipients (comma-separated,
 * a raw-SQL column — index.ts); NULL or empty means customer delivery is off for that business.
 */
import crypto from 'crypto';
import { prisma } from '../db';

const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/** Lower-cased, de-duplicated addresses; anything that is not an address is dropped. */
export function parseRecipients(raw?: string | null): string[] {
  return [...new Set((raw ?? '').split(',').map(s => s.trim().toLowerCase()).filter(s => EMAIL_RE.test(s)))];
}

export async function customerRecipients(bpId: string): Promise<string[]> {
  try {
    const rows = await prisma.$queryRaw<{ report_recipients: string | null }[]>`
      SELECT report_recipients FROM business_profiles WHERE id = ${bpId}`;
    return parseRecipients(rows[0]?.report_recipients);
  } catch (e: any) {
    console.warn('[reportDelivery] recipients lookup failed:', e.message);
    return [];
  }
}

const secret = () => process.env.REPORT_UNSUBSCRIBE_SECRET || '';
/** Stands in for the address in the link, so no email address ends up in a URL or an access log. */
const recipientId = (email: string) => crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
const sign = (bpId: string, rid: string) => crypto.createHmac('sha256', secret()).update(`${bpId}\n${rid}`).digest('base64url');

/**
 * One-click unsubscribe link for one recipient of one business. Null when the signing secret or the
 * public URL is not configured — callers must then not email the customer at all.
 */
export function unsubscribeUrl(bpId: string, email: string): string | null {
  const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  if (!secret() || !base) return null;
  const rid = recipientId(email);
  return `${base}/api/reports/unsubscribe?b=${encodeURIComponent(bpId)}&r=${rid}&t=${sign(bpId, rid)}`;
}

/** Removes the recipient the link was issued for. False for a bad or unsigned link. */
export async function unsubscribe(bpId: string, rid: string, token: string): Promise<boolean> {
  if (!secret() || !bpId || !rid || !token) return false;
  const given = Buffer.from(token);
  const expected = Buffer.from(sign(bpId, rid));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
  const left = (await customerRecipients(bpId)).filter(e => recipientId(e) !== rid);
  await prisma.$executeRaw`UPDATE business_profiles SET report_recipients = ${left.join(',') || null} WHERE id = ${bpId}`;
  return true;
}
