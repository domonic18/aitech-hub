/**
 * 媒体库读侧查询(M5-b;arch/08-media + arch/05-services §5 media 行):
 * 列表(kind Tab × 引用过滤)、详情抽屉、存储统计、断链清单。
 * 引用状态实时计算(refs+cover 双查,表量级 ~1k 直接聚合);audit 定时任务仅作持久投影。
 */
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { type MediaKind, type MediaRefFilter, MEDIA_LIMITS } from "@/lib/media/media-schema";

export const MEDIA_PAGE_SIZE = MEDIA_LIMITS.pageSize;

/** 引用索引(全库口径,量级 ~1k 行;管理页独享,脏活集中此处):路径 → 引用篇数 */
async function loadRefIndex(): Promise<{ refCount: Map<string, number>; coverSet: Set<string> }> {
  // 只读聚合,Promise.all 并行即可($transaction 数组形态会劣化 groupBy 的重载推导)
  const [refs, covers] = await Promise.all([
    prisma.mediaRef.groupBy({
      by: ["mediaPath"],
      _count: { mediaPath: true },
      orderBy: { mediaPath: "asc" },
    }),
    prisma.post.findMany({ where: { coverPath: { not: null } }, select: { coverPath: true } }),
  ]);
  return {
    refCount: new Map(refs.map((r) => [r.mediaPath, r._count.mediaPath])),
    coverSet: new Set(covers.map((c) => c.coverPath ?? "")),
  };
}

export interface MediaListItem {
  id: string;
  path: string;
  filename: string;
  kind: MediaKind;
  status: string;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  thumbPath: string | null;
  createdAt: Date;
  refCount: number;
  isOrphan: boolean;
}

export interface MediaListResult {
  items: MediaListItem[];
  total: number;
  page: number;
  kind: MediaKind;
  refFilter: MediaRefFilter;
  counts: Record<MediaKind, { all: number; referenced: number; orphan: number }>;
}

/** 媒体库列表:kind Tab × 引用状态过滤 + 文件名/sha1 搜索;引用计数实时计算(refs+cover 双查) */
export async function listMediaAdmin(query: {
  kind: MediaKind;
  refFilter: MediaRefFilter;
  q?: string;
  page: number;
}): Promise<MediaListResult> {
  const live = await prisma.media.findMany({
    where: { deletedAt: null },
    select: { id: true, kind: true, path: true },
  });
  const { refCount, coverSet } = await loadRefIndex();
  const orphanOf = (path: string): boolean => !refCount.has(path) && !coverSet.has(path);

  const counts = {
    image: { all: 0, referenced: 0, orphan: 0 },
    video: { all: 0, referenced: 0, orphan: 0 },
    file: { all: 0, referenced: 0, orphan: 0 },
  } as MediaListResult["counts"];
  for (const row of live) {
    const c = counts[row.kind as MediaKind];
    if (!c) continue;
    c.all += 1;
    if (refCount.has(row.path)) c.referenced += 1;
    else if (!coverSet.has(row.path)) c.orphan += 1;
  }

  const where: Prisma.MediaWhereInput = { deletedAt: null, kind: query.kind };
  if (query.q) {
    where.OR = [{ filename: { contains: query.q } }, { sha1: { contains: query.q } }];
  }
  // 引用过滤以实时口径为准(audit 定时落 status 仅作持久投影;列表不依赖它)
  const kindPaths = live.filter((r) => r.kind === query.kind).map((r) => r.path);
  if (query.refFilter === "referenced") {
    where.path = { in: kindPaths.filter((p) => refCount.has(p)) };
  } else if (query.refFilter === "orphan") {
    where.path = { in: kindPaths.filter((p) => orphanOf(p)) };
  }

  const [rows, total] = await prisma.$transaction([
    prisma.media.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * MEDIA_PAGE_SIZE,
      take: MEDIA_PAGE_SIZE,
    }),
    prisma.media.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id.toString(),
      path: r.path,
      filename: r.filename,
      kind: r.kind as MediaKind,
      status: r.status,
      sizeBytes: r.sizeBytes === null ? null : Number(r.sizeBytes),
      width: r.width,
      height: r.height,
      thumbPath: r.thumbPath,
      createdAt: r.createdAt,
      refCount: refCount.get(r.path) ?? 0,
      isOrphan: orphanOf(r.path),
    })),
    total,
    page: query.page,
    kind: query.kind,
    refFilter: query.refFilter,
    counts,
  };
}

