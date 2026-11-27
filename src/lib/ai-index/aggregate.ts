/**
 * AI 智能指数·每日聚合
 *
 * 流程:电报流可见条目 →(未打过分的才打分)→ 评分台账 ai_index_event_score
 *      → 相关性闸 → 净冲击聚合 + 百分位冲击分 → 与 ECI 能力基线合成智能指数
 *      → upsert ai_index_daily
 *
 * 为什么要评分台账:LLM 打分只对**新消息**做一次,之后每天重算指数都读台账。
 * 没有台账的话每天要重打 300 条,既烧配额又让重跑不幂等。
 *
 * 分桶口径:按 UTC 日(与 velocity.ts、ai_index_daily.date 一致),不按北京时。
 */
import { prisma } from "@/lib/db";
import { logInfo } from "@/lib/logger";

import { capabilityBaseForDays } from "./capability";
import {
  scoreNewsItems,
  signedImpact,
  type NewsItem,
  type NewsRelevance,
  type NewsDirection,
  type ScoredNewsItem,
} from "./score";
import { buildImpactSeries, computeAcceleration } from "./velocity";

/** 参与打分的时间窗(天) */
const SCORE_LOOKBACK_DAYS = 30;
/** 单轮取电报条数上限 */
const SCORE_MAX_ITEMS = 500;
/** 单轮打分条数上限:worker 发版 30s 优雅停机会把长任务 SIGKILL,任务必须短;
 * 剩下的条目下一轮继续(台账幂等,kill 无副作用) */
const SCORE_BATCH_LIMIT = 120;
/** 读评分台账的窗口(天):冲击分是滚动 180 天百分位,窗口内的历史要够 */
const SERIES_READ_DAYS = 180;
/** 每轮重算 ai_index_daily 的天数(更早不回头) */
const RECOMPUTE_DAYS = 30;
/** 智能指数 = 能力基线 + 冲击加成(上限 +PULSE_BONUS 分) */
const PULSE_BONUS = 5;

export interface AggregateResult {
  scored: number; // 本轮新打分条数
  pending: number; // 窗口内还没打分且本轮未处理的条数
  cacheTotal: number; // 台账总条数(窗口内)
  days: number; // 重算的日数
  latestDate: string | null;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return isoDay(d);
}

interface TopEvent {
  title: string;
  url: string;
  score: number;
  signed: number;
  dimension: string;
  direction: string;
  relevance: string;
}

function toNewsItem(r: {
  id: bigint;
  title: string | null;
  summary: string;
  aiSummary: string | null;
  url: string | null;
  publishedAt: Date | null;
  source: { name: string } | null;
}): NewsItem {
  return {
    id: r.id.toString(),
    title: r.title ?? r.summary.slice(0, 100),
    summary: r.aiSummary ?? r.summary,
    url: r.url ?? "",
    publishedAt: (r.publishedAt ?? new Date()).toISOString(),
    sourceName: r.source?.name,
  };
}

/** 取电报流里还没打分的条目 */
async function fetchUnscoredItems(): Promise<{ items: NewsItem[]; pending: number }> {
  const since = new Date(`${daysAgoIso(SCORE_LOOKBACK_DAYS)}T00:00:00Z`);
  const rows = await prisma.telegram.findMany({
    where: { status: "visible", publishedAt: { gte: since } },
    select: {
      id: true,
      title: true,
      summary: true,
      aiSummary: true,
      url: true,
      publishedAt: true,
      source: { select: { name: true } },
    },
    orderBy: { publishedAt: "desc" },
    take: SCORE_MAX_ITEMS,
  });
  const items = rows.map(toNewsItem);

  const scored = await prisma.aiIndexEventScore.findMany({
    where: { publishedAt: { gte: since } },
    select: { telegramId: true },
  });
  const done = new Set(scored.map((s) => s.telegramId.toString()));

  const pending = items.filter((i) => !done.has(i.id));
  return { items: pending.slice(0, SCORE_BATCH_LIMIT), pending: pending.length };
}

