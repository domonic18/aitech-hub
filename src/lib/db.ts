import { PrismaClient } from "@prisma/client";

import { env } from "./env";

/**
 * Prisma client 单例(arch/03-data-model §3):全仓唯一实例,禁止 new PrismaClient。
 * dev 环境 globalThis 缓存,防 next dev 热更时每次重载新建连接池。
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Prisma 唯一约束冲突判定(P2002;发布 API slug 并发、采集去重并发共用) */
export function isP2002(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/** PG 连通探针(F20 依赖条;service 层唯一 $queryRaw 口,M48 批F 下沉) */
export async function pingDb(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

/** 分批删除(M48 批F):批取 id → in 删除循环至清——Prisma deleteMany 无 take,
 * 大保留窗口的单条 deleteMany 在 statement_timeout=30s 下会被掐死,且日清 job
 * attempts=1 当日不重试、次日窗口更大自增强失败(与 agent/purge.ts 同款手法) */
export async function deleteBatchedWhere(
  delegate: {
    findMany: (args: never) => Promise<unknown>;
    deleteMany: (args: never) => Promise<unknown>;
  },
  where: unknown,
  batch = 500,
): Promise<number> {
  let removed = 0;
  for (;;) {
    const rows = (await delegate.findMany({
      where,
      select: { id: true },
      take: batch,
    } as never)) as Array<{ id: bigint | number | string }>;
    if (rows.length === 0) return removed;
    await delegate.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } } as never);
    removed += rows.length;
    if (rows.length < batch) return removed;
  }
}
