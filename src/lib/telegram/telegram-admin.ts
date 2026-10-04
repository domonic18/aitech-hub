/**
 * 电报流治理(M7 批④,arch/02 §4):条目列表(分段/来源/搜索/媒体)+ 状态迁移 +
 * 标题摘要人工修正。软删(deleted)为终态不经 UI 触达;命中过滤的条目以
 * hidden 入库,治理台是误杀观测与恢复的唯一入口。
 * M8 批⑦:列表补媒体筛选与视频字段投影(镜像 public-feed 模式,原 AI 解读态随解读批)。
 * M8 批⑧:补博主作品筛选(blogger 等值 video_blogger,博主台账「作品」入口落地)。
 * M10 批⑤:补解读态筛选(ai=none/working/done/failed,存量视频找「解读」入口的导向筛)。
 */
import { z } from "zod";

import { prisma } from "../db";
import { logger } from "../logger";
import { getQueue, QUEUE_INTERPRETER } from "../queue";
import {
  TELEGRAM_AI_FAILED,
  TELEGRAM_AI_PENDING,
  TELEGRAM_AI_PROCESSING,
  TELEGRAM_AI_TERMINAL,
  TELEGRAM_STATUS_ARCHIVED,
  TELEGRAM_STATUS_HIDDEN,
  TELEGRAM_STATUS_VISIBLE,
} from "./constants";
import { interpretJobId, markPendingAndEnqueue } from "./interpret-video";
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

/** 解读态筛选(M10 批⑤):四组口径映射 aiStatus 多值;非法值由页面解析层回落全部 */
export const TELEGRAM_AI_FILTERS = ["none", "working", "done", "failed"] as const;
export type TelegramAiFilter = (typeof TELEGRAM_AI_FILTERS)[number];

/** 解读态 → where 片段(纯函数,单测锚):none=未解读;working=在途;done 含无转写降级 */
export function aiFilterWhere(
  aiFilter: TelegramAiFilter,
): { aiStatus: string | null } | { aiStatus: { in: string[] } } {
  switch (aiFilter) {
    case "none":
      return { aiStatus: null };
    case "working":
      return { aiStatus: { in: [TELEGRAM_AI_PENDING, TELEGRAM_AI_PROCESSING] } };
    case "done":
      return { aiStatus: { in: [...TELEGRAM_AI_TERMINAL] } };
    case "failed":
      return { aiStatus: TELEGRAM_AI_FAILED };
  }
}

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
  /** 博主作品筛选(批⑧):video_blogger 冗余字段等值;隐含 mediaType=video */
  blogger?: string;
  /** 解读态筛选(M10 批⑤):undefined=全部 */
  aiFilter?: TelegramAiFilter;
}

/** 视频行互动数(库内 Json 白名单投影;采集缺失位为 null) */
export type TelegramVideoEngagement = ReturnType<typeof toEngagement>;

function listWhere(
  segment: TelegramListSegment,
  sourceId: number | undefined,
  q?: string,
  media?: FeedMediaFilter,
  blogger?: string,
  aiFilter?: TelegramAiFilter,
) {
  const where: {
    status?: string;
    sourceId?: number;
    mediaType?: string;
    videoBlogger?: string;
    aiStatus?: string | null | { in: string[] };
    OR?: Array<
      | { title: { contains: string; mode: "insensitive" } }
      | { summary: { contains: string; mode: "insensitive" } }
    >;
  } = {};
  if (segment !== "all") where.status = segment;
  if (sourceId !== undefined) where.sourceId = sourceId;
  if (media && media !== "all") where.mediaType = media;
  if (blogger) {
    // 博主筛选隐含 video(锚 video_blogger 冗余字段),覆盖 media
    where.mediaType = "video";
    where.videoBlogger = blogger;
  }
  if (aiFilter) Object.assign(where, aiFilterWhere(aiFilter));
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { summary: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

/** 条目列表 + 分段计数;渠道下拉选项一并返回(渠道个位数量级) */
export async function listTelegramAdmin({
  page,
  segment,
  sourceId,
  q,
  media,
  blogger,
  aiFilter,
}: TelegramListQuery) {
  const where = listWhere(segment, sourceId, q, media, blogger, aiFilter);
  const countWhere = (seg: TelegramListSegment) =>
    listWhere(seg, sourceId, q, media, blogger, aiFilter);
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
        // 批⑦:视频行字段(封面/平台/博主/时长/互动);M9:解读态列组
        mediaType: true,
        videoPlatform: true,
        videoBlogger: true,
        videoCoverUrl: true,
        videoDuration: true,
        videoEngagement: true,
        aiStatus: true,
        aiTopic: true,
        lastAiError: true,
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
      aiStatus: t.aiStatus,
      aiTopic: t.aiTopic,
      lastAiError: t.lastAiError,
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

/** 解读触发错误码(路由映射:not_found→404 / not_video→400 / no_link→409) */
export type TelegramInterpretErrorCode = "not_found" | "not_video" | "no_link";

export class TelegramInterpretError extends Error {
  constructor(
    public code: TelegramInterpretErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * 手动触发单条解读(M9;存量补读与失败重试同入口):重置解读态 → 入队。
 * 过境直链不落库,这里恒传 null,processor 现场经网关重拉 listing 取链。
 */
export async function triggerTelegramInterpret(id: bigint): Promise<{ enqueued: true }> {
  const row = await prisma.telegram.findUnique({
    where: { id },
    select: {
      id: true,
      mediaType: true,
      url: true,
      videoPlatform: true,
      videoBlogger: true,
    },
  });
  if (!row) throw new TelegramInterpretError("not_found", "条目不存在");
  if (row.mediaType !== "video") throw new TelegramInterpretError("not_video", "仅视频条目可解读");
  // videoId 从 canonical 外链尾段解析(ingest 落库形 https://www.douyin.com/video/{id})
  const videoId = row.url?.match(/\/video\/([\w-]+)/)?.[1] ?? null;
  if (!videoId) throw new TelegramInterpretError("no_link", "外链缺视频 id,无法回拉直链");
  // secUid 经博主台账反查(平台+昵称);博主已删 → null,processor 只能吃直链重拉失败降级
  const account = await prisma.socialAccount.findFirst({
    where: { platform: row.videoPlatform ?? "", nickname: row.videoBlogger ?? "" },
    select: { secUid: true },
  });
  const queue = getQueue(QUEUE_INTERPRETER);
  // 先移除遗留 job(removeOnComplete 保留的 completed job 会顶掉同名 jobId 入队,静默去重)
  await queue.remove(interpretJobId(row.id.toString())).catch(() => null);
  await markPendingAndEnqueue(row.id, {
    videoId,
    playUrl: null, // 过境直链不落库,processor 现场重拉
    platform: row.videoPlatform ?? "",
    secUid: account?.secUid ?? null,
  });
  logger.info({ event: "telegram.interpret_triggered", telegramId: row.id.toString() });
  return { enqueued: true };
}
