/**
 * 电报流公开读侧(M7 批⑤):前台 /telegram 时间轴与首页 LIVE 带。
 * 只出 visible;BigInt 出口一律转 string;「今日」按北京时区(statsDay 同源)。
 */
import { prisma } from "../db";
import { statsDay } from "../datetime";
import { prerenderSafe } from "../prerender-safe";

import { type FeedMediaFilter, type PublicTelegramItem } from "./feed-view";

export const PUBLIC_FEED_PAGE_SIZE = 30;
export const BAND_ITEM_COUNT = 8;

export async function listPublicTelegram(opts: {
  limit?: number;
  sourceId?: number;
  /** 轮询增量:只取该时刻之后(publishedAt 兜底 createdAt) */
  afterIso?: string;
  /** 媒体筛选(M8 混合流):all|text|video,非法值回落 all */
  media?: FeedMediaFilter;
}): Promise<PublicTelegramItem[]> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? PUBLIC_FEED_PAGE_SIZE) || 30, 1), 50);
  const after = opts.afterIso ? new Date(opts.afterIso) : null;
  const validAfter = after && !Number.isNaN(after.getTime()) ? after : null;
  return prerenderSafe("telegram.publicFeed", [], () =>
    queryPublicTelegram(limit, validAfter, opts.sourceId, opts.media ?? "all"),
  );
}

/** 互动 JSON 投影(库内形状不受信,逐字段白名单;M8 play 恒 null 隐藏) */
function toEngagement(raw: unknown): {
  play: number | null;
  like: number | null;
  comment: number | null;
} {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  return { play: num(o.play), like: num(o.like), comment: num(o.comment) };
}

async function queryPublicTelegram(
  limit: number,
  validAfter: Date | null,
  sourceId: number | undefined,
  media: FeedMediaFilter,
): Promise<PublicTelegramItem[]> {
  const rows = await prisma.telegram.findMany({
    where: {
      status: "visible",
      ...(sourceId !== undefined ? { sourceId } : {}),
      ...(media !== "all" ? { mediaType: media } : {}),
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
      mediaType: true,
      videoPlatform: true,
      videoBlogger: true,
      videoCoverUrl: true,
      videoDuration: true,
      videoEngagement: true,
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
    mediaType: t.mediaType === "video" ? "video" : "text",
    ...(t.mediaType === "video"
      ? {
          video: {
            platform: t.videoPlatform ?? "",
            blogger: t.videoBlogger ?? "",
            coverUrl: t.videoCoverUrl,
            durationSeconds: t.videoDuration,
            engagement: toEngagement(t.videoEngagement),
          },
        }
      : {}),
  }));
}

/** 今日已入库 visible 条数(页头 LIVE 统计) */
export async function countTodayVisible(): Promise<number> {
  const since = new Date(`${statsDay()}T00:00:00+08:00`);
  return prerenderSafe("telegram.todayVisible", 0, () =>
    prisma.telegram.count({ where: { status: "visible", createdAt: { gte: since } } }),
  );
}

/** 渠道筛选选项(visible 计数降序;无条目渠道不出现) */
export async function listPublicChannels(): Promise<
  Array<{ id: number; name: string; count: number }>
> {
  return prerenderSafe("telegram.publicChannels", [], queryPublicChannels);
}

async function queryPublicChannels(): Promise<Array<{ id: number; name: string; count: number }>> {
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
