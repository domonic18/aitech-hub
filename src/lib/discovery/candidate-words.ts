/**
 * 词候选治理(F24 板):pending 词卡片流(来源/时间/信号数/相似提示)+
 * 终审动作复用 setKeywordStatus(采纳=active/拒绝=dismissed/合并=merged)+
 * KPI 4 卡。相似度纯函数现算(pending × active,词库量级百行,毫秒级):
 * ≥75% 在卡上提示「与『X』相似 N%」,合并目标即提示词(板定零选择 UI)。
 * 信号数 = 近 30 日 insight_signal 原文含词计数(板「信号 N」口径)。
 */
import { prisma } from "../db";
import { startOfCnDay } from "../datetime";

/** 相似阈值(板 note:相似度 ≥75% 提示合并) */
export const WORD_SIMILAR_THRESHOLD = 0.75;

/** F24 来源筛选下拉(值 = segmentWhere 的 source 参数;label 贴板) */
export const WORD_CANDIDATE_SOURCES = [
  ["", "全部"],
  ["manual", "手动"],
  ["hotwords", "热词发现"],
  ["bili-suggest", "B站发现"],
] as const;

/** 编辑距离(短串 DP;词 ≤100 字符,无性能面) */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i += 1) {
    const curr = [i];
    for (let j = 1; j <= n; j += 1) {
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[n]!;
}

/** 词相似度 0-1:max(包含率, 1 - 编辑距离/较长词长)——中文短词包含即强相似 */
export function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const [lo, hi] = a.length <= b.length ? [a, b] : [b, a];
  const containment = hi.includes(lo) ? lo.length / hi.length : 0;
  const lev = 1 - levenshtein(a, b) / hi.length;
  return Math.max(containment, lev);
}

/** F24 卡来源口径:手动 / B站发现(bili-suggest)/ 热词发现(其余联想源) */
export function candidateOriginLabel(origin: string, source: string | null): string {
  if (origin === "manual") return "手动";
  if (source === "bili-suggest") return "B站发现";
  return "热词发现";
}

export interface WordCandidateCard {
  id: string;
  word: string;
  origin: string;
  source: string | null;
  /** F24 卡 meta 来源行 label(手动 / 热词发现 / B站发现) */
  originLabel: string;
  createdAt: Date;
  /** 近 30 日信号原文含词数(板「信号 N」) */
  signalCount: number;
  /** 相似提示(≥75% 的 active 词中取相似度最高者);无则 null */
  similar: { id: string; word: string; pct: number } | null;
}

export type CandidateWordSegment = "pending" | "active" | "dismissed" | "all";

export interface WordCandidateBoard {
  cards: WordCandidateCard[];
  total: number;
  page: number;
  counts: Record<CandidateWordSegment, number>;
  kpi: {
    pending: number;
    todayNew: number;
    /** 近 7 日终审中采纳占比;无终审样本 → null(界面显 —) */
    adoptRate7d: number | null;
    /** 有相似提示的 pending 词数(相似重复簇) */
    dupClusters: number;
  };
}

const PAGE_SIZE = 8; // F24 板「本页 8 条」
const SIGNAL_WINDOW_DAYS = 30;
const SINCE_7D_MS = 7 * 24 * 3_600_000;

/** 分段 → status 白名单(已拒绝段并入 merged 别名——同为「不再产出」终态);
 *  来源筛选双轨:manual 按 origin,联想按 source 标识 */
function segmentWhere(seg: CandidateWordSegment, source?: string) {
  const status =
    seg === "all"
      ? undefined
      : seg === "pending"
        ? "pending"
        : seg === "active"
          ? "active"
          : { in: ["dismissed", "merged"] };
  const sourceWhere =
    source === "manual"
      ? { origin: "manual" }
      : source === "bili-suggest" || source === "bing-suggest"
        ? { source }
        : source === "hotwords"
          ? { origin: "hotword" }
          : {};
  return {
    ...(status !== undefined ? { status } : {}),
    ...sourceWhere,
  };
}