/** 详情抽屉:资产 + 引用方文章(点进即达;软删正文不计) */
export async function getMediaDetail(id: bigint) {
  const media = await prisma.media.findFirst({ where: { id, deletedAt: null } });
  if (!media) return null;
  const refs = await prisma.mediaRef.findMany({
    where: { mediaPath: media.path, post: { status: { not: "deleted" } } },
    select: { post: { select: { id: true, slug: true, title: true, publishedAt: true } } },
    orderBy: { post: { publishedAt: "desc" as const } },
  });
  return { media, refs: refs.map((r) => r.post) };
}

export interface MediaStats {
  kinds: Record<MediaKind, { count: number; bytes: number }>;
  orphanCount: number;
  last30d: { count: number; bytes: number };
}

/** 存储统计卡(arch/08 §3.3;表量级 ~1k,实时聚合即可,audit 任务不做缓存投影) */
export async function mediaStats(): Promise<MediaStats> {
  const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [groups, recent, live, refIndex, covers] = await Promise.all([
    prisma.media.groupBy({
      by: ["kind"],
      where: { deletedAt: null },
      _count: { kind: true },
      _sum: { sizeBytes: true },
      orderBy: { kind: "asc" },
    }),
    prisma.media.aggregate({
      where: { deletedAt: null, createdAt: { gte: since30d } },
      _count: { kind: true },
      _sum: { sizeBytes: true },
    }),
    prisma.media.findMany({
      where: { deletedAt: null },
      select: { path: true },
    }),
    prisma.mediaRef.groupBy({
      by: ["mediaPath"],
      _count: { mediaPath: true },
      orderBy: { mediaPath: "asc" },
    }),
    prisma.post.findMany({ where: { coverPath: { not: null } }, select: { coverPath: true } }),
  ]);
  const refPaths = new Set(refIndex.map((r) => r.mediaPath));
  const coverPaths = new Set(covers.map((c) => c.coverPath ?? ""));
  const orphanCount = live.filter((m) => !refPaths.has(m.path) && !coverPaths.has(m.path)).length;

  const stats: MediaStats = {
    kinds: {
      image: { count: 0, bytes: 0 },
      video: { count: 0, bytes: 0 },
      file: { count: 0, bytes: 0 },
    },
    orphanCount,
    last30d: {
      count: recent._count.kind,
      bytes: Number(recent._sum.sizeBytes ?? 0),
    },
  };
  for (const g of groups) {
    const k = g.kind as MediaKind;
    if (!stats.kinds[k]) continue;
    stats.kinds[k] = { count: g._count.kind, bytes: Number(g._sum.sizeBytes ?? 0) };
  }
  return stats;
}

/** 断链清单(引用了、库/盘里没有;arch/08 §3.2):路径 + 引用方篇数 */
export async function brokenRefs(): Promise<Array<{ path: string; posts: number }>> {
  const refs = await prisma.mediaRef.groupBy({
    by: ["mediaPath"],
    _count: { mediaPath: true },
  });
  if (refs.length === 0) return [];
  const paths = refs.map((r) => r.mediaPath);
  const known = await prisma.media.findMany({
    where: { path: { in: paths }, deletedAt: null, status: { not: "missing" } },
    select: { path: true },
  });
  const knownSet = new Set(known.map((k) => k.path));
  return refs
    .filter((r) => !knownSet.has(r.mediaPath))
    .map((r) => ({ path: r.mediaPath, posts: r._count.mediaPath }))
    .sort((a, b) => b.posts - a.posts);
}
