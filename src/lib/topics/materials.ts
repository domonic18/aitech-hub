/**
 * 素材读写(M42 批②,自 topics/repo 迁出并扩展):素材发现(searchMaterials)、
 * 挂载/卸载(幂等)、候选列表与聚合水合。素材接地纪律:创作只能引用系统内既有
 * 素材——电报内容(已解读视频 / 可见文本)与历史文章(未软删);不设跨域 FK
 * (同 discovery 两表口径),存在性在挂载时校验、读侧缺行降级为「源已删」。
 * 电报文本放开(M42):mediaType=text 要求 status=visible 且 summary 非空,
 * 视频仍以解读完成 aiStatus=done 为准(解读结论是写作底料)。
 */
import { Prisma, type TopicItem } from "@prisma/client";

import { prisma } from "../db";
import { TopicError } from "./errors";
import type { ItemMountInput, ItemUpdateInput } from "./schemas";

export type MaterialKind = "telegram" | "post";

// ── 存在性校验 ────────────────────────────────────────────

/** 挂载前置校验:telegram 视频须解读完成、文本须可见且有内容;post 须存在且未软删 */
export async function assertMaterialExists(itemType: MaterialKind, itemId: bigint): Promise<void> {
  if (itemType === "telegram") {
    const row = await prisma.telegram.findUnique({
      where: { id: itemId },
      select: { mediaType: true, status: true, aiStatus: true, summary: true },
    });
    if (!row) throw new TopicError("invalid_material", "电报条目不存在");
    if (row.mediaType === "video") {
      if (row.aiStatus !== "done")
        throw new TopicError("invalid_material", "该视频尚未解读完成,暂不可挂");
      return;
    }
    if (row.status !== "visible")
      throw new TopicError("invalid_material", "该电报条目已隐藏/归档,暂不可挂");
    if (row.summary.trim() === "")
      throw new TopicError("invalid_material", "该电报条目没有可用的文字内容,暂不可挂");
    return;
  }
  const row = await prisma.post.findUnique({ where: { id: itemId }, select: { status: true } });
  if (!row || row.status === "deleted")
    throw new TopicError("invalid_material", "文章不存在或已删除");
}

// ── 挂载 / 卸载 ───────────────────────────────────────────

export interface MountResult {
  /** false = 本就已挂载(幂等返回,不报错) */
  created: boolean;
  item: TopicItem;
}

/**
 * 幂等挂载(agent mount_material 与人工挂载共用):同 (topic, type, id) 已存在
 * 直接返回既有行;并发双挂由唯一键兜底回读。
 */
export async function mountMaterial(
  topicId: bigint,
  itemType: MaterialKind,
  itemId: bigint,
  note?: string | null,
): Promise<MountResult> {
  const topic = await prisma.topic.findUnique({ where: { id: topicId }, select: { id: true } });
  if (!topic) throw new TopicError("not_found", "专题不存在");
  await assertMaterialExists(itemType, itemId);
  const where = { topicId, itemType, itemId };
  const existing = await prisma.topicItem.findFirst({ where });
  if (existing) return { created: false, item: existing };
  try {
    const item = await prisma.topicItem.create({
      data: { ...where, note: note?.trim() || null },
    });
    return { created: true, item };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const row = await prisma.topicItem.findFirst({ where });
      if (row) return { created: false, item: row };
    }
    throw e;
  }
}

/** 幂等卸载(按素材键):返回是否真删了行(false=本就未挂载) */
export async function unmountMaterial(
  topicId: bigint,
  itemType: MaterialKind,
  itemId: bigint,
): Promise<boolean> {
  const r = await prisma.topicItem.deleteMany({ where: { topicId, itemType, itemId } });
  return r.count > 0;
}

/** 治理台挂载入口(API 口径):重复挂载仍按 409 conflict 报错,不静默吞 */
export async function mountItem(topicId: bigint, input: ItemMountInput): Promise<TopicItem> {
  const r = await mountMaterial(topicId, input.itemType, BigInt(input.itemId), input.note);
  if (!r.created) throw new TopicError("conflict", "该素材已添加,不重复添加");
  return r.item;
}

/** 按挂载行 id 卸载(详情页操作口径) */
export async function unmountItem(topicId: bigint, itemId: bigint): Promise<void> {
  const r = await prisma.topicItem.deleteMany({ where: { id: itemId, topicId } });
  if (r.count === 0) throw new TopicError("not_found", "挂载记录不存在");
}

export async function updateItem(itemId: bigint, patch: ItemUpdateInput): Promise<TopicItem> {
  const row = await prisma.topicItem.findUnique({ where: { id: itemId } });
  if (!row) throw new TopicError("not_found", "挂载记录不存在");
  return prisma.topicItem.update({
    where: { id: itemId },
    data: { note: patch.note, sortOrder: patch.sortOrder },
  });
}

// ── 挂载候选(治理台内嵌选料)──────────────────────────────

/** 电报素材可用口径(M42):已解读视频 / 可见且有内容的文本(搜索与候选同源) */
export const TELEGRAM_ELIGIBLE: Prisma.TelegramWhereInput = {
  OR: [
    { mediaType: "video", aiStatus: "done" },
    { mediaType: "text", status: "visible", summary: { not: "" } },
  ],
};

