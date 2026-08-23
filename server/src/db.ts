import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

// Singleton in all envs — prevents pool exhaustion when modules are re-evaluated
if (!globalForPrisma.prisma) {
  const url = process.env.DATABASE_URL;
  // ponytail: paired with CONCURRENCY in scheduler.ts — raise/lower together, not independently.
  // Watch Render logs for pool_timeout / Prisma P2024 after changing; back off to 3 if seen.
  const connUrl = url
    ? url + (url.includes('?') ? '&' : '?') + 'connection_limit=8&pool_timeout=10'
    : undefined;

  globalForPrisma.prisma = new PrismaClient({
    log: ['error'],
    datasources: connUrl ? { db: { url: connUrl } } : undefined,
  });
}

export const prisma = globalForPrisma.prisma;
