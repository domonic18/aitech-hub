/**
 * 站点统计读侧·机器面(技术债批⑤ 自 queries 拆出):爬虫流量细分(2026-10-07
 * 方案B:人机区分,middleware 捕获)+ GEO 机器面(2026-10-09 方案A:llms/.md
 * 直出的机器消费观测)。窗口基元复用 queries 的 dayStr/dayDate(@internal)。
 */
import { prisma } from "@/lib/db";

import { botKindOf } from "./bots";
import { dayDate, dayStr } from "./queries";
import { isGeoSurface, type GeoSurface } from "./geo";

export interface BotRow {
  name: string;
  kind: "ai" | "search" | "other";
  pv: number;
}

export interface BotPanel {
  /** 爬虫抓取 PV 合计(近 N 日) */
  totalPv: number;
  aiPv: number;
  searchPv: number;
  rows: BotRow[];
}

/**
 * 爬虫抓取细分(source_class='bot' 落在 stats_referrer_daily,与真人四分类
 * 同表分账;流量来源面板不受影响——本类目单独出卡)。类别由展示侧按
 * bots.ts 名单回查(改名兜 other),表里只存名字与 PV。
 */
export async function getBotPanel(days: 7 | 30 | 90): Promise<BotPanel> {
  const rows = await prisma.statsReferrerDaily.groupBy({
    by: ["sourceName"],
    where: {
      sourceClass: "bot",
      statDate: { gte: dayDate(dayStr(days - 1)), lte: dayDate(dayStr(0)) },
    },
    _sum: { pv: true },
    orderBy: { _sum: { pv: "desc" } },
  });
  const mapped: BotRow[] = rows.map((r) => ({
    name: r.sourceName,
    kind: botKindOf(r.sourceName),
    pv: Number(r._sum.pv ?? 0),
  }));
  return {
    totalPv: mapped.reduce((acc, r) => acc + r.pv, 0),
    aiPv: mapped.filter((r) => r.kind === "ai").reduce((acc, r) => acc + r.pv, 0),
    searchPv: mapped.filter((r) => r.kind === "search").reduce((acc, r) => acc + r.pv, 0),
    rows: mapped,
  };
}

// ── GEO 机器面 ────────────────────────────────────────────────────────

export interface GeoPanel {
  /** GEO 抓取 PV 合计(近 N 日) */
  totalPv: number;
  /** 按面聚合(llms_index/llms_full/post_md) */
  bySurface: { surface: GeoSurface; pv: number }[];
  /** 按爬虫聚合(含 unknown-agent) */
  byBot: { name: string; kind: BotRow["kind"]; pv: number }[];
  /** post_md 面文章 TopN(标题查询侧反解;已删文 title=null) */
  topPosts: { postId: string; title: string | null; pv: number }[];
}

/**
 * GEO 机器面面板:三组聚合同表(stats_geo_daily)分查。post_id 无外键,
 * TopN 标题按 id 反解(删文不在结果里,标题置 null 由展示层兜底)。
 */
export async function getGeoPanel(days: 7 | 30 | 90): Promise<GeoPanel> {
  const where = { statDate: { gte: dayDate(dayStr(days - 1)), lte: dayDate(dayStr(0)) } };
  const [surfaceRows, botRows, postRows] = await Promise.all([
    prisma.statsGeoDaily.groupBy({
      by: ["surface"],
      where,
      _sum: { pv: true },
      orderBy: { _sum: { pv: "desc" } },
    }),
    prisma.statsGeoDaily.groupBy({
      by: ["botName"],
      where,
      _sum: { pv: true },
      orderBy: { _sum: { pv: "desc" } },
    }),
    prisma.statsGeoDaily.groupBy({
      by: ["postId"],
      where: { ...where, postId: { not: "" } },
      _sum: { pv: true },
      orderBy: { _sum: { pv: "desc" } },
      take: 10,
    }),
  ]);
  const postIds = postRows.map((r) => BigInt(r.postId));
  const posts = postIds.length
    ? await prisma.post.findMany({
        where: { id: { in: postIds } },
        select: { id: true, title: true },
      })
    : [];
  const byId = new Map(posts.map((p) => [p.id, p.title]));
  const bySurface = surfaceRows
    .filter((r): r is typeof r & { surface: GeoSurface } => isGeoSurface(r.surface))
    .map((r) => ({ surface: r.surface, pv: Number(r._sum.pv ?? 0) }));
  const byBot = botRows.map((r) => ({
    name: r.botName,
    kind: botKindOf(r.botName),
    pv: Number(r._sum.pv ?? 0),
  }));
  return {
    totalPv: bySurface.reduce((acc, r) => acc + r.pv, 0),
    bySurface,
    byBot,
    topPosts: postRows.map((r) => ({
      postId: r.postId,
      title: byId.get(BigInt(r.postId)) ?? null,
      pv: Number(r._sum.pv ?? 0),
    })),
  };
}
