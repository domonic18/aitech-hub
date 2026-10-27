/**
 * 分发记录读侧(M17 批①:/admin/distribute RSC 直读,免 API 路由。
 * M50 批B 跨载体汇总:publish_channel(文章)与 content_pin_channel(贴图)
 * 读侧 union,行带载体归因;overview 两表合并计数。筛选/分页/reset 批⑤;
 * BigInt 边界转 string。
 */
import { prisma } from "../db";

import { startOfCnDay } from "../datetime";

import { DistributeError } from "./errors";
import type { DistributeCarrier } from "./channels";

/** 记录筛选分段(页码走 ?page=,状态走 ?status=;all 时不带 status 参数) */
export const PUBLISH_RECORD_SEGMENTS = ["all", "synced", "ready", "pending", "failed"] as const;

export interface PublishRecordRow {
  id: string;
  /** 载体归因=行来源表:article→publish_channel,pin→content_pin_channel
   * (wechat 渠道双载体都有,channel 判不了载体,必须看本字段) */
  carrier: DistributeCarrier;
  targetId: string;
  targetTitle: string;
  channel: string;
  status: string;
  /** 公众号草稿锚(贴图行恒 null) */
  mediaId: string | null;
  /** 小红书笔记 URL(公众号行恒 null) */
  publishId: string | null;
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

/** M50 批B:跨载体记录 union。分页为近似——两源各取本页窗口后按 updatedAt
 * 归并截断,跨页边界可能微漂(决策 D2:记录量级 ~千行无感,不做 SQL union)。 */
export async function listDistributeRecords(q: PublishRecordQuery = {}): Promise<{
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
  const skipTake = { skip: (page - 1) * pageSize, take: pageSize };
  const [arts, pins, artTotal, pinTotal] = await Promise.all([
    prisma.publishChannel.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      ...skipTake,
      include: { post: { select: { title: true } } },
    }),
    prisma.contentPinChannel.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      ...skipTake,
      include: { pin: { select: { title: true } } },
    }),
    prisma.publishChannel.count({ where }),
    prisma.contentPinChannel.count({ where }),
  ]);
  const rows: PublishRecordRow[] = [
    ...arts.map((r) => ({
      id: r.id.toString(),
      carrier: "article" as const,
      targetId: r.postId.toString(),
      targetTitle: r.post.title,
      channel: r.channel,
      status: r.status,
      mediaId: r.mediaId,
      publishId: null,
      title: r.title,
      digest: r.digest,
      thumbPath: r.thumbPath,
      attempts: r.attempts,
      lastError: r.lastError,
      syncedAt: r.syncedAt,
      updatedAt: r.updatedAt,
    })),
    ...pins.map((r) => ({
      id: r.id.toString(),
      carrier: "pin" as const,
      targetId: r.pinId.toString(),
      targetTitle: r.pin.title,
      channel: r.channel,
      status: r.status,
      mediaId: null,
      publishId: r.publishId,
      title: null,
      digest: null,
      thumbPath: null,
      attempts: r.attempts,
      lastError: r.lastError,
      syncedAt: r.syncedAt,
      updatedAt: r.updatedAt,
    })),
  ]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, pageSize);
  return { rows, total: artTotal + pinTotal, page, pageSize };
}

/** 近 7 天终态聚合拆分(groupBy 形状两表同构;收纯结果数组,绕开 Prisma
 * 泛型方法的参数逆变不可赋值) */
function split7d(rows: { status: string; _count: { _all: number } }[]): {
  synced7d: number;
  failed7d: number;
} {
  return {
    synced7d: rows.find((r) => r.status === "synced")?._count._all ?? 0,
    failed7d: rows.find((r) => r.status === "failed")?._count._all ?? 0,
  };
}

/**
 * 分发中心总览数(F16 statsRow + 渠道卡 meta;M50 批B 起两表 union):
 * 今日/近 7 天成功率/累计/失败计数与最近一条记录。今日按北京时区零点
 * (startOfCnDay);成功率只看近 7 天终态行(终态以 updatedAt 计,pending
 * 未定不计入分母)。
 */
export interface DistributeOverview {
  todaySynced: number;
  /** 近 7 天 synced/(synced+failed);无终态行 → null(界面显 —) */
  rate7d: number | null;
  totalSynced: number;
  failedCount: number;
  lastRecord: { status: string; syncedAt: Date | null; updatedAt: Date } | null;
}

export async function getDistributeOverview(channel?: string): Promise<DistributeOverview> {
  const since7d = new Date(Date.now() - 7 * 24 * 3_600_000);
  const scope = channel ? { channel } : {};
  const cnDay = startOfCnDay();
  // groupBy 先起 Promise 再并入 Promise.all(泛型方法不抽函数参数,见 split7d 注)
  const a7dP = prisma.publishChannel.groupBy({
    by: ["status"],
    where: { ...scope, status: { in: ["synced", "failed"] }, updatedAt: { gte: since7d } },
    _count: { _all: true },
  });
  const p7dP = prisma.contentPinChannel.groupBy({
    by: ["status"],
    where: { ...scope, status: { in: ["synced", "failed"] }, updatedAt: { gte: since7d } },
    _count: { _all: true },
  });
  const [aToday, a7dRaw, aTotal, aFailed, aLast, pToday, p7dRaw, pTotal, pFailed, pLast] =
    await Promise.all([
      prisma.publishChannel.count({
        where: { ...scope, status: "synced", syncedAt: { gte: cnDay } },
      }),
      a7dP,
      prisma.publishChannel.count({ where: { ...scope, status: "synced" } }),
      prisma.publishChannel.count({ where: { ...scope, status: "failed" } }),
      prisma.publishChannel.findFirst({
        where: scope,
        orderBy: { updatedAt: "desc" },
        select: { status: true, syncedAt: true, updatedAt: true },
      }),
      prisma.contentPinChannel.count({
        where: { ...scope, status: "synced", syncedAt: { gte: cnDay } },
      }),
      p7dP,
      prisma.contentPinChannel.count({ where: { ...scope, status: "synced" } }),
      prisma.contentPinChannel.count({ where: { ...scope, status: "failed" } }),
      prisma.contentPinChannel.findFirst({
        where: scope,
        orderBy: { updatedAt: "desc" },
        select: { status: true, syncedAt: true, updatedAt: true },
      }),
    ]);
  const a7d = split7d(a7dRaw);
  const p7d = split7d(p7dRaw);
  const denom = a7d.synced7d + a7d.failed7d + p7d.synced7d + p7d.failed7d;
  const last = [aLast, pLast]
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime())[0];
  return {
    todaySynced: aToday + pToday,
    rate7d: denom > 0 ? (a7d.synced7d + p7d.synced7d) / denom : null,
    totalSynced: aTotal + pTotal,
    failedCount: aFailed + pFailed,
    lastRecord: last ?? null,
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
