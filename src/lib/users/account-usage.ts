/**
 * 账号中心消耗页读侧(M22 批③,需求5):钱包余额卡(token-balance 惰性
 * 开户/重置)+ 本月消耗统计(ai_usage_log by userId,费用读时按牌价现折算,
 * costOfRow 复用 admin 看板口径)+ 流水分页(UserTokenLedger append-only)。
 * 月界北京时(statsMonth 口径),ASR/生图行无 userId 不入个人统计。
 */
import { prisma } from "@/lib/db";
import { statsMonth } from "@/lib/datetime";
import { TOKEN_LEDGER_REASONS, TOKEN_MONTHLY_GRANT } from "@/lib/users/token-balance";

import { costOfRow, type UsagePrices } from "@/lib/ai/usage-queries";

export const TOKEN_LEDGER_PAGE_SIZE = 15;

export interface TokenLedgerRow {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  note: string | null;
  sessionId: string | null;
  createdAt: string;
}

export async function listTokenLedger(
  userId: bigint,
  page: number,
): Promise<{ items: TokenLedgerRow[]; total: number; page: number }> {
  const where = { userId };
  const [rows, total] = await Promise.all([
    prisma.userTokenLedger.findMany({
      where,
      select: {
        id: true,
        delta: true,
        balanceAfter: true,
        reason: true,
        note: true,
        sessionId: true,
        createdAt: true,
      },
      orderBy: { id: "desc" },
      skip: (page - 1) * TOKEN_LEDGER_PAGE_SIZE,
      take: TOKEN_LEDGER_PAGE_SIZE,
    }),
    prisma.userTokenLedger.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id.toString(),
      delta: r.delta,
      balanceAfter: r.balanceAfter,
      reason: r.reason,
      note: r.note,
      sessionId: r.sessionId,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    page,
  };
}

export interface MonthUsageSummary {
  periodKey: string;
  monthStart: Date;
  calls: number;
  tokens: number;
  cost: number;
}

/** 纯聚合(单测锚点):本月台账行 + 牌价 → 次数/tokens/费用(¥,costOfRow 口径) */
export function summarizeMonthUsage(
  rows: Array<{
    role: string;
    modelId: number | null;
    modelKey: string;
    tokensIn: number;
    tokensOut: number;
    audioSeconds: number;
    status: string;
  }>,
  prices: UsagePrices,
): { calls: number; tokens: number; cost: number } {
  let calls = 0;
  let tokens = 0;
  let cost = 0;
  for (const r of rows) {
    calls += 1;
    tokens += r.tokensIn + r.tokensOut;
    cost += costOfRow({ ...r, createdAt: new Date(0) }, prices);
  }
  return { calls, tokens, cost };
}

/** 本月消耗统计(RSC 消费):userId 过滤 + 月初起点 + 牌价快照 */
export async function getMonthUsage(userId: bigint): Promise<MonthUsageSummary> {
  const periodKey = statsMonth();
  const monthStart = new Date(Date.parse(`${periodKey}-01T00:00:00+08:00`));
  const [rows, models, asr] = await Promise.all([
    prisma.aiUsageLog.findMany({
      where: { userId, createdAt: { gte: monthStart } },
      select: {
        role: true,
        modelId: true,
        modelKey: true,
        tokensIn: true,
        tokensOut: true,
        audioSeconds: true,
        status: true,
      },
    }),
    prisma.aiModel.findMany({
      select: { id: true, priceIn: true, priceOut: true, pricePerImage: true },
    }),
    prisma.asrConfig.findFirst({ select: { pricePerHour: true } }),
  ]);
  const prices: UsagePrices = {
    models: new Map(
      models.map((m) => [
        m.id,
        { priceIn: m.priceIn, priceOut: m.priceOut, pricePerImage: m.pricePerImage },
      ]),
    ),
    asrPricePerHour: asr?.pricePerHour ?? null,
  };
  return {
    periodKey,
    monthStart,
    ...summarizeMonthUsage(rows, prices),
  };
}

/** 流水 reason 中文标签(应用层枚举白名单,非白名单原样回显) */
export const TOKEN_LEDGER_LABELS: Record<string, string> = {
  grant: "月度赠额",
  consume: "消耗",
  reset: "月度重置",
  adjust: "人工调整",
};

export { TOKEN_LEDGER_REASONS, TOKEN_MONTHLY_GRANT };
