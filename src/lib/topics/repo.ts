/**
 * topic 仓储(M26 批①;M42 批②素材段迁出至 ./materials):专题 CRUD、状态机
 * 流转与列表分段计数。方案锚 docs/plan/topic-pipeline-plan.md §3/§7。
 * 素材挂载/候选/水合见 ./materials(存在性口径同 discovery 两表无跨域 FK)。
 */
import { Prisma, type Topic } from "@prisma/client";

import { prisma } from "../db";
import { canTransition, type TopicOutputType, type TopicStatus } from "./constants";
import { TopicError } from "./errors";
import type { TopicCreateInput, TopicUpdateInput } from "./schemas";

/** 兼容出口:既有调用方(TopicError 人话映射)仍从 repo 取,实现住 ./errors */
export { TopicError, type TopicErrorCode } from "./errors";

export async function createTopic(input: TopicCreateInput): Promise<Topic> {
  return prisma.topic.create({
    data: {
      title: input.title,
      positioning: input.positioning ?? null,
      // 主意图(M42):缺省 article;贴图意图新建时不预填长文定位
      outputType: input.outputType ?? "article",
      // 服务端派生回写(M39 批②形式绑定),客户端 schema 不收该键
      skillKey: input.skillKey ?? null,
    },
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
      pinPositioning: patch.pinPositioning,
      outputType: patch.outputType,
      skillKey: patch.skillKey,
      linkedPostId:
        patch.linkedPostId === undefined
          ? undefined
          : patch.linkedPostId === null
            ? null
            : BigInt(patch.linkedPostId),
      sampleImageId:
        patch.sampleImageId === undefined
          ? undefined
          : patch.sampleImageId === null
            ? null
            : BigInt(patch.sampleImageId),
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
  /** 主意图过滤(M42 列表 ?output=;缺省不过滤) */
  output?: TopicOutputType;
  /** 标题关键词过滤(v2 列表 ?q=;大小写不敏感 contains) */
  q?: string;
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
  const where: Prisma.TopicWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.output ? { outputType: query.output } : {}),
    ...(query.q ? { title: { contains: query.q, mode: "insensitive" } } : {}),
  };
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

/**
 * 创作状态快照(M44 生成态轮询:裸 select 不 include items,5s 级轮询保持
 * 轻查询);行缺返回 null(生成途中创作被删,轮询侧据此清态)。
 */
export async function getTopicStateSnapshot(
  id: bigint,
): Promise<{ status: string; updatedAt: Date; linkedPostId: bigint | null } | null> {
  return prisma.topic.findUnique({
    where: { id },
    select: { status: true, updatedAt: true, linkedPostId: true },
  });
}

/** 关联文档状态(详情页合成操作区提示口径;行缺返回 null 视为无锚) */
export async function getLinkedPostState(
  postId: bigint,
): Promise<{ status: string; updatedAt: Date } | null> {
  return prisma.post.findUnique({
    where: { id: postId },
    select: { status: true, updatedAt: true },
  });
}

/**
 * 关联文档详情(2026-10-20 验收反馈问题三:「合成完之后怎么走」可视化——
 * 文档状态 + 公众号渠道行快照,合成与文档区状态卡消费)
 */
export async function getLinkedDocDetail(postId: bigint): Promise<{
  title: string;
  status: string;
  wechat: { status: string; syncedAt: Date | null; lastError: string | null } | null;
} | null> {
  const row = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      title: true,
      status: true,
      channels: {
        where: { channel: "wechat" },
        select: { status: true, syncedAt: true, lastError: true },
      },
    },
  });
  if (!row) return null;
  return {
    title: row.title,
    status: row.status,
    wechat: row.channels[0] ?? null,
  };
}

// ── 列表分段计数 ─────────────────────────────────────────

/** 状态分段计数(列表页分段签;键为 status 原值;M42 可叠加主意图口径) */
export async function countByStatus(output?: TopicOutputType): Promise<Record<string, number>> {
  const rows = await prisma.topic.groupBy({
    by: ["status"],
    ...(output ? { where: { outputType: output } } : {}),
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}

/**
 * 创作贴图计数(v2 列表卡进度 chips):content_pin.topic_id 是软引用无 Prisma
 * relation,按 id 集合 groupBy 一次取回,映射 topicId → 贴图数。
 */
export async function pinCountByTopic(ids: bigint[]): Promise<Map<bigint, number>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.contentPin.groupBy({
    by: ["topicId"],
    where: { topicId: { in: ids } },
    _count: { _all: true },
  });
  return new Map(
    rows.flatMap((r) => (r.topicId === null ? [] : [[r.topicId, r._count._all] as const])),
  );
}
