/**
 * 热点簇只读读侧(M71,K3 复活,arch/04 §3.6):按领域 × 趋势分级给外部智能体
 * 「当前什么在爆发/上升」,并带上簇内的主要新闻条目(标题 + 原文链 + 摘要)。
 *
 * 与 admin 侧的关系:趋势分级与双窗口径复用 `listClusterTrends`(不另起一套
 * 阈值,否则两处分级会漂);admin 读侧还带覆盖度/矩阵/事件等治理维度,这里
 * 只取对外必要字段,不污染 admin service。
 *
 * 趋势口径:热度 = 窗口内在役源信号数;tier 由双窗增长率判定
 * (new/breakout/rising/flat/declining,见 trend.ts#tierOf)。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "../db";

import { listClusterTrends, TREND_TIER_LABELS, type TrendTier } from "./trend";

/** 源标识:电报 AI 解读信号(refId = telegram 行 id,可回连原文链) */
const TELEGRAM_SIGNAL_SOURCE = "telegram-ai";

/** 默认只出「热」档(新晋/爆发/上升)——需求要的正是这档;flat/declining
 *  由调用方显式要 tier 时才出 */
const DEFAULT_TIERS: TrendTier[] = ["new", "breakout", "rising"];

/** 单簇带出的新闻条目上限(输出体量封顶;条目多时取最近的) */
export const HOT_TOPIC_ITEMS_MAX = 8;

const HOT_TOPIC_LIMIT_MAX = 30;

export interface HotTopicItem {
  signalId: string;
  source: string;
  /** 条目标题(电报条取行标题;其余源取 meta.title,再回落正文首句) */
  title: string;
  /** 原文链(telegram 条回连行 url;热榜信号取 meta.url) */
  url: string | null;
  /** 正文摘录(截断) */
  excerpt: string;
  signalAt: string;
  /** 关联电报条目 id(源为 telegram-ai 时;可据此调 get_telegram_item 取全量元数据) */
  telegramId: string | null;
}

export interface HotTopic {
  clusterId: string;
  /** 簇标签(LLM 命名;未打标为 null) */
  label: string | null;
  /** 簇一句话概括 */
  summary: string | null;
  domain: string;
  /** 领域下的子域(取自成员信号;多值) */
  subdomains: string[];
  kind: string;
  tier: TrendTier;
  /** 趋势中文徽章(🆕 新晋 / 🚀 爆发 / 📈 上升 …) */
  tierLabel: string;
  /** 增长率(近窗 vs 前窗信号数之差) */
  growth: number;
  /** 近窗 / 前窗信号数 */
  recent: number;
  prior: number;
  /** 机会分(榜单排序依据;未计分为 null) */
  score: number | null;
  keywords: string[];
  /** 簇内主要新闻条目 */
  items: HotTopicItem[];
}

export interface ListHotTopicsOptions {
  /** 领域过滤(tech / finance …;缺省全量) */
  domain?: string;
  /** 趋势档过滤(缺省 new/breakout/rising 三档) */
  tiers?: TrendTier[];
  /** 簇类型(缺省 hot;痛点榜用 pain) */
  kind?: "hot" | "pain";
  /** 簇条数上限 */
  limit?: number;
  /** 趋势窗口天数(缺省 7) */
  windowDays?: number;
  /** 单簇条目上限 */
  itemsPerTopic?: number;
}

/** 摘录截断长度(原文摘要不长,足够 agent 判断是否取全文) */
const EXCERPT_MAX = 200;

/** meta 里可能带标题/原文链的键(meta 是 Json,逐源形状不一) */
interface SignalMeta {
  title?: unknown;
  url?: unknown;
}

function metaTitle(meta: unknown): string | null {
  if (meta === null || typeof meta !== "object") return null;
  const t = (meta as SignalMeta).title;
  return typeof t === "string" && t.trim() !== "" ? t.trim() : null;
}

function metaUrl(meta: unknown): string | null {
  if (meta === null || typeof meta !== "object") return null;
  const u = (meta as SignalMeta).url;
  return typeof u === "string" && u.trim() !== "" ? u.trim() : null;
}

