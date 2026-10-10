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

/** 删线程 checkpoint(用户删会话/30 天日清共用;须先 ensure) */
export async function deleteThread(threadId: string): Promise<void> {
  await ensureAgentCheckpointer();
  await getAgentCheckpointer().deleteThread(threadId);
}

/** 前端中断态水合契约(assistant-ui LangGraphInterruptState 的结构子集)。 */
export interface ThreadInterruptState {
  value?: unknown;
  resumable?: boolean;
  when?: string;
  ns?: string[];
}

/** state 路由水合视图(单次 getTuple 同时取消息轨迹与挂起中断)。 */
export interface ThreadStateView {
  /** 消息轨迹(channel_values.messages;无线程为 null) */
  messages: unknown[] | null;
  /** 挂起中断(assistant-ui LangGraphInterruptState 结构子集;无中断为空) */
  interrupts: ThreadInterruptState[];
}

/**
 * 读线程消息轨迹(state 路由:切线程恢复历史)。走 saver.getTuple 公开 API
 * (DeepAgent.getState 为 private);channel_values.messages 经 serde 反序列化
 * 为 BaseMessage 实例。无线程返回 messages=null。
 */
export async function getThreadMessages(threadId: string): Promise<unknown[] | null> {
  return (await getThreadState(threadId)).messages;
}

/**
 * 读线程 state 视图(消息 + 挂起中断,单次 getTuple)。interrupt 以
 * `__interrupt__` 通道的 pending write 持久化,getTuple 已 serde 反序列化
 * (Interrupt 实例),此处窄化为 SDK 水合结构;非对象/缺损项丢弃(前端落
 * 通用兜底卡,见 parseAgentAskUserInterrupt)。无中断返回空数组。
 */
export async function getThreadState(threadId: string): Promise<ThreadStateView> {
  await ensureAgentCheckpointer();
  const tuple = await getAgentCheckpointer().getTuple({
    configurable: { thread_id: threadId },
  });
  const messages = (tuple?.checkpoint.channel_values as { messages?: unknown } | undefined)
    ?.messages;
  const writes = tuple?.pendingWrites ?? [];
  const interrupts: ThreadInterruptState[] = [];
  for (const write of writes) {
    const [, channel, raw] = write as [string, string, unknown];
    if (channel !== "__interrupt__" || typeof raw !== "object" || raw === null) continue;
    // Interrupt 实例(value=工具 interrupt() 载荷)与实例数组两种形状都收
    const items = Array.isArray(raw) ? raw : [raw];
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const it = item as { value?: unknown; resumable?: unknown; when?: unknown; ns?: unknown };
      interrupts.push({
        ...(it.value !== undefined ? { value: it.value } : {}),
        ...(typeof it.resumable === "boolean" ? { resumable: it.resumable } : {}),
        ...(typeof it.when === "string" ? { when: it.when } : {}),
        ...(Array.isArray(it.ns)
          ? { ns: it.ns.filter((n): n is string => typeof n === "string") }
          : {}),
      });
    }
  }
  return { messages: Array.isArray(messages) ? messages : null, interrupts };
}
