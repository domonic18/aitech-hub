/**
 * 洞察批③ 渠道视图读侧(方案 §3→§6):今日热榜(每个热榜源取最新拉取批的
 * 榜面)+ 关键词云(在役已打标簇关键词按机会分加权)。与 admin.ts 分文件
 * 收敛(350 行纪律);独立于 admin 读侧白名单过滤——热榜源天然只在役白名单。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

import { INSIGHT_SOURCES_ENABLED, type InsightSource } from "./ingest";

/** 热榜源(白名单内 hot-* 前缀;展示顺序=白名单序) */
const HOT_SOURCES = [...INSIGHT_SOURCES_ENABLED].filter((s) => s.startsWith("hot-"));

export interface InsightHotItem {
  rank: number;
  title: string;
  heat: number | null;
  url: string | null;
  /** 名次变动 vs 上一拉取批:正=↑n,负=↓n,0=持平,null=新上榜(无前批或前批未上榜) */
  move: number | null;
}

export interface InsightHotSourceBoard {
  source: InsightSource;
  /** 该源最新一批拉取时间(榜面新鲜度展示) */
  fetchedAt: string | null;
  items: InsightHotItem[];
}

interface BoardRow {
  id: bigint;
  source: string;
  ref_id: string;
  rank: number;
  title: string;
  heat: number | null;
  url: string | null;
  signal_at: Date;
}

interface PrevRankRow {
  source: string;
  ref_id: string;
  rank: number;
}

/**
 * 今日热榜:每源取 meta.batch(拉取轮时间戳)最新一批的全部条目,按 rank 升序,
 * 并对齐各源上一批的名次算变动(move)。batch/heat/url 存 meta JSONB;出榜条目
 * batch 停留在旧轮,内连接自然排除。无拉取记录(首轮前/源失败)返回空榜面。
 */
export async function latestHotBoard(): Promise<InsightHotSourceBoard[]> {
  const [rows, prevRows] = await Promise.all([
    prisma.$queryRaw<BoardRow[]>`
      SELECT s.id, s.source, s.ref_id,
             (s.meta->>'rank')::int AS rank,
             s.raw_text AS title,
             (s.meta->>'heat')::float8 AS heat,
             s.meta->>'url' AS url,
             s.signal_at
        FROM insight_signal s
        JOIN (
          SELECT source, max((meta->>'batch')::bigint) AS batch
            FROM insight_signal
           WHERE source IN (${Prisma.join(HOT_SOURCES)}) AND meta->>'batch' IS NOT NULL
           GROUP BY source
        ) b ON b.source = s.source AND (s.meta->>'batch')::bigint = b.batch
       ORDER BY s.source, rank
    `,
    // 上一拉取批名次(每源取 < 最新批的次新批;无次新批的源自然无行)
    prisma.$queryRaw<PrevRankRow[]>`
      SELECT s.source, s.ref_id, (s.meta->>'rank')::int AS rank
        FROM insight_signal s
        JOIN (
          SELECT c.source,
                 (SELECT max((meta->>'batch')::bigint)
                    FROM insight_signal
                   WHERE source = c.source AND meta->>'batch' IS NOT NULL
                     AND (meta->>'batch')::bigint < c.batch) AS prev
            FROM (
              SELECT source, max((meta->>'batch')::bigint) AS batch
                FROM insight_signal
               WHERE source IN (${Prisma.join(HOT_SOURCES)}) AND meta->>'batch' IS NOT NULL
               GROUP BY source
            ) c
        ) b ON b.prev IS NOT NULL
           AND s.source = b.source
           AND (s.meta->>'batch')::bigint = b.prev
    `,
  ]);

  const prevRank = new Map(prevRows.map((r) => [`${r.source}|${r.ref_id}`, r.rank]));
  const bySource = new Map<string, BoardRow[]>(HOT_SOURCES.map((s) => [s, []]));
  for (const row of rows) bySource.get(row.source)?.push(row);
  return HOT_SOURCES.map((source) => {
    const items = bySource.get(source) ?? [];
    const fetchedAt = items.reduce<Date | null>(
      (acc, it) => (acc === null || it.signal_at > acc ? it.signal_at : acc),
      null,
    );
    return {
      source: source as InsightSource,
      fetchedAt: fetchedAt?.toISOString() ?? null,
      items: items
        .map((it) => {
          const prev = prevRank.get(`${source}|${it.ref_id}`);
          return {
            rank: it.rank,
            title: it.title,
            heat: it.heat,
            url: it.url,
            move: prev === undefined ? null : prev - it.rank,
          };
        })
        .sort((a, b) => a.rank - b.rank),
    };
  });
}

// ── 关键词云(在役已打标簇)────────────────────────────────────────────

export interface InsightCloudWord {
  word: string;
  /** 权重=来源簇机会分(0-100;同词多簇取最高,避免跨簇热门词重复计权) */
  weight: number;
  clusterId: string;
  label: string;
}

const CLOUD_WINDOW_DAYS = 7;
const CLOUD_MAX_WORDS = 40;
/** 单字关键词无语义区分度(「AI」「热」),与聚类最短文本取向一致 */
const CLOUD_MIN_WORD_LEN = 2;
/** 候选簇取数上限(机会分降序,云图只反映头部簇;防长尾拖查询) */
const CLOUD_CLUSTER_TAKE = 60;

/**
 * 关键词云:近 windowDays 活跃、已打标、未关停的簇,keywords 摊平按簇机会分
 * 计权。未打标(需「洞察归纳」模型)或零活跃簇时返回空,渲染侧给引导。
 */
export async function insightKeywordCloud(
  opts: { windowDays?: number; limit?: number } = {},
): Promise<InsightCloudWord[]> {
  const windowDays = opts.windowDays ?? CLOUD_WINDOW_DAYS;
  const clusters = await prisma.insightCluster.findMany({
    where: {
      label: { not: null },
      status: { not: "closed" },
      lastSeenAt: { gte: new Date(Date.now() - windowDays * 86_400_000) },
    },
    orderBy: [{ score: { sort: "desc", nulls: "last" } }, { lastSeenAt: "desc" }],
    take: CLOUD_CLUSTER_TAKE,
    select: { id: true, label: true, keywords: true, score: true },
  });

  const byWord = new Map<string, InsightCloudWord>();
  for (const c of clusters) {
    if (c.score === null || c.label === null) continue;
    const keywords = Array.isArray(c.keywords)
      ? c.keywords.filter((k): k is string => typeof k === "string")
      : [];
    for (const raw of keywords) {
      const word = raw.trim();
      if (word.length < CLOUD_MIN_WORD_LEN) continue;
      const prev = byWord.get(word);
      if (prev === undefined || c.score > prev.weight) {
        byWord.set(word, { word, weight: c.score, clusterId: c.id.toString(), label: c.label });
      }
    }
  }
  return [...byWord.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, opts.limit ?? CLOUD_MAX_WORDS);
}
