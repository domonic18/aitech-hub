/**
 * 电报流治理(M7 批④,arch/02 §4):条目列表(分段/来源/搜索/媒体)+ 状态迁移 +
 * 标题摘要人工修正。软删(deleted)为终态不经 UI 触达;命中过滤的条目以
 * hidden 入库,治理台是误杀观测与恢复的唯一入口。
 * M8 批⑦:列表补媒体筛选与视频字段投影(镜像 public-feed 模式,原 AI 解读态随解读批)。
 */
import { z } from "zod";

import { prisma } from "../db";
import { logger } from "../logger";
import {
  TELEGRAM_STATUS_ARCHIVED,
  TELEGRAM_STATUS_HIDDEN,
  TELEGRAM_STATUS_VISIBLE,
} from "./constants";
import { toEngagement, type FeedMediaFilter } from "./feed-view";

export const TELEGRAM_PAGE_SIZE = 15;

/** 四分段:全部 / 可见 / 隐藏(含过滤命中)/ 归档 */
export const TELEGRAM_LIST_SEGMENTS = [
  "all",
  TELEGRAM_STATUS_VISIBLE,
  TELEGRAM_STATUS_HIDDEN,
  TELEGRAM_STATUS_ARCHIVED,
] as const;
export type TelegramListSegment = (typeof TELEGRAM_LIST_SEGMENTS)[number];

/** UI 可迁移的三个状态(deleted 终态不经治理台) */
export const TELEGRAM_MUTABLE_STATUSES = [
  TELEGRAM_STATUS_VISIBLE,
  TELEGRAM_STATUS_HIDDEN,
  TELEGRAM_STATUS_ARCHIVED,
] as const;

export type TelegramAdminErrorCode = "not_found";

export class TelegramAdminError extends Error {
  constructor(
    public code: TelegramAdminErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** 编辑与状态变更一体的请求体(至少一项) */
export const TelegramUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    summary: z.string().trim().min(1).max(1000).optional(),
    status: z.enum(TELEGRAM_MUTABLE_STATUSES).optional(),
  })
  .refine((v) => v.title !== undefined || v.summary !== undefined || v.status !== undefined, {
    message: "至少提供 title/summary/status 之一",
  });

export interface TelegramListQuery {
  page: number;
  segment: TelegramListSegment;
  sourceId?: number;
  q?: string;
  /** 媒体筛选(批⑦):all/text/video,非法值由页面解析层回落 all */
  media?: FeedMediaFilter;
}

/** 视频行互动数(库内 Json 白名单投影;采集缺失位为 null) */
export type TelegramVideoEngagement = ReturnType<typeof toEngagement>;

function listWhere(
  segment: TelegramListSegment,
  sourceId: number | undefined,
  q?: string,
  media?: FeedMediaFilter,
) {
  const where: {
    status?: string;
    sourceId?: number;
    mediaType?: string;
    OR?: Array<
      | { title: { contains: string; mode: "insensitive" } }
      | { summary: { contains: string; mode: "insensitive" } }
    >;
  } = {};
  if (segment !== "all") where.status = segment;
  if (sourceId !== undefined) where.sourceId = sourceId;
  if (media && media !== "all") where.mediaType = media;
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { summary: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

/** 条目列表 + 分段计数;渠道下拉选项一并返回(渠道个位数量级) */
export async function listTelegramAdmin({ page, segment, sourceId, q, media }: TelegramListQuery) {
  const where = listWhere(segment, sourceId, q, media);
  const countWhere = (seg: TelegramListSegment) => listWhere(seg, sourceId, q, media);
  const [items, all, visible, hidden, archived, sources] = await prisma.$transaction([
    prisma.telegram.findMany({
      where,
      select: {
        id: true,
        title: true,
        summary: true,
        url: true,
        publishedAt: true,
        createdAt: true,
        status: true,
        filterHit: true,
        // 批⑦:视频行字段(封面/平台/博主/时长/互动;解读态字段随解读批)
        mediaType: true,
        videoPlatform: true,
        videoBlogger: true,
        videoCoverUrl: true,
        videoDuration: true,
        videoEngagement: true,
        source: { select: { id: true, name: true } },
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * TELEGRAM_PAGE_SIZE,
      take: TELEGRAM_PAGE_SIZE,
    }),
    prisma.telegram.count({ where: countWhere("all") }),
    prisma.telegram.count({ where: countWhere(TELEGRAM_STATUS_VISIBLE) }),
    prisma.telegram.count({ where: countWhere(TELEGRAM_STATUS_HIDDEN) }),
    prisma.telegram.count({ where: countWhere(TELEGRAM_STATUS_ARCHIVED) }),
    prisma.crawlSource.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } }),
  ]);
  return {
    items: items.map((t) => ({
      id: t.id.toString(),
      title: t.title,
      summary: t.summary,
      url: t.url,
      publishedAt: t.publishedAt,
      createdAt: t.createdAt,
      status: t.status,
      filterHit: t.filterHit,
      sourceName: t.source.name,
      mediaType: t.mediaType,
      videoPlatform: t.videoPlatform,
      videoBlogger: t.videoBlogger,
      videoCoverUrl: t.videoCoverUrl,
      videoDuration: t.videoDuration,
      videoEngagement: t.videoEngagement === null ? null : toEngagement(t.videoEngagement),
    })),
    total: all,
    counts: { all, visible, hidden, archived },
    sources,
    page,
    segment,
  };
}
export type TelegramAdminList = Awaited<ReturnType<typeof listTelegramAdmin>>;

/** 状态迁移/标题摘要修正(字段级可选,逐项应用) */
export async function updateTelegramItem(
  id: bigint,
  patch: { title?: string; summary?: string; status?: string },
): Promise<{ status: string }> {
  const existing = await prisma.telegram.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new TelegramAdminError("not_found", "条目不存在");
  const updated = await prisma.telegram.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    },
    select: { status: true },
  });
  logger.info({
    event: "telegram.updated",
    telegramId: id.toString(),
    fields: Object.keys(patch),
  });
  return updated;
}
