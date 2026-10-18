/**
 * 热榜源登记(M34 批③ 验收反馈:纳入采集计划管理):fetcher 注册表(代码)
 * 的运行态投影 insight_hot_source——运行时启停(fetch 轮按表过滤,停用源不
 * 拉取)、最近拉取/连败/末次错误逐源回写(crawl_source 同口径)。缺行按启用
 * 处理:新 fetcher 上线免迁移即生效,台账读侧懒登记。启停只挡采集,不动
 * INSIGHT_SOURCES_ENABLED 读侧白名单(存量信号照常展示)。
 */
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { statsDay } from "@/lib/datetime";

import { HOT_FETCHERS } from "./hotlist/registry";
import type { HotFetcher } from "./hotlist/types";
import { INSIGHT_SOURCE_MEDIUM, type InsightSource } from "./ingest";

/** 北京时区当日零点(与 insight/admin 同源口径,勿用 UTC 切日) */
function todayStart(now: Date = new Date()): Date {
  return new Date(`${statsDay(now)}T00:00:00+08:00`);
}

export type HotSourceKey = HotFetcher["source"];

/** 台账行(采集计划页;label/medium 由代码注册表补全,DB 只存运行态) */
export interface HotSourceRow {
  source: HotSourceKey;
  label: string;
  /** 介质(方案 §2:search/voice,台账展示用) */
  medium: string;
  enabled: boolean;
  consecutiveFails: number;
  lastRunAt: Date | null;
  lastError: string | null;
  /** 今日入池+续热条数(北京墙钟日) */
  todayCount: number;
}

/** fetcher 注册表键集(未知 source 一律拒绝,防脏键入表) */
const HOT_SOURCE_KEYS = new Set<string>(HOT_FETCHERS.map((f) => f.source));

/** 启用集(缺行=启用):run 编排闸 */
export async function enabledHotSources(): Promise<Set<string>> {
  const rows = await prisma.insightHotSource.findMany({
    where: { enabled: false },
    select: { source: true },
  });
  const disabled = new Set(rows.map((r) => r.source));
  return new Set([...HOT_SOURCE_KEYS].filter((k) => !disabled.has(k)));
}

/**
 * 逐源拉取态回写(best-effort:台账状态非信号主链路,自吞仅告警);
 * 成功清零连败并抹末次错误,失败连败 +1(与 crawl_source 口径一致)。
 */
export async function recordHotSourceRun(
  source: string,
  ok: boolean,
  error?: string,
): Promise<void> {
  if (!HOT_SOURCE_KEYS.has(source)) return;
  const now = new Date();
  const lastError = ok ? null : (error?.slice(0, 300) ?? "unknown");
  try {
    await prisma.insightHotSource.upsert({
      where: { source },
      create: { source, consecutiveFails: ok ? 0 : 1, lastRunAt: now, lastError },
      update: {
        lastRunAt: now,
        consecutiveFails: ok ? 0 : { increment: 1 },
        lastError,
      },
    });
  } catch (e) {
    logger.warn({ event: "insight.hot_source_state_write_failed", source, error: String(e) });
  }
}

/** 台账(采集计划页):懒登记缺行 + 今日条数聚合(北京墙钟日) */
export async function listHotSourcesAdmin(): Promise<HotSourceRow[]> {
  const keys = [...HOT_SOURCE_KEYS] as HotSourceKey[];
  const [rows, counts] = await Promise.all([
    prisma.insightHotSource.findMany({ where: { source: { in: keys } } }),
    prisma.insightSignal.groupBy({
      by: ["source"],
      where: { source: { in: keys }, signalAt: { gte: todayStart() } },
      _count: { _all: true },
    }),
  ]);
  const byKey = new Map(rows.map((r) => [r.source, r]));
  const today = new Map(counts.map((g) => [g.source, g._count._all]));
  // 懒登记:注册表有而表缺的源补行(缺行=启用语义的物化,便于直接开关)
  const missing = keys.filter((k) => !byKey.has(k));
  if (missing.length > 0) {
    await prisma.insightHotSource.createMany({
      data: missing.map((source) => ({ source })),
      skipDuplicates: true,
    });
  }
  return keys.map((source) => {
    const r = byKey.get(source);
    return {
      source,
      label: LABELS[source] ?? source,
      medium: INSIGHT_SOURCE_MEDIUM[source as InsightSource] ?? "search",
      enabled: r?.enabled ?? true,
      consecutiveFails: r?.consecutiveFails ?? 0,
      lastRunAt: r?.lastRunAt ?? null,
      lastError: r?.lastError ?? null,
      todayCount: today.get(source) ?? 0,
    };
  });
}

/** 启停(采集计划页开关):未知源抛错(路由层 404) */
export async function setHotSourceEnabled(source: string, enabled: boolean): Promise<void> {
  if (!HOT_SOURCE_KEYS.has(source)) throw new HotSourceError("unknown_source", "未知热榜源");
  await prisma.insightHotSource.upsert({
    where: { source },
    create: { source, enabled },
    update: { enabled },
  });
}

export class HotSourceError extends Error {
  constructor(
    public code: "unknown_source",
    message: string,
  ) {
    super(message);
  }
}

/** 展示名(fetcher 注册表无 label,与洞察中心页签同源) */
const LABELS: Record<string, string> = {
  "hot-baidu": "百度热搜",
  "hot-zhihu": "知乎热榜",
  "hot-bilibili": "B站热搜",
};
