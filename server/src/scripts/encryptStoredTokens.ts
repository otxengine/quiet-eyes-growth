/**
 * Backfill: encrypt every OAuth token still stored in plaintext, in place. Values already in
 * encryptToken()'s iv:tag:ciphertext format are skipped, and each write only lands if the
 * column still holds the value read, so it is safe to re-run and to race a reconnect.
 *
 * Runs at every boot (index.ts) against the task's own DATABASE_URL, since lib/crypto no longer
 * reads plaintext tokens. After restoring data into a running environment's RDS, restart the API
 * (aws ecs update-service --force-new-deployment) or run once in the image:
 *   node dist/scripts/encryptStoredTokens.js
 */
import { prisma } from '../db';
import { encryptToken, isEncryptedToken } from '../lib/crypto';

const TOKEN_COLUMNS: Record<string, string[]> = {
  socialAccount:   ['access_token', 'refresh_token'],
  businessProfile: ['whatsapp_access_token', 'google_access_token', 'instagram_access_token', 'facebook_page_token'],
};

/** Returns how many values it encrypted. */
export async function encryptStoredTokens(): Promise<number> {
  let encrypted = 0;
  for (const [model, columns] of Object.entries(TOKEN_COLUMNS)) {
    const delegate = (prisma as any)[model];
    for (const col of columns) {
      const rows: any[] = await delegate.findMany({ where: { [col]: { not: null } }, select: { id: true, [col]: true } });
      for (const row of rows) {
        const value = row[col];
        if (!value || isEncryptedToken(value)) continue;
        const { count } = await delegate.updateMany({ where: { id: row.id, [col]: value }, data: { [col]: encryptToken(value) } });
        encrypted += count;
      }
    }
  }
  return encrypted;
}

if (require.main === module) {
  encryptStoredTokens()
    .then(n => console.log(`Encrypted ${n} plaintext token value(s).`))
    .finally(() => prisma.$disconnect());
}
