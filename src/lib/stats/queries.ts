/**
 * 站点统计读侧(M5-c):五张日聚合表的查询函数,仅供 admin 统计页。
 * 口径纪律:
 * - 日期边界一律在 JS 侧按 Asia/Shanghai 算好(statsDay,src/lib/datetime.ts)
 *   作参数传入,SQL 内禁 now()/CURRENT_DATE,避免与采集侧日界漂移;
 * - 「今日」读纯 PG(60s worker flush 已是准实时),不并读 Redis 缓冲,
 *   与验收口径「与日聚合表一致」一致,页面注记最长延迟约 2 分钟;
 * - 全部出口为 number(BigInt/Decimal 在本层收口),调用方可直接渲染。
 */
import { prisma } from "@/lib/db";
import { statsDay } from "@/lib/datetime";

import type { SourceClass } from "./classify";

export interface DayWindow {
  pv: number;
  uv: number;
}

export interface VisitOverview {
  today: DayWindow;
  yesterday: DayWindow;
  last7: DayWindow;
  last30: DayWindow;
}

export interface DayPoint {
  /** YYYY-MM-DD(北京时区) */
  date: string;
  pv: number;
  uv: number;
}

export interface ReferrerRow {
  sourceClass: SourceClass;
  sourceName: string;
  pv: number;
  uv: number;
}

export interface ReferrerPanel {
  totalPv: number;
  rows: ReferrerRow[];
}

export interface NamePv {
  name: string;
  pv: number;
}

export interface ClientPanel {
  browsers: NamePv[];
  devices: NamePv[];
}

export type HotRange = "today" | "7d" | "30d" | "all";

export interface HotPageRow {
  path: string;
  pv: number;
  uv: number;
  /** 命中文章时的标题;null = 非文章路径 */
  postTitle: string | null;
  kind: "article" | "page" | "list";
}

/** 相对今日偏移 N 天的统计日(北京时区),N 为负表示过去 */
function dayStr(offsetDays: number): string {
  return statsDay(new Date(Date.now() - offsetDays * 86_400_000));
}

/** @db.Date 列的 Prisma 比较参数:UTC 午夜即该日 */
function dayDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** 单条 SQL 聚齐四窗口(原型 admin-stats ov-grid 四卡) */
export async function getVisitOverview(): Promise<VisitOverview> {
  const t0 = dayStr(0);
  const t1 = dayStr(1);
  const f7 = dayStr(6);
  const f30 = dayStr(29);
  const [row] = await prisma.$queryRaw<Record<string, bigint>[]>`
    SELECT
      COALESCE(SUM(CASE WHEN stat_date = ${t0}::date THEN pv END), 0)::bigint AS t_pv,
      COALESCE(SUM(CASE WHEN stat_date = ${t0}::date THEN uv END), 0)::bigint AS t_uv,
      COALESCE(SUM(CASE WHEN stat_date = ${t1}::date THEN pv END), 0)::bigint AS y_pv,
      COALESCE(SUM(CASE WHEN stat_date = ${t1}::date THEN uv END), 0)::bigint AS y_uv,
      COALESCE(SUM(CASE WHEN stat_date >= ${f7}::date THEN pv END), 0)::bigint AS w_pv,
      COALESCE(SUM(CASE WHEN stat_date >= ${f7}::date THEN uv END), 0)::bigint AS w_uv,
      COALESCE(SUM(pv), 0)::bigint AS m_pv,
      COALESCE(SUM(uv), 0)::bigint AS m_uv
    FROM stats_visit_daily
    WHERE stat_date >= ${f30}::date AND stat_date <= ${t0}::date`;
  return {
    today: { pv: Number(row?.t_pv ?? 0), uv: Number(row?.t_uv ?? 0) },
    yesterday: { pv: Number(row?.y_pv ?? 0), uv: Number(row?.y_uv ?? 0) },
    last7: { pv: Number(row?.w_pv ?? 0), uv: Number(row?.w_uv ?? 0) },
    last30: { pv: Number(row?.m_pv ?? 0), uv: Number(row?.m_uv ?? 0) },
  };
}

