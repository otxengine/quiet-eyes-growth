import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

// Singleton in all envs — prevents pool exhaustion when modules are re-evaluated
if (!globalForPrisma.prisma) {
  const url = process.env.DATABASE_URL;
  const connUrl = url
    ? url + (url.includes('?') ? '&' : '?') + 'connection_limit=3&pool_timeout=10'
    : undefined;

  globalForPrisma.prisma = new PrismaClient({
    log: ['error'],
    datasources: connUrl ? { db: { url: connUrl } } : undefined,
  });
}

export const prisma = globalForPrisma.prisma;