/** 挂载选料分页大小(详情页内嵌列表,小窗即可) */
export const MOUNT_PAGE_SIZE = 10;

export interface MountCandidates<T> {
  items: T[];
  total: number;
}

/**
 * 电报挂载候选(M42 放开文本):已解读视频 + 可见且有内容的文本;关键词命中
 * 标题/博主/摘要/解读结论;近期解读优先(视频)后按 id 兜底。
 */
export async function listTelegramCandidates(
  q: string | undefined,
  page: number,
): Promise<
  MountCandidates<{
    id: bigint;
    title: string | null;
    mediaType: string;
    summary: string;
    videoBlogger: string | null;
    aiSummary: string | null;
    aiRanAt: Date | null;
  }>
> {
  const where: Prisma.TelegramWhereInput = q
    ? {
        AND: [
          TELEGRAM_ELIGIBLE,
          {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { videoBlogger: { contains: q, mode: "insensitive" } },
              { summary: { contains: q, mode: "insensitive" } },
              { aiSummary: { contains: q, mode: "insensitive" } },
            ],
          },
        ],
      }
    : TELEGRAM_ELIGIBLE;
  const [rows, total] = await prisma.$transaction([
    prisma.telegram.findMany({
      where,
      // 文本素材无 aiRanAt(null);PostgreSQL DESC 缺省 NULLS FIRST 会把整批文本顶到
      // 首页、把新解读的视频挤到末页,故显式 nulls:last,再按发布时间收口
      orderBy: [
        { aiRanAt: { sort: "desc", nulls: "last" } },
        { publishedAt: "desc" },
        { id: "desc" },
      ],
      skip: (page - 1) * MOUNT_PAGE_SIZE,
      take: MOUNT_PAGE_SIZE,
      select: {
        id: true,
        title: true,
        mediaType: true,
        summary: true,
        videoBlogger: true,
        aiSummary: true,
        aiRanAt: true,
      },
    }),
    prisma.telegram.count({ where }),
  ]);
  return { items: rows, total };
}

/** 文章挂载候选:未软删,标题含关键词,近期更新优先 */
export async function listPostCandidates(
  q: string | undefined,
  page: number,
): Promise<MountCandidates<{ id: bigint; title: string; status: string; updatedAt: Date }>> {
  const where: Prisma.PostWhereInput = {
    status: { not: "deleted" },
    ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.post.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * MOUNT_PAGE_SIZE,
      take: MOUNT_PAGE_SIZE,
      select: { id: true, title: true, status: true, updatedAt: true },
    }),
    prisma.post.count({ where }),
  ]);
  return { items: rows, total };
}

// ── 素材聚合视图取数(详情页与 brief 同用)──────────────────

export interface TopicItemMaterial {
  itemType: MaterialKind;
  itemId: bigint;
  telegram: {
    id: bigint;
    title: string | null;
    mediaType: string; // video / text(M42:文本素材)
    summary: string; // 原文 1-3 句(文本素材的写作底料)
    videoBlogger: string | null;
    url: string;
    videoCoverUrl: string | null; // B 站封面(批①合成重构:素材注入封面供写作/CTA)
    aiSummary: string | null;
    aiPoints: unknown; // Json 列(§10 存量兼容),读侧白名单归一(compose 降级拼装用)
    aiNote: string | null;
    aiTopic: string | null;
    aiKeywords: unknown; // Json 列,读侧白名单归一
  } | null;
  post: { id: bigint; title: string; status: string } | null;
}

/** 两批 in 查询水合素材详情(去 N+1;telegram 行缺失/文章已删时置 null 容忍) */
export async function hydrateItems(items: TopicItem[]): Promise<Map<bigint, TopicItemMaterial>> {
  const result = new Map<bigint, TopicItemMaterial>();
  const tgIds = items.filter((i) => i.itemType === "telegram").map((i) => i.itemId);
  const postIds = items.filter((i) => i.itemType === "post").map((i) => i.itemId);
  const [tgRows, postRows] = await Promise.all([
    tgIds.length
      ? prisma.telegram.findMany({
          where: { id: { in: tgIds } },
          select: {
            id: true,
            title: true,
            mediaType: true,
            summary: true,
            videoBlogger: true,
            url: true,
            videoCoverUrl: true,
            aiSummary: true,
            aiPoints: true,
            aiNote: true,
            aiTopic: true,
            aiKeywords: true,
          },
        })
      : Promise.resolve([]),
    postIds.length
      ? prisma.post.findMany({
          where: { id: { in: postIds } },
          select: { id: true, title: true, status: true },
        })
      : Promise.resolve([]),
  ]);
  const tgMap = new Map(tgRows.map((r) => [r.id, r]));
  const postMap = new Map(postRows.map((r) => [r.id, r]));
  for (const item of items) {
    result.set(item.id, {
      itemType: item.itemType as MaterialKind,
      itemId: item.itemId,
      telegram: item.itemType === "telegram" ? (tgMap.get(item.itemId) ?? null) : null,
      post: item.itemType === "post" ? (postMap.get(item.itemId) ?? null) : null,
    });
  }
  return result;
}
