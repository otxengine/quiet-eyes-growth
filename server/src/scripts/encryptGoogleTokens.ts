/**
 * One-time backfill: encrypt Google refresh/access tokens that were stored in
 * plaintext before B2 (GBP_AUDIT.md). Encrypts in place, skipping any value
 * already in encryptToken()'s iv:tag:ciphertext format so it's safe to re-run.
 *
 * Run once, against production env (DATABASE_URL/DIRECT_URL + META_ENCRYPTION_KEY set):
 *   npx ts-node src/scripts/encryptGoogleTokens.ts
 */
import { prisma } from '../db';
import { encryptToken, isEncryptedToken } from '../lib/crypto';

async function main() {
  let socialAccountsUpdated = 0;
  const accounts = await prisma.socialAccount.findMany({
    where: { platform: { in: ['google_business', 'google_ads'] } },
  });
  for (const acct of accounts) {
    const data: { access_token?: string; refresh_token?: string } = {};
    if (acct.access_token && !isEncryptedToken(acct.access_token)) {
      data.access_token = encryptToken(acct.access_token);
    }
    if (acct.refresh_token && !isEncryptedToken(acct.refresh_token)) {
      data.refresh_token = encryptToken(acct.refresh_token);
    }
    if (Object.keys(data).length > 0) {
      await prisma.socialAccount.update({ where: { id: acct.id }, data });
      socialAccountsUpdated++;
    }
  }

  let profilesUpdated = 0;
  const profiles = await prisma.businessProfile.findMany({
    where: { google_access_token: { not: null } },
    select: { id: true, google_access_token: true },
  });
  for (const p of profiles) {
    if (p.google_access_token && !isEncryptedToken(p.google_access_token)) {
      await prisma.businessProfile.update({
        where: { id: p.id },
        data: { google_access_token: encryptToken(p.google_access_token) },
      });
      profilesUpdated++;
    }
  }

  console.log(`Encrypted ${socialAccountsUpdated} social_accounts row(s), ${profilesUpdated} business_profiles row(s).`);
}

main().finally(() => prisma.$disconnect());
