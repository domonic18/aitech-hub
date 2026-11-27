/**
 * AI 智能指数:数据库读侧
 * 从 ai_index_daily 读取每日指数,供首页卡片与 /ai-index 看板使用。
 *
 * 构建期无 DB(CI/镜像构建),取数经 prerenderSafe 降级为空数据(arch/07-frontend §1);
 * 运行时错误照常上抛,不静默返空。
 */
import { prisma } from "@/lib/db";
import { prerenderSafe } from "@/lib/prerender-safe";
import { AI_INDEX_CARD_DAYS, AI_INDEX_SERIES_DEFAULT_DAYS, ECI_STALE_DAYS } from "./constants";

export interface AiIndexDailyRow {
  date: string; // YYYY-MM-DD
  capability: number | null;
  velocity: number;
  acceleration: number;
  intelligenceIndex: number;
  eventCount: number;
  topEvents: unknown;
  dimensions: unknown;
}

function toRow(r: {
  date: Date;
  capability: number | null;
  velocity: number;
  acceleration: number;
  intelligenceIndex: number;
  eventCount: number;
  topEvents: unknown;
  dimensions: unknown;
}): AiIndexDailyRow {
  return {
    date: r.date.toISOString().slice(0, 10),
    capability: r.capability,
    velocity: r.velocity,
    acceleration: r.acceleration,
    intelligenceIndex: r.intelligenceIndex,
    eventCount: r.eventCount,
    topEvents: r.topEvents,
    dimensions: r.dimensions,
  };
}

/** 最近 N 天的指数序列 */
export async function listAiIndexDaily(
  days = AI_INDEX_SERIES_DEFAULT_DAYS,
): Promise<AiIndexDailyRow[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  return prerenderSafe("ai_index.list", [], async () => {
    const rows = await prisma.aiIndexDaily.findMany({
      where: { date: { gte: since } },
      orderBy: { date: "asc" },
    });
    return rows.map(toRow);
  });
}

/** 首页卡片:最近若干天 + 最新一条 */
export async function getAiIndexCardData(): Promise<{
  recent: AiIndexDailyRow[];
  latest: AiIndexDailyRow | null;
}> {
  const since = new Date();
  since.setDate(since.getDate() - AI_INDEX_CARD_DAYS);
  since.setHours(0, 0, 0, 0);

  return prerenderSafe("ai_index.card", { recent: [], latest: null }, async () => {
    const [recent, latest] = await Promise.all([
      prisma.aiIndexDaily.findMany({
        where: { date: { gte: since } },
        orderBy: { date: "asc" },
      }),
      prisma.aiIndexDaily.findFirst({ orderBy: { date: "desc" } }),
    ]);

    return {
      recent: recent.map(toRow),
      latest: latest ? toRow(latest) : null,
    };
  });
}

/** 聚合维度分布(按全部有数据日期) */
export async function getAiIndexDimensionCounts(): Promise<Record<string, number>> {
  const rows = await prisma.aiIndexDaily.findMany({
    select: { dimensions: true },
  });
  return rows.reduce(
    (acc, r) => {
      const dims = r.dimensions as Record<string, number> | null;
      if (!dims) return acc;
      for (const [k, v] of Object.entries(dims)) {
        acc[k] = (acc[k] ?? 0) + (typeof v === "number" ? v : 0);
      }
      return acc;
    },
    {} as Record<string, number>,
  );
}

export interface EciSyncStatus {
  /** 最近一次成功写入(ok)的同步时刻 */
  lastOkAt: Date | null;
  /** 最近一次拉取(含 rejected/failed)的时刻 */
  lastAttemptAt: Date | null;
  /** 最近一次拉取的状态 */
  lastStatus: string | null;
  /** 最近一次拉取的错误/拒收原因 */
  lastError: string | null;
  /** 库里最新模型的 ECI 日期 */
  latestModelDate: string | null;
  /** 库里的模型行数 */
  modelCount: number;
  /** 距上次成功同步的天数 */
  staleDays: number | null;
  /** 是否已滞后(超阈值未成功同步) */
  stale: boolean;
}

const EMPTY_SYNC_STATUS: EciSyncStatus = {
  lastOkAt: null,
  lastAttemptAt: null,
  lastStatus: null,
  lastError: null,
  latestModelDate: null,
  modelCount: 0,
  staleDays: null,
  stale: false,
};

/** 能力层同步状态(前台新鲜度提示 + MCP 健康域共用) */
export async function getEciSyncStatus(): Promise<EciSyncStatus> {
  return prerenderSafe("ai_index.sync_status", EMPTY_SYNC_STATUS, async () => {
    const [lastOk, lastAttempt, modelCount, latest] = await Promise.all([
      prisma.aiIndexEciSync.findFirst({
        where: { status: "ok" },
        orderBy: { fetchedAt: "desc" },
        select: { fetchedAt: true },
      }),
      prisma.aiIndexEciSync.findFirst({
        orderBy: { fetchedAt: "desc" },
        select: { fetchedAt: true, status: true, error: true },
      }),
      prisma.aiIndexEciModel.count(),
      prisma.aiIndexEciModel.findFirst({
        orderBy: { eciDate: "desc" },
        select: { eciDate: true },
      }),
    ]);

    const staleDays =
      lastOk === null
        ? null
        : Math.floor((Date.now() - lastOk.fetchedAt.getTime()) / (24 * 60 * 60 * 1000));
    return {
      lastOkAt: lastOk?.fetchedAt ?? null,
      lastAttemptAt: lastAttempt?.fetchedAt ?? null,
      lastStatus: lastAttempt?.status ?? null,
      lastError: lastAttempt?.error ?? null,
      latestModelDate: latest?.eciDate.toISOString().slice(0, 10) ?? null,
      modelCount,
      staleDays,
      stale: staleDays === null ? modelCount === 0 : staleDays > ECI_STALE_DAYS,
    };
  });
}
