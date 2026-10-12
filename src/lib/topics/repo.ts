/**
 * topic / topic_item 仓储(M26 批①):专题 CRUD、状态机流转、素材挂载与
 * 聚合视图取数。方案锚 docs/plan/topic-pipeline-plan.md §3/§7。
 * 完整性口径:itemId 应用层校验(telegram 须解读完成 aiStatus=done 方可挂,
 * post 须存在且未软删),不设跨域 FK(同 discovery 两表口径)。
 */
import { Prisma, type Topic, type TopicItem } from "@prisma/client";

import { prisma } from "../db";
import { canTransition, type TopicStatus } from "./constants";
import type {
  ItemMountInput,
  ItemUpdateInput,
  TopicCreateInput,
  TopicUpdateInput,
} from "./schemas";

export type TopicErrorCode = "not_found" | "conflict" | "invalid_transition" | "invalid_material";

export class TopicError extends Error {
  constructor(
    readonly code: TopicErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export async function createTopic(input: TopicCreateInput): Promise<Topic> {
  return prisma.topic.create({
    data: { title: input.title, positioning: input.positioning ?? null },
  });
}

export async function deleteTopic(id: bigint): Promise<void> {
  const r = await prisma.topic.deleteMany({ where: { id } });
  if (r.count === 0) throw new TopicError("not_found", "专题不存在");
}

export async function updateTopic(id: bigint, patch: TopicUpdateInput): Promise<Topic> {
  const topic = await prisma.topic.findUnique({ where: { id } });
  if (!topic) throw new TopicError("not_found", "专题不存在");
  return prisma.topic.update({
    where: { id },
    data: {
      title: patch.title,
      positioning: patch.positioning,
      linkedPostId:
        patch.linkedPostId === undefined
          ? undefined
          : patch.linkedPostId === null
            ? null
            : BigInt(patch.linkedPostId),
    },
  });
}

/** 状态流转(方案 §10-7:collecting→drafted 仅由 compose 驱动;published 钩子回写) */
export async function updateTopicStatus(id: bigint, status: TopicStatus): Promise<Topic> {
  const topic = await prisma.topic.findUnique({ where: { id } });
  if (!topic) throw new TopicError("not_found", "专题不存在");
  const from = topic.status as TopicStatus;
  if (from === status) return topic; // 幂等同态
  if (!canTransition(from, status)) {
    throw new TopicError("invalid_transition", `状态不可流转:${from} → ${status}`);
  }
  return prisma.topic.update({ where: { id }, data: { status } });
}

export interface TopicListQuery {
  status?: TopicStatus;
  page?: number;
  pageSize?: number;
}

export type TopicWithCount = Prisma.TopicGetPayload<{
  include: { _count: { select: { items: true } } };
}>;

export async function listTopics(query: TopicListQuery = {}): Promise<{
  items: TopicWithCount[];
  total: number;
}> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 20));
  const where: Prisma.TopicWhereInput = query.status ? { status: query.status } : {};
  const [items, total] = await prisma.$transaction([
    prisma.topic.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { items: true } } },
    }),
    prisma.topic.count({ where }),
  ]);
  return { items, total };
}

export type TopicWithItems = Prisma.TopicGetPayload<{ include: { items: true } }>;

export async function getTopic(id: bigint): Promise<TopicWithItems> {
  const topic = await prisma.topic.findUnique({
    where: { id },
    include: { items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });
  if (!topic) throw new TopicError("not_found", "专题不存在");
  return topic;
}

// ── 素材挂载 ──────────────────────────────────────────────

/** 挂载前置校验(方案 §3):telegram 须解读完成;post 须存在且未软删 */
async function assertMaterialExists(itemType: TopicItemInput["itemType"], itemId: bigint) {
  if (itemType === "telegram") {
    const row = await prisma.telegram.findUnique({
      where: { id: itemId },
      select: { aiStatus: true },
    });
    if (!row) throw new TopicError("invalid_material", "电报条目不存在");
    if (row.aiStatus !== "done")
      throw new TopicError("invalid_material", "该视频尚未解读完成,暂不可挂");
    return;
  }
  const row = await prisma.post.findUnique({ where: { id: itemId }, select: { status: true } });
  if (!row || row.status === "deleted")
    throw new TopicError("invalid_material", "文章不存在或已删除");
}

type TopicItemInput = Pick<ItemMountInput, "itemType">;

export async function mountItem(topicId: bigint, input: ItemMountInput): Promise<TopicItem> {
  const topic = await prisma.topic.findUnique({ where: { id: topicId }, select: { id: true } });
  if (!topic) throw new TopicError("not_found", "专题不存在");
  const itemId = BigInt(input.itemId);
  await assertMaterialExists(input.itemType, itemId);
  try {
    return await prisma.topicItem.create({
      data: {
        topicId,
        itemType: input.itemType,
        itemId,
        note: input.note ?? null,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new TopicError("conflict", "该素材已在本专题内,不重复挂载");
    }
    throw e;
  }
}

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

// ── 列表分段计数 + 挂载候选(批③治理台)──────────────────────

/** 状态分段计数(列表页分段签;键为 status 原值) */
export async function countByStatus(): Promise<Record<string, number>> {
  const rows = await prisma.topic.groupBy({ by: ["status"], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}

/** 挂载选料分页大小(详情页内嵌列表,小窗即可) */
export const MOUNT_PAGE_SIZE = 10;

export interface MountCandidates<T> {
  items: T[];
  total: number;
}

/** 电报流挂载候选:仅解读完成(aiStatus=done)的视频,标题/博主含关键词(忽略
 * 大小写),近期解读优先(方案 §8 挂载交互口径) */
export async function listTelegramCandidates(
  q: string | undefined,
  page: number,
): Promise<
  MountCandidates<{
    id: bigint;
    title: string | null;
    videoBlogger: string | null;
    aiSummary: string | null;
    aiRanAt: Date | null;
  }>
> {
  const where: Prisma.TelegramWhereInput = {
    mediaType: "video",
    aiStatus: "done",
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { videoBlogger: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.telegram.findMany({
      where,
      orderBy: { aiRanAt: "desc" },
      skip: (page - 1) * MOUNT_PAGE_SIZE,
      take: MOUNT_PAGE_SIZE,
      select: {
        id: true,
        title: true,
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

// ── 素材聚合视图取数(批③详情页同用)────────────────────────

export interface TopicItemMaterial {
  itemType: "telegram" | "post";
  itemId: bigint;
  telegram: {
    id: bigint;
    title: string | null;
    videoBlogger: string | null;
    url: string;
    aiSummary: string | null;
    aiNote: string | null;
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
            videoBlogger: true,
            url: true,
            aiSummary: true,
            aiNote: true,
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
      itemType: item.itemType as "telegram" | "post",
      itemId: item.itemId,
      telegram: item.itemType === "telegram" ? (tgMap.get(item.itemId) ?? null) : null,
      post: item.itemType === "post" ? (postMap.get(item.itemId) ?? null) : null,
    });
  }
  return result;
}
