/**
 * 簇详情附加取数(F25/F26 双形态拆分,W7):核心词频次现算 + 词库/文章交集 +
 * 关联机会簇。与 admin.ts#getInsightClusterDetail 配套,拆文件守 350 行线。
 * 关键词空簇(未打标)各交集恒零,coreWords 空数组。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export interface InsightClusterExtras {
  /** 核心词频次(F25 核心词表):簇成员信号文本命中,近 windowDays 日 vs 前 windowDays 日 */
  coreWords: { word: string; freq: number; prevFreq: number }[];
  /** 簇关键词∩词库(在库词,供「已在词库」态与关联候选 KPI) */
  lexiconWords: string[];
  /** 其中 pending(待审)数 */
  lexiconPending: number;
  /** 已产出文章:published 且标题含任一关键词 */
  producedPosts: number;
  /** 近 30 日成员信号数(F25/F26 共用 KPI) */
  sig30d: number;
  /** 关联机会簇(F26):共享关键词的 hot 簇,按机会分取前 3 */
  relatedHot: { id: string; label: string | null; members: number }[];
}

export async function getInsightClusterExtras(
  id: bigint,
  keywords: string[],
  windowDays: number,
): Promise<InsightClusterExtras> {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  /** 核心词频次:簇成员信号文本命中,近 windowDays 日 vs 前 windowDays 日(零命中词保留 0 行) */
  const CORE_WORD_SQL =
    keywords.length === 0
      ? Promise.resolve([] as { kw: string; freq: bigint; prev: bigint }[])
      : prisma.$queryRaw<{ kw: string; freq: bigint; prev: bigint }[]>`
        SELECT t.kw AS kw,
               count(s.id) FILTER (
                 WHERE s.signal_at >= now() - make_interval(days => ${windowDays}::int)
               ) AS freq,
               count(s.id) FILTER (
                 WHERE s.signal_at >= now() - make_interval(days => ${windowDays * 2}::int)
                   AND s.signal_at < now() - make_interval(days => ${windowDays}::int)
               ) AS prev
        FROM unnest(ARRAY[${Prisma.join(keywords)}]::text[]) AS t(kw)
        JOIN insight_cluster_member m ON m.cluster_id = ${id}::bigint
        LEFT JOIN insight_signal s ON s.id = m.signal_id
             AND position(lower(t.kw) IN lower(s.raw_text)) > 0
        GROUP BY t.kw`;
  const [sig30d, postCount, lexiconRows, coreWordRows] = await Promise.all([
    prisma.insightSignal.count({
      where: { members: { some: { clusterId: id } }, signalAt: { gte: since30 } },
    }),
    prisma.post.count({
      where: {
        status: "published",
        ...(keywords.length > 0
          ? {
              OR: keywords.map((k) => ({ title: { contains: k, mode: "insensitive" as const } })),
            }
          : {}),
      },
    }),
    prisma.discoveryKeyword.findMany({
      where:
        keywords.length > 0
          ? { word: { in: keywords, mode: "insensitive" } }
          : { id: { equals: -1 } }, // 空关键词占位条件(in 空数组 Prisma 抛错)
      select: { word: true, status: true },
    }),
    CORE_WORD_SQL,
  ]);

  // F26 关联机会簇:共享关键词 hot 簇(退热除外),机会分降序取 3,补成员数。
  // keywords 是 Json 列(非 String[]),交集下推用 jsonb ?| 运算符
  const relatedHotRows =
    keywords.length === 0
      ? []
      : await prisma.$queryRaw<{ id: bigint; label: string | null }[]>`
        SELECT id, label FROM insight_cluster
        WHERE kind = 'hot' AND status <> 'fading'
          AND keywords ?| ARRAY[${Prisma.join(keywords)}]::text[]
        ORDER BY score DESC NULLS LAST
        LIMIT 3`;
  const hotIds = relatedHotRows.map((r) => r.id);
  const hotMembers =
    hotIds.length === 0
      ? []
      : await prisma.insightClusterMember.groupBy({
          by: ["clusterId"],
          where: { clusterId: { in: hotIds } },
          _count: { _all: true },
        });
  const memberByCluster = new Map(hotMembers.map((m) => [m.clusterId, m._count._all]));

  return {
    coreWords: coreWordRows.map((r) => ({
      word: r.kw,
      freq: Number(r.freq),
      prevFreq: Number(r.prev),
    })),
    lexiconWords: lexiconRows.map((r) => r.word),
    lexiconPending: lexiconRows.filter((r) => r.status === "pending").length,
    producedPosts: postCount,
    sig30d,
    relatedHot: relatedHotRows.map((r) => ({
      id: r.id.toString(),
      label: r.label,
      members: memberByCluster.get(r.id) ?? 0,
    })),
  };
}
