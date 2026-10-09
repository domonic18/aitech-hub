/**
 * 用户 Token 额度库(M22 批①,免费额度制,用户拍板 2026-10-09):注册/首读
 * 惰性开户领月赠额;月度重置走 periodKey 读时惰性判定(免 cron);Agent 会话
 * run 前预检(>0 放行)、run 结束按实际用量实扣(允许微穿仓,单轮 50k 护栏
 * 为穿仓下限);admin 人工调整(余量钳 ≥0)。
 * 纪律:钱包表一切变更只经本模块——事务 + SELECT FOR UPDATE 行锁串行化
 * (防并发扣穿/丢失更新),流水 append-only 与余额变更同事务落账。
 */
import { Prisma } from "@prisma/client";

import { statsMonth } from "../datetime";
import { prisma } from "../db";
import { logger } from "../logger";

type Tx = Prisma.TransactionClient;

/** 月度免费额度(tokens):开户与每月重置同额(2026-10-09 方案定稿) */
export const TOKEN_MONTHLY_GRANT = 200_000;

/** 流水 reason(应用层枚举,同 role/status 纪律) */
export const TOKEN_LEDGER_REASONS = ["grant", "consume", "reset", "adjust"] as const;
export type TokenLedgerReason = (typeof TOKEN_LEDGER_REASONS)[number];

export interface TokenWalletView {
  balance: number;
  periodKey: string;
}

interface WalletRow {
  balance: number;
  period_key: string;
}

/** 行锁读钱包(不存在返回 null);仅在交互事务内调用 */
async function lockWallet(tx: Tx, userId: bigint): Promise<WalletRow | null> {
  const rows = await tx.$queryRaw<WalletRow[]>`
    SELECT balance, period_key FROM "user_token_wallet" WHERE "user_id" = ${userId} FOR UPDATE`;
  return rows[0] ?? null;
}

/**
 * 事务内惰性保障:开户(领全额)或跨月重置(回收上月余量 + 重新发放)。
 * 开发竞态:并发首开双插撞 PK,败方走重读(胜者已按当月开户,无须重置)。
 */
async function ensureWalletInTx(tx: Tx, userId: bigint): Promise<TokenWalletView> {
  const periodKey = statsMonth();
  const existing = await lockWallet(tx, userId);
  if (!existing) {
    try {
      await tx.userTokenWallet.create({
        data: { userId, balance: TOKEN_MONTHLY_GRANT, periodKey },
      });
      await tx.userTokenLedger.create({
        data: {
          userId,
          delta: TOKEN_MONTHLY_GRANT,
          balanceAfter: TOKEN_MONTHLY_GRANT,
          reason: "grant",
        },
      });
      return { balance: TOKEN_MONTHLY_GRANT, periodKey };
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
      const raced = await lockWallet(tx, userId);
      if (raced) return { balance: raced.balance, periodKey: raced.period_key };
      throw e;
    }
  }
  if (existing.period_key !== periodKey) {
    const stale = existing.balance;
    await tx.userTokenWallet.update({
      where: { userId },
      data: { balance: TOKEN_MONTHLY_GRANT, periodKey },
    });
    if (stale !== 0) {
      await tx.userTokenLedger.create({
        data: { userId, delta: -stale, balanceAfter: 0, reason: "reset" },
      });
    }
    await tx.userTokenLedger.create({
      data: {
        userId,
        delta: TOKEN_MONTHLY_GRANT,
        balanceAfter: TOKEN_MONTHLY_GRANT,
        reason: "grant",
      },
    });
    logger.info({ event: "token_wallet.monthly_reset", userId: userId.toString(), stale });
    return { balance: TOKEN_MONTHLY_GRANT, periodKey };
  }
  return { balance: existing.balance, periodKey: existing.period_key };
}

/** 读余额(读时惰性:首见开户 / 跨月重置) */
export async function getTokenWallet(userId: bigint): Promise<TokenWalletView> {
  return prisma.$transaction((tx) => ensureWalletInTx(tx, userId));
}

/** run 前预检:余额 >0 才放行(扣减在 run 后按实际用量,见 consumeTokens) */
export async function hasTokenBalance(userId: bigint): Promise<boolean> {
  return (await getTokenWallet(userId)).balance > 0;
}

/**
 * run 后实扣(tokensIn+tokensOut):允许微穿仓(预检已挡 0,单轮 ≤50k 护栏
 * 即穿仓下限);amount≤0 不落流水(空 run 无消耗)。钱包缺失(理论上预检已
 * 开户,防御)时事务内先走开户再扣。失败向上抛——扣减失败属计费异常,调用方
 * 告警但不反噬已完成的 run(usage-log 同款口径,由调用侧决定吞否)。
 */
export async function consumeTokens(
  userId: bigint,
  amount: number,
  sessionId?: string,
): Promise<TokenWalletView> {
  const deducted = Math.max(0, Math.round(amount));
  return prisma.$transaction(async (tx) => {
    const wallet = await ensureWalletInTx(tx, userId);
    if (deducted === 0) return wallet;
    const balance = wallet.balance - deducted;
    await tx.userTokenWallet.update({ where: { userId }, data: { balance } });
    await tx.userTokenLedger.create({
      data: { userId, delta: -deducted, balanceAfter: balance, reason: "consume", sessionId },
    });
    return { balance, periodKey: wallet.periodKey };
  });
}

/** admin 人工调整(正充负扣):余量钳 ≥0,流水记实际生效 delta(审计对账锚) */
export async function adjustTokens(
  userId: bigint,
  delta: number,
  note?: string,
): Promise<TokenWalletView> {
  return prisma.$transaction(async (tx) => {
    const wallet = await ensureWalletInTx(tx, userId);
    const applied = Math.trunc(delta);
    const balance = Math.max(0, wallet.balance + applied);
    await tx.userTokenWallet.update({ where: { userId }, data: { balance } });
    await tx.userTokenLedger.create({
      data: {
        userId,
        delta: balance - wallet.balance,
        balanceAfter: balance,
        reason: "adjust",
        note,
      },
    });
    return { balance, periodKey: wallet.periodKey };
  });
}