/** 正文首句兜底作标题(信号原文多为一句摘要) */
function excerptOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX)}…` : flat;
}

/**
 * 热点簇列表:域 × 趋势档 → 簇 + 簇内主要新闻条目。
 * 分两步:①复用 listClusterTrends 取分级/增长/机会分;②按选中簇取成员信号
 * (每簇最近 N 条,窗口函数 row_number 分区截断)。
 */
export async function listHotTopics(opts: ListHotTopicsOptions = {}): Promise<HotTopic[]> {
  const kind = opts.kind ?? "hot";
  const tiers = opts.tiers ?? DEFAULT_TIERS;
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), HOT_TOPIC_LIMIT_MAX);
  const perTopic = Math.min(Math.max(opts.itemsPerTopic ?? 5, 1), HOT_TOPIC_ITEMS_MAX);

  const trends = await listClusterTrends(opts.windowDays ?? undefined, opts.domain);
  const picked = trends
    .filter((t) => t.kind === kind && tiers.includes(t.tier))
    .sort((a, b) => {
      // 机会分降序;同分看增长快慢(爆发优先于缓升)
      const sa = a.score ?? -1;
      const sb = b.score ?? -1;
      if (sb !== sa) return sb - sa;
      return b.growth - a.growth;
    })
    .slice(0, limit);
  if (picked.length === 0) return [];

  const clusterIds = picked.map((t) => t.clusterId);
  const [clusterRows, signals] = await Promise.all([
    prisma.insightCluster.findMany({
      where: { id: { in: clusterIds } },
      select: { id: true, domain: true, summary: true, keywords: true },
    }),
    memberSignals(clusterIds, perTopic),
  ]);

  const clusterById = new Map(clusterRows.map((c) => [c.id, c]));
  // 电报条回连:信号 refId = telegram 行 id,取行补原文链与标题
  const tgIds = [
    ...new Set(
      signals
        .filter((s) => s.source === TELEGRAM_SIGNAL_SOURCE)
        .map((s) => s.ref_id)
        .filter((r) => /^\d+$/.test(r)),
    ),
  ];
  const telegramById = new Map(
    (
      await prisma.telegram.findMany({
        where: { id: { in: tgIds.map(BigInt) } },
        select: { id: true, title: true, summary: true, aiSummary: true, url: true },
      })
    ).map((t) => [t.id.toString(), t]),
  );

  const byCluster = new Map<bigint, typeof signals>();
  for (const s of signals) {
    const arr = byCluster.get(s.cluster_id) ?? [];
    arr.push(s);
    byCluster.set(s.cluster_id, arr);
  }

  return picked.map((t) => {
    const c = clusterById.get(t.clusterId);
    const rows = byCluster.get(t.clusterId) ?? [];
    const subdomains = [
      ...new Set(rows.map((r) => r.subdomain).filter((s): s is string => Boolean(s))),
    ];
    return {
      clusterId: t.clusterId.toString(),
      label: t.label,
      summary: c?.summary ?? null,
      domain: c?.domain ?? "tech",
      subdomains,
      kind: t.kind,
      tier: t.tier,
      tierLabel: TREND_TIER_LABELS[t.tier],
      growth: t.growth,
      recent: t.recent,
      prior: t.prior,
      score: t.score,
      keywords: Array.isArray(c?.keywords)
        ? c.keywords.filter((k): k is string => typeof k === "string")
        : [],
      items: rows.map((s) => toItem(s, telegramById.get(s.ref_id))),
    };
  });
}

interface MemberSignalRow {
  cluster_id: bigint;
  id: bigint;
  source: string;
  ref_id: string;
  raw_text: string;
  normalized_text: string;
  meta: unknown;
  signal_at: Date;
  subdomain: string | null;
}

/** 簇内成员信号(每簇最近 N 条;窗口函数分区截断,一次查询) */
async function memberSignals(clusterIds: bigint[], perTopic: number): Promise<MemberSignalRow[]> {
  return prisma.$queryRaw<MemberSignalRow[]>`
    SELECT * FROM (
      SELECT m.cluster_id,
             s.id,
             s.source,
             s.ref_id,
             s.raw_text,
             s.normalized_text,
             s.meta,
             s.signal_at,
             s.subdomain,
             row_number() OVER (PARTITION BY m.cluster_id ORDER BY s.signal_at DESC) AS rn
        FROM insight_cluster_member m
        JOIN insight_signal s ON s.id = m.signal_id
       WHERE m.cluster_id IN (${Prisma.join(clusterIds)})
    ) t
    WHERE t.rn <= ${perTopic}
    ORDER BY t.cluster_id, t.signal_at DESC`;
}

/** 信号 → 条目投影(电报条优先用行标题/原文链) */
function toItem(
  s: MemberSignalRow,
  tg: { title: string | null; summary: string; aiSummary: string | null; url: string } | undefined,
): HotTopicItem {
  const text = s.normalized_text || s.raw_text;
  const title = tg?.title ?? metaTitle(s.meta) ?? excerptOf(text);
  const url = tg?.url ?? metaUrl(s.meta);
  const excerpt = tg ? (tg.aiSummary ?? tg.summary) : text;
  return {
    signalId: s.id.toString(),
    source: s.source,
    title,
    url,
    excerpt: excerptOf(excerpt),
    signalAt: s.signal_at.toISOString(),
    telegramId: s.source === TELEGRAM_SIGNAL_SOURCE ? s.ref_id : null,
  };
}
