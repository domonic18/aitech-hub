/**
 * 分发记录读侧(M17 批①):/admin/distribute RSC 直读,免 API 路由
 * (变更后 router.refresh() 即刷新)。筛选/分页/reset 批⑤;BigInt 边界转 string。
 */
import { prisma } from "../db";

import { DistributeError } from "./errors";

/** 记录筛选分段(页码走 ?page=,状态走 ?status=;all 时不带 status 参数) */
export const PUBLISH_RECORD_SEGMENTS = ["all", "synced", "pending", "failed"] as const;

export interface PublishRecordRow {
  id: string;
  postId: string;
  postTitle: string;
  channel: string;
  status: string;
  mediaId: string | null;
  title: string | null;
  digest: string | null;
  thumbPath: string | null;
  attempts: number;
  lastError: string | null;
  syncedAt: Date | null;
  updatedAt: Date;
}

export interface PublishRecordQuery {
  channel?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 20;

export async function listPublishChannelRecords(q: PublishRecordQuery = {}): Promise<{
  rows: PublishRecordRow[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, q.pageSize ?? DEFAULT_PAGE_SIZE));
  const where = {
    ...(q.channel ? { channel: q.channel } : {}),
    ...(q.status ? { status: q.status } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.publishChannel.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { post: { select: { title: true } } },
    }),
    prisma.publishChannel.count({ where }),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.id.toString(),
      postId: r.postId.toString(),
      postTitle: r.post.title,
      channel: r.channel,
      status: r.status,
      mediaId: r.mediaId,
      title: r.title,
      digest: r.digest,
      thumbPath: r.thumbPath,
      attempts: r.attempts,
      lastError: r.lastError,
      syncedAt: r.syncedAt,
      updatedAt: r.updatedAt,
    })),
    total,
    page,
    pageSize,
  };
}

/**
 * 清除 media_id 绑定(M17 批⑤):公众号后台草稿被人工删除后 draft/update
 * 报「草稿不存在」,清绑定让下一次同步回落 draft/add 重建。只动 media_id,
 * 状态/快照保留(重新同步沿用既有微调标题/摘要/封面)。
 */
export async function resetRecordBinding(id: bigint): Promise<void> {
  const row = await prisma.publishChannel.findUnique({ where: { id } });
  if (!row) throw new DistributeError("not_found", "同步记录不存在");
  if (row.mediaId === null)
    throw new DistributeError("invalid", "该记录没有 media_id 绑定,无需清除");
  await prisma.publishChannel.update({ where: { id }, data: { mediaId: null } });
}
