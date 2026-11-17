/**
 * 会话表集成测试(2026-11-17 列宽回归闸;依赖 dev compose PG,不进 make check/CI)。
 *
 * **背景**:会话 id 有两种形态——成员 = uuid(36),游客 = `g_<uuid>`(38,kind 标记
 * 前缀)。列宽曾按 uuid 的 36 定,于是**游客行 upsert 必然超长失败**,写库被
 * 吞成一条 warn:后台「会话管理」的游客行从来没进过库、#274 的访客标识(uuid)
 * 没生效、游客的 tokens_total 累计也不落库(会话累计闸对游客实际不生效)。
 *
 * 本测试直接钉三件事:
 * ①列宽容得下最长 id 形态(38);
 * ②FK 对侧 `user_token_ledger.session_id` 同宽(Prisma relation 要求两侧
 *   native type 一致,不等宽则建不了 relation);
 * ③游客会话行真能落库,且访客标识/标题/tokens 累计都写进去(走真 prisma——
 *   `touchGuestSessionAfterRun` 内部 catch 只告警,不断言行存在就测不出)。
 *
 * 前置:dev compose;测试自清理(按本测试造的 thread id 删行)。
 */
import { loadEnvConfig } from "@next/env";
import { afterAll, describe, expect, it } from "vitest";

loadEnvConfig(process.cwd());
process.env.LOG_LEVEL = "silent";

import { prisma } from "@/lib/db";

const { touchGuestSessionAfterRun } = await import("./sessions");

/** 游客线程 id 的实际形态(guest-threads.ts 的 `g_`+uuid) */
const GUEST_PREFIX = "g_";
const GUEST_ID_LEN = GUEST_PREFIX.length + 36; // 38

const threadIds: string[] = [];

function guestThreadId(): string {
  const id = `${GUEST_PREFIX}${crypto.randomUUID()}`;
  threadIds.push(id);
  return id;
}

/** 列宽直查 information_schema(不靠 prisma 的类型推断) */
async function columnWidth(table: string, column: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ character_maximum_length: number }[]>`
    SELECT character_maximum_length FROM information_schema.columns
    WHERE table_name = ${table} AND column_name = ${column}
  `;
  return rows[0]?.character_maximum_length ?? 0;
}

afterAll(async () => {
  await prisma.searchAgentSession
    .deleteMany({ where: { id: { in: threadIds } } })
    .catch(() => undefined);
  await prisma.$disconnect();
});

describe("会话表列宽(游客 id 38 字符回归闸)", () => {
  it("search_agent_session.id 列宽容得下游客 id 形态(≥38)", async () => {
    expect(await columnWidth("search_agent_session", "id")).toBeGreaterThanOrEqual(GUEST_ID_LEN);
  });

  it("FK 对侧 user_token_ledger.session_id 同宽(relation 要求两侧 native type 一致)", async () => {
    const idWidth = await columnWidth("search_agent_session", "id");
    expect(await columnWidth("user_token_ledger", "session_id")).toBe(idWidth);
  });

  it("游客会话行真能落库:访客标识/标题/tokens 累计都写进去", async () => {
    const threadId = guestThreadId();
    const visitorId = crypto.randomUUID();
    await touchGuestSessionAfterRun(threadId, "AI 编程工具怎么选", 2020, visitorId);
    const row = await prisma.searchAgentSession.findUnique({ where: { id: threadId } });
    expect(row).not.toBeNull();
    expect(row?.visitorId).toBe(visitorId);
    expect(row?.title).toBe("AI 编程工具怎么选");
    expect(row?.tokensTotal).toBe(2020);
    // 二次 touch:upsert 命中既有行 → tokens 累计而非覆盖
    await touchGuestSessionAfterRun(threadId, null, 30, visitorId);
    const again = await prisma.searchAgentSession.findUnique({ where: { id: threadId } });
    expect(again?.tokensTotal).toBe(2050);
  });
});
