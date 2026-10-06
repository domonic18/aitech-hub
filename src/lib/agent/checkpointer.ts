/**
 * LangGraph checkpoint 持久化(K2.5,arch/04 §3.3):PostgresSaver 复用生产 PG,
 * checkpoint 表框架 setup() 幂等自管——不进 Prisma migrations(arch/03 边界,
 * ai-invest 先例:checkpoint 表不进 Alembic)。pg Pool 独立小池(max 3,生产
 * PG max_connections=20,Prisma 已占大头);进程级单例,懒加载——构建期不触达
 * DB(prerenderSafe 同款纪律),仅 force-dynamic 路由与 worker boot 实例化。
 */
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";

import { env } from "../env";
import { logger } from "../logger";

const globalForAgent = globalThis as unknown as {
  agentPgPool?: pg.Pool;
  agentCheckpointer?: PostgresSaver;
  agentSetupPromise?: Promise<void>;
};

const POOL_MAX = 3;

/** pg Pool 单例(dev 热更防重建,同 prisma/db.ts 口径) */
export function getAgentPgPool(): pg.Pool {
  const existing = globalForAgent.agentPgPool;
  if (existing) return existing;
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", (e) => {
    logger.warn({ event: "agent.checkpoint_pool_error", error: e.message });
  });
  globalForAgent.agentPgPool = pool;
  return pool;
}

/** PostgresSaver 单例(不自动 setup;调用方拿到手先 ensureAgentCheckpointer) */
export function getAgentCheckpointer(): PostgresSaver {
  globalForAgent.agentCheckpointer ??= new PostgresSaver(getAgentPgPool());
  return globalForAgent.agentCheckpointer;
}

/**
 * setup() 幂等守卫:建 checkpoint 表框架(DDL 框架自管),进程内一次;
 * 并发调用共享同一 Promise(首次请求并发与 worker boot 双保险)。
 */
export function ensureAgentCheckpointer(): Promise<void> {
  globalForAgent.agentSetupPromise ??= (async () => {
    const saver = getAgentCheckpointer();
    await saver.setup();
    logger.info({ event: "agent.checkpoint_setup_ok" });
  })().catch((e: unknown) => {
    // 失败清守卫允许重试(如构建期 PG 不可达);下次调用重建
    globalForAgent.agentSetupPromise = undefined;
    throw e;
  });
  return globalForAgent.agentSetupPromise;
}
