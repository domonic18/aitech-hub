/**
 * 站点统计读侧·行级明细(技术债批⑤ 自 queries 拆出):搜索词排行(2026-10-06,
 * 行级 180 天保留)+ 最近访问明细(M10 批⑥,近 7 天保留)。行级表按 createdAt
 * 绝对时刻比窗口,北京日界换 `T00:00:00+08:00`(Timestamptz,非 @db.Date 日聚合)。
 */
import { prisma } from "@/lib/db";

import type { SourceClass } from "./classify";
import { dayStr, type HotRange } from "./queries";

export interface HotSearchTermRow {
  term: string;
  count: number;
}

/** 北京日界 → 行级 createdAt 可比较的绝对时刻(Timestamptz,非 @db.Date 日聚合) */
function cnDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+08:00`);
}

/** 搜索词排行:stats_search_log 行级 GROUP BY(count 降序,同次数按词字典序稳定);
 * 窗口语义与热门页面一致(近 N 天 = 含今日 N 个北京日;「全部」受 180 天保留界) */
export async function getHotSearchTerms(range: HotRange, limit = 10): Promise<HotSearchTermRow[]> {
  const rows = await prisma.statsSearchLog.groupBy({
    by: ["term"],
    where:
      range === "all"
        ? undefined
        : {
            createdAt: { gte: cnDayStart(dayStr(range === "today" ? 0 : range === "7d" ? 6 : 29)) },
          },
    _count: { _all: true },
    orderBy: [{ _count: { term: "desc" } }, { term: "asc" }],
    take: limit,
  });
  return rows.map((r) => ({ term: r.term, count: r._count._all }));
}

// ── 访问明细 ──────────────────────────────────────────────────────────

export interface RecentVisitRow {
  id: string;
  createdAt: Date;
  path: string;
  ip: string;
  browser: string;
  os: string;
  deviceType: string;
  sourceClass: SourceClass;
  sourceName: string;
}

/** 最近访问明细:倒序取 N 行(stats_visit_log,worker 日清 7 天前) */
export async function getRecentVisits(limit = 30): Promise<RecentVisitRow[]> {
  const rows = await prisma.statsVisitLog.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      createdAt: true,
      path: true,
      ip: true,
      browser: true,
      os: true,
      deviceType: true,
      sourceClass: true,
      sourceName: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    id: r.id.toString(),
    sourceClass: r.sourceClass as SourceClass,
  }));
}
