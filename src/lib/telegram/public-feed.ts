/**
 * 电报流公开读侧(M7 批⑤):前台 /telegram 时间轴与首页 LIVE 带。
 * 只出 visible;BigInt 出口一律转 string;「今日」按北京时区(statsDay 同源)。
 */
import { prisma } from "../db";
import { statsDay } from "../datetime";

import { type PublicTelegramItem } from "./feed-view";

export const PUBLIC_FEED_PAGE_SIZE = 30;
export const BAND_ITEM_COUNT = 8;

export async function listPublicTelegram(opts: {
  limit?: number;
  sourceId?: number;
  /** 轮询增量:只取该时刻之后(publishedAt 兜底 createdAt) */
  afterIso?: string;
}): Promise<PublicTelegramItem[]> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? PUBLIC_FEED_PAGE_SIZE) || 30, 1), 50);
  const after = opts.afterIso ? new Date(opts.afterIso) : null;
  const validAfter = after && !Number.isNaN(after.getTime()) ? after : null;
  const rows = await prisma.telegram.findMany({
    where: {
      status: "visible",
      ...(opts.sourceId !== undefined ? { sourceId: opts.sourceId } : {}),
      ...(validAfter
        ? {
            OR: [
              { publishedAt: { gt: validAfter } },
              { publishedAt: null, createdAt: { gt: validAfter } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      title: true,
      summary: true,
      url: true,
      publishedAt: true,
      createdAt: true,
      source: { select: { id: true, name: true } },
    },
    orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: limit,
  });
  return rows.map((t) => ({
    id: t.id.toString(),
    title: t.title ?? "",
    summary: t.summary,
    url: t.url,
    publishedAt: (t.publishedAt ?? t.createdAt).toISOString(),
    sourceId: t.source.id,
    sourceName: t.source.name,
  }));
}

/** 今日已入库 visible 条数(页头 LIVE 统计) */
export async function countTodayVisible(): Promise<number> {
  const since = new Date(`${statsDay()}T00:00:00+08:00`);
  return prisma.telegram.count({ where: { status: "visible", createdAt: { gte: since } } });
}

/** 渠道筛选选项(visible 计数降序;无条目渠道不出现) */
export async function listPublicChannels(): Promise<
  Array<{ id: number; name: string; count: number }>
> {
  const groups = await prisma.telegram.groupBy({
    by: ["sourceId"],
    where: { status: "visible" },
    _count: { _all: true },
  });
  if (groups.length === 0) return [];
  const sources = await prisma.crawlSource.findMany({
    where: { id: { in: groups.map((g) => g.sourceId) } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(sources.map((s) => [s.id, s.name]));
  return groups
    .map((g) => ({
      id: g.sourceId,
      name: nameOf.get(g.sourceId) ?? `#${g.sourceId}`,
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);
}
