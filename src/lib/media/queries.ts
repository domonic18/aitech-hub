/**
 * 媒体库读侧查询(M5-b;arch/08-media + arch/05-services §5 media 行):
 * 列表(kind Tab × 引用过滤)、详情抽屉、存储统计、断链清单。
 * 引用状态实时计算(refs+cover 双查,表量级 ~1k 直接聚合);audit 定时任务仅作持久投影,
 * 两侧引用口径共用 loadRefIndex / loadReferencedPathSet(评审 W5:单源)。
 */
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  type MediaKind,
  type MediaRefFilter,
  type MediaStatus,
  DAY_MS,
  MEDIA_LIMITS,
} from "@/lib/media/media-schema";

export const MEDIA_PAGE_SIZE = MEDIA_LIMITS.pageSize;

/** 引用索引(全库口径,量级 ~1k 行;列表与统计共用,孤儿口径单源——评审 W5):路径 → 引用篇数 */
export async function loadRefIndex(): Promise<{
  refCount: Map<string, number>;
  coverSet: Set<string>;
}> {
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

/** 被引用路径全集(正文引用 ∪ 封面;audit 判定与读侧同源,评审 W5) */
export async function loadReferencedPathSet(): Promise<Set<string>> {
  const [refs, covers] = await Promise.all([
    prisma.mediaRef.findMany({ select: { mediaPath: true } }),
    prisma.post.findMany({ where: { coverPath: { not: null } }, select: { coverPath: true } }),
  ]);
  const paths = new Set(refs.map((r) => r.mediaPath));
  for (const c of covers) if (c.coverPath) paths.add(c.coverPath);
  return paths;
}

export interface MediaListItem {
  id: string;
  path: string;
  filename: string;
  kind: MediaKind;
  status: MediaStatus;
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
      status: r.status as MediaStatus,
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

/** 存储统计卡(arch/08 §3.3;表量级 ~1k,实时聚合即可;引用口径复用 loadRefIndex——评审 W5) */
export async function mediaStats(): Promise<MediaStats> {
  const since30d = new Date(Date.now() - 30 * DAY_MS);
  const [groups, recent, live, refIndex] = await Promise.all([
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
    loadRefIndex(),
  ]);
  const orphanCount = live.filter(
    (m) => !refIndex.refCount.has(m.path) && !refIndex.coverSet.has(m.path),
  ).length;

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

export interface MediaDupeItem {
  id: string;
  path: string;
  filename: string;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  thumbPath: string | null;
  createdAt: Date;
  refCount: number;
  coverCount: number;
}

export interface MediaDupeGroup {
  sha1: string;
  /** 组内保留项(最早一条);合并即引用改指它 */
  keeperId: string;
  items: MediaDupeItem[];
  /** 可释放字节(非 keeper 副本体积合计,展示用) */
  releasableBytes: number;
}

/** sha1 重复分组(原型 admin-media「重复检测(同 sha1 分组)」;2026-10-06 验收反馈
 * 问题1:表量级 ~1k 实时聚合,与 mediaStats 同口径):同 sha1 未软删 ≥2 条即一组,
 * keeper 取组内最早;合并动作见 service.ts mergeDupeGroup。 */
export async function listDupeGroups(): Promise<MediaDupeGroup[]> {
  const rows = await prisma.media.findMany({
    where: { deletedAt: null, sha1: { not: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const bySha1 = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = bySha1.get(r.sha1!) ?? [];
    list.push(r);
    bySha1.set(r.sha1!, list);
  }
  const dupeRows = [...bySha1.values()].filter((g) => g.length >= 2);
  if (dupeRows.length === 0) return [];
  const paths = dupeRows.flat().map((r) => r.path);
  const [refs, covers] = await Promise.all([
    prisma.mediaRef.groupBy({
      by: ["mediaPath"],
      where: { mediaPath: { in: paths } },
      _count: { mediaPath: true },
    }),
    prisma.post.groupBy({
      by: ["coverPath"],
      where: { coverPath: { in: paths } },
      _count: { _all: true },
    }),
  ]);
  const refCount = new Map(refs.map((g) => [g.mediaPath, g._count.mediaPath]));
  const coverCount = new Map(
    covers.filter((g) => g.coverPath !== null).map((g) => [g.coverPath as string, g._count._all]),
  );
  return dupeRows.map((group) => ({
    sha1: group[0]!.sha1!,
    keeperId: group[0]!.id.toString(),
    items: group.map((r) => ({
      id: r.id.toString(),
      path: r.path,
      filename: r.filename,
      sizeBytes: r.sizeBytes === null ? null : Number(r.sizeBytes),
      width: r.width,
      height: r.height,
      thumbPath: r.thumbPath,
      createdAt: r.createdAt,
      refCount: refCount.get(r.path) ?? 0,
      coverCount: coverCount.get(r.path) ?? 0,
    })),
    releasableBytes: group.slice(1).reduce((sum, r) => sum + Number(r.sizeBytes ?? 0), 0),
  }));
}