/** 近 30 日信号含词计数(ILIKE;信号表 30 日窗口先行收窄) */
async function countSignals(word: string, since: Date): Promise<number> {
  return prisma.insightSignal.count({
    where: { signalAt: { gte: since }, rawText: { contains: word, mode: "insensitive" } },
  });
}

/** 待审词的最佳相似提示(active 词中相似度最高且达阈值者) */
function bestSimilar(
  word: string,
  actives: { id: bigint; word: string }[],
): WordCandidateCard["similar"] {
  let best: { id: bigint; word: string; pct: number } | null = null;
  for (const a of actives) {
    const pct = wordSimilarity(word, a.word);
    if (pct >= WORD_SIMILAR_THRESHOLD && (best === null || pct > best.pct)) {
      best = { id: a.id, word: a.word, pct };
    }
  }
  return best === null
    ? null
    : { id: best.id.toString(), word: best.word, pct: Math.round(best.pct * 100) };
}

export async function listWordCandidates(params: {
  segment: CandidateWordSegment;
  page: number;
  /** 来源筛选:F24「来源:全部」下拉(bili-suggest|bing-suggest|manual) */
  source?: string;
}): Promise<WordCandidateBoard> {
  const where = segmentWhere(params.segment, params.source);
  const since30d = new Date(Date.now() - SIGNAL_WINDOW_DAYS * 24 * 3_600_000);
  const [rows, total, grouped, actives, todayNew, judged7d, adopted7d, pendingSample] =
    await Promise.all([
      prisma.discoveryKeyword.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.discoveryKeyword.count({ where }),
      prisma.discoveryKeyword.groupBy({ by: ["status"], _count: { _all: true } }),
      // 相似基准 = 生效词(别名/弃用词不作合并目标)
      prisma.discoveryKeyword.findMany({
        where: { status: "active" },
        select: { id: true, word: true },
      }),
      prisma.discoveryKeyword.count({ where: { createdAt: { gte: startOfCnDay() } } }),
      prisma.discoveryKeyword.count({
        where: {
          status: { in: ["active", "dismissed", "merged"] },
          updatedAt: { gte: new Date(Date.now() - SINCE_7D_MS) },
        },
      }),
      prisma.discoveryKeyword.count({
        where: {
          status: "active",
          updatedAt: { gte: new Date(Date.now() - SINCE_7D_MS) },
        },
      }),
      // 相似簇 KPI 扫全量 pending(卡面之外也计)
      prisma.discoveryKeyword.findMany({
        where: { status: "pending" },
        select: { word: true },
      }),
    ]);
  const byStatus = new Map(grouped.map((g) => [g.status, g._count._all]));
  const activeRows = actives.map((a) => ({ id: a.id, word: a.word }));

  // 相似提示基于全量 active 集现算;信号计数仅当前页词逐个 count
  const signalCounts = await Promise.all(rows.map((r) => countSignals(r.word, since30d)));
  const cards: WordCandidateCard[] = rows.map((r, i) => ({
    id: r.id.toString(),
    word: r.word,
    origin: r.origin,
    source: r.source,
    originLabel: candidateOriginLabel(r.origin, r.source),
    createdAt: r.createdAt,
    signalCount: signalCounts[i] ?? 0,
    similar: bestSimilar(r.word, activeRows),
  }));

  return {
    cards,
    total,
    page: params.page,
    counts: {
      all: [...byStatus.values()].reduce((a, b) => a + b, 0),
      pending: byStatus.get("pending") ?? 0,
      active: byStatus.get("active") ?? 0,
      dismissed: (byStatus.get("dismissed") ?? 0) + (byStatus.get("merged") ?? 0),
    },
    kpi: {
      pending: byStatus.get("pending") ?? 0,
      todayNew,
      adoptRate7d: judged7d > 0 ? adopted7d / judged7d : null,
      dupClusters: pendingSample.filter((p) => bestSimilar(p.word, activeRows) !== null).length,
    },
  };
}
