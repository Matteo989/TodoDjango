import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma. En développement, Next recharge les modules à chaque
 * modification: sans ce cache global, chaque rechargement ouvrirait un nouveau
 * pool de connexions jusqu'à saturer Postgres.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