/** 读评分台账并转回聚合用的打分条目 */
async function readCache(): Promise<ScoredNewsItem[]> {
  const since = new Date(`${daysAgoIso(SERIES_READ_DAYS)}T00:00:00Z`);
  const rows = await prisma.aiIndexEventScore.findMany({
    where: { publishedAt: { gte: since } },
    select: {
      telegramId: true,
      publishedAt: true,
      title: true,
      summary: true,
      sourceName: true,
      url: true,
      impactScore: true,
      confidence: true,
      dimension: true,
      relevance: true,
      direction: true,
      scorer: true,
    },
    orderBy: { publishedAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.telegramId.toString(),
    title: r.title,
    summary: r.summary,
    url: r.url ?? "",
    publishedAt: r.publishedAt.toISOString(),
    sourceName: r.sourceName ?? undefined,
    impactScore: r.impactScore,
    confidence: r.confidence,
    dimension: r.dimension,
    relevance: r.relevance as NewsRelevance,
    direction: r.direction as NewsDirection,
    scorer: r.scorer === "jev" ? "jev" : "rule",
  }));
}

/** 跑一轮每日聚合(打分 → 聚合 → 写日表) */
export async function aggregateAiIndex(): Promise<AggregateResult> {
  const { items, pending } = await fetchUnscoredItems();

  let scoredCount = 0;
  if (items.length > 0) {
    const scored = await scoreNewsItems(items);
    for (const s of scored) {
      await prisma.aiIndexEventScore.upsert({
        where: { telegramId: BigInt(s.id) },
        create: {
          telegramId: BigInt(s.id),
          publishedAt: new Date(s.publishedAt),
          title: s.title.slice(0, 300),
          summary: s.summary,
          sourceName: s.sourceName?.slice(0, 120) ?? null,
          url: s.url === "" ? null : s.url.slice(0, 500),
          impactScore: s.impactScore,
          confidence: s.confidence,
          dimension: s.dimension.slice(0, 20),
          relevance: s.relevance,
          direction: s.direction,
          scorer: s.scorer,
        },
        update: {
          impactScore: s.impactScore,
          confidence: s.confidence,
          dimension: s.dimension.slice(0, 20),
          relevance: s.relevance,
          direction: s.direction,
          scorer: s.scorer,
          scoredAt: new Date(),
        },
      });
      scoredCount += 1;
    }
  }

  const cache = await readCache();
  const relevant = cache.filter((c) => c.relevance !== "other");
  const series = buildImpactSeries(relevant);
  const acceleration = computeAcceleration(series);

  const recomputeFrom = daysAgoIso(RECOMPUTE_DAYS - 1);
  const targets = series.filter((p) => p.date >= recomputeFrom);

  const bases = await capabilityBaseForDays(targets.map((p) => p.date));

  for (let i = 0; i < targets.length; i += 1) {
    const point = targets[i];
    const dayStart = new Date(`${point.date}T00:00:00Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const dayItems = relevant.filter((item) => {
      const d = new Date(item.publishedAt);
      return d >= dayStart && d < dayEnd;
    });

    const topEvents: TopEvent[] = [...dayItems]
      .sort((a, b) => Math.abs(signedImpact(b)) - Math.abs(signedImpact(a)))
      .slice(0, 5)
      .map((item) => ({
        title: item.title,
        url: item.url,
        score: item.impactScore,
        signed: Number(signedImpact(item).toFixed(2)),
        dimension: item.dimension,
        direction: item.direction,
        relevance: item.relevance,
      }));

    const dimensions = dayItems.reduce(
      (acc, item) => {
        acc[item.dimension] = (acc[item.dimension] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const capability = bases.get(point.date) ?? null;
    const impactIndex = point.impactIndex ?? 0;
    const intelligenceIndex =
      capability === null ? 0 : Number((capability + PULSE_BONUS * (impactIndex / 100)).toFixed(2));

    await prisma.aiIndexDaily.upsert({
      where: { date: dayStart },
      create: {
        date: dayStart,
        capability,
        velocity: impactIndex,
        acceleration: acceleration.find((a) => a.date === point.date)?.value ?? 0,
        intelligenceIndex,
        eventCount: point.itemCount,
        topEvents: topEvents as unknown as object,
        dimensions: dimensions as unknown as object,
      },
      update: {
        capability,
        velocity: impactIndex,
        acceleration: acceleration.find((a) => a.date === point.date)?.value ?? 0,
        intelligenceIndex,
        eventCount: point.itemCount,
        topEvents: topEvents as unknown as object,
        dimensions: dimensions as unknown as object,
      },
    });
  }

  const result: AggregateResult = {
    scored: scoredCount,
    pending,
    cacheTotal: cache.length,
    days: targets.length,
    latestDate: targets.length > 0 ? targets[targets.length - 1].date : null,
  };
  logInfo("ai_index.aggregate", { ...result });
  return result;
}
