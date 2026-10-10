/**
 * Token 额度库集成测试(M22 批①;依赖 dev compose PG,不进 make check/CI)。
 * 覆盖:首见开户领全额、读幂等、实扣落流水、空扣不落、穿仓下限、admin 调整
 * 钳零、跨月惰性重置(reset+grant 双行)、并发实扣无丢失更新。
 * 前置:dev compose;测试自清理(用户级联删除钱包/流水)。
 */
import { loadEnvConfig } from "@next/env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

loadEnvConfig(process.cwd());
process.env.LOG_LEVEL = "silent";

import { prisma } from "@/lib/db";
import { statsMonth } from "@/lib/datetime";

const { TOKEN_MONTHLY_GRANT, adjustTokens, consumeTokens, getTokenWallet } =
  await import("./token-balance");

const USER_PHONE = "13900000018";
let userId = BigInt(0);

beforeAll(async () => {
  const user = await prisma.userAccount.upsert({
    where: { phone: USER_PHONE },
    update: {},
    create: { phone: USER_PHONE, nickname: "it-token-balance", role: "user", status: "active" },
  });
  userId = user.id;
  await prisma.userTokenLedger.deleteMany({ where: { userId } });
  await prisma.userTokenWallet.deleteMany({ where: { userId } });
});

afterAll(async () => {
  await prisma.userAccount.delete({ where: { id: userId } }).catch(() => undefined);
  await prisma.$disconnect();
});

async function ledgerRows() {
  return prisma.userTokenLedger.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

describe("token-balance(钱包开户/扣减/重置)", () => {
  it("首见开户领全额并落 grant 流水;重复读不再入账", async () => {
    const w = await getTokenWallet(userId);
    expect(w.balance).toBe(TOKEN_MONTHLY_GRANT);
    expect(w.periodKey).toBe(statsMonth());
    let rows = await ledgerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      delta: TOKEN_MONTHLY_GRANT,
      balanceAfter: TOKEN_MONTHLY_GRANT,
      reason: "grant",
    });

    await getTokenWallet(userId);
    rows = await ledgerRows();
    expect(rows).toHaveLength(1);
  });

  it("实扣落 consume 流水;amount=0 不落", async () => {
    const w = await consumeTokens(userId, 500, "thread-abc");
    expect(w.balance).toBe(TOKEN_MONTHLY_GRANT - 500);
    const rows = await ledgerRows();
    expect(rows.at(-1)).toMatchObject({
      delta: -500,
      balanceAfter: TOKEN_MONTHLY_GRANT - 500,
      reason: "consume",
      sessionId: "thread-abc",
    });

    const before = (await ledgerRows()).length;
    await consumeTokens(userId, 0);
    expect((await ledgerRows()).length).toBe(before);
  });

  it("实扣允许微穿仓(余额可为负,流水记真实下限)", async () => {
    await prisma.userTokenWallet.update({ where: { userId }, data: { balance: 10 } });
    const w = await consumeTokens(userId, 100, "thread-over");
    expect(w.balance).toBe(-90);
    expect((await ledgerRows()).at(-1)).toMatchObject({
      delta: -100,
      balanceAfter: -90,
      reason: "consume",
    });
  });

  it("admin 调整:负向钳零生效,流水记实际 delta", async () => {
    await prisma.userTokenWallet.update({ where: { userId }, data: { balance: 300 } });
    const w = await adjustTokens(userId, -1000, "纠错回冲");
    expect(w.balance).toBe(0);
    expect((await ledgerRows()).at(-1)).toMatchObject({
      delta: -300,
      balanceAfter: 0,
      reason: "adjust",
      note: "纠错回冲",
    });

    const w2 = await adjustTokens(userId, 2500);
    expect(w2.balance).toBe(2500);
  });

  it("跨月惰性重置:上月余量回收 + 重新发放(reset+grant 双行)", async () => {
    const [y, m] = statsMonth().split("-").map(Number);
    const prevKey = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    await prisma.$executeRaw`UPDATE "user_token_wallet" SET "period_key" = ${prevKey}, "balance" = 123 WHERE "user_id" = ${userId}`;

    const w = await getTokenWallet(userId);
    expect(w.balance).toBe(TOKEN_MONTHLY_GRANT);
    expect(w.periodKey).toBe(statsMonth());
    const rows = await ledgerRows();
    expect(rows.slice(-2)).toMatchObject([
      { delta: -123, balanceAfter: 0, reason: "reset" },
      { delta: TOKEN_MONTHLY_GRANT, balanceAfter: TOKEN_MONTHLY_GRANT, reason: "grant" },
    ]);
  });

  it("并发实扣无丢失更新:5×1000 恰好扣足", async () => {
    await prisma.userTokenWallet.update({ where: { userId }, data: { balance: 10_000 } });
    await Promise.all(Array.from({ length: 5 }, (_, i) => consumeTokens(userId, 1000, `cc-${i}`)));
    const w = await getTokenWallet(userId);
    expect(w.balance).toBe(5_000);
    const consumeRows = (await ledgerRows()).filter((r) => r.reason === "consume");
    expect(consumeRows.filter((r) => r.sessionId?.startsWith("cc-"))).toHaveLength(5);
  });
});