/** 逐日 PV/UV(generate_series 补零,无数据日不断线) */
export async function getVisitSeries(days: 7 | 30 | 90): Promise<DayPoint[]> {
  const to = dayStr(0);
  const from = dayStr(days - 1);
  const rows = await prisma.$queryRaw<{ date: string; pv: bigint; uv: bigint }[]>`
    SELECT to_char(d::date, 'YYYY-MM-DD') AS date,
           COALESCE(SUM(v.pv), 0)::bigint AS pv,
           COALESCE(SUM(v.uv), 0)::bigint AS uv
    FROM generate_series(${from}::date, ${to}::date, INTERVAL '1 day') AS d
    LEFT JOIN stats_visit_daily v ON v.stat_date = d::date
    GROUP BY d
    ORDER BY d`;
  return rows.map((r) => ({ date: r.date, pv: Number(r.pv), uv: Number(r.uv) }));
}

/** 流量来源四类细分(sourceClass+sourceName 双层),近 N 日 */
export async function getReferrerPanel(days: 7 | 30 | 90): Promise<ReferrerPanel> {
  const rows = await prisma.statsReferrerDaily.groupBy({
    by: ["sourceClass", "sourceName"],
    where: { statDate: { gte: dayDate(dayStr(days - 1)), lte: dayDate(dayStr(0)) } },
    _sum: { pv: true, uv: true },
    orderBy: { _sum: { pv: "desc" } },
  });
  const mapped: ReferrerRow[] = rows.map((r) => ({
    sourceClass: r.sourceClass as SourceClass,
    sourceName: r.sourceName,
    pv: Number(r._sum.pv ?? 0),
    uv: Number(r._sum.uv ?? 0),
  }));
  return {
    totalPv: mapped.reduce((acc, r) => acc + r.pv, 0),
    rows: mapped,
  };
}

/** 访客环境分布:表无 uv 字段,按 PV 口径(页面注记) */
export async function getClientPanel(days: 7 | 30 | 90): Promise<ClientPanel> {
  const where = { statDate: { gte: dayDate(dayStr(days - 1)), lte: dayDate(dayStr(0)) } };
  const [browsers, devices] = await Promise.all([
    prisma.statsClientDaily.groupBy({
      by: ["browser"],
      where,
      _sum: { pv: true },
      orderBy: { _sum: { pv: "desc" } },
    }),
    prisma.statsClientDaily.groupBy({
      by: ["deviceType"],
      where,
      _sum: { pv: true },
      orderBy: { _sum: { pv: "desc" } },
    }),
  ]);
  return {
    browsers: browsers.map((r) => ({ name: r.browser, pv: Number(r._sum.pv ?? 0) })),
    devices: devices.map((r) => ({ name: r.deviceType, pv: Number(r._sum.pv ?? 0) })),
  };
}

/**
 * 热门页面(路径粒度)。path → 文章反解为 JS 二步:
 * 单段且不含 "." 的路径视作 slug 候选,批量查 post 表补标题;余按前缀映射 page/list。
 */
export async function getHotPages(range: HotRange, limit = 10): Promise<HotPageRow[]> {
  const rows = await prisma.statsPageDaily.groupBy({
    by: ["path"],
    where:
      range === "all"
        ? undefined
        : range === "today"
          ? { statDate: dayDate(dayStr(0)) }
          : {
              statDate: { gte: dayDate(dayStr(range === "7d" ? 6 : 29)), lte: dayDate(dayStr(0)) },
            },
    _sum: { pv: true, uv: true },
    orderBy: { _sum: { pv: "desc" } },
    take: limit * 3, // 先多取一些,文章命中优先保留后截断
  });
  const PAGE_PATHS = new Set(["/search", "/about/", "/agreement/", "/privacy/"]);
  const candidates = rows
    .map((r) => r.path)
    .filter((p) => {
      const seg = p.replace(/^\/+|\/+$/g, "");
      return seg.length > 0 && !seg.includes("/") && !seg.includes(".");
    })
    .map((p) => p.replace(/^\/+|\/+$/g, ""));
  const posts = candidates.length
    ? await prisma.post.findMany({
        where: { slug: { in: candidates } },
        select: { slug: true, title: true },
      })
    : [];
  const bySlug = new Map(posts.map((p) => [p.slug, p.title]));
  const out: HotPageRow[] = rows.map((r) => {
    const seg = r.path.replace(/^\/+|\/+$/g, "");
    const title = bySlug.get(seg);
    const kind: HotPageRow["kind"] = title
      ? "article"
      : PAGE_PATHS.has(r.path) || r.path.startsWith("/articles/page") || r.path === "/"
        ? "page"
        : "list";
    return {
      path: r.path,
      pv: Number(r._sum.pv ?? 0),
      uv: Number(r._sum.uv ?? 0),
      postTitle: title ?? null,
      kind,
    };
  });
  out.sort((a, b) => b.pv - a.pv);
  return out.slice(0, limit);
}
