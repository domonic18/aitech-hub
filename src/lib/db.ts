import { PrismaClient } from "@prisma/client";

/**
 * Prisma client 单例(arch/03-data-model §3):全仓唯一实例,禁止 new PrismaClient。
 * dev 环境 globalThis 缓存,防 next dev 热更时每次重载新建连接池。
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
