/**
 * 电报流入库编排(M7 批③b,arch/02 §3-§4):
 * 每日上限 → 适配器拉取 → content_hash 去重(先查后写,P2002 兜底并发)→
 * 屏蔽词/启发式过滤(命中 hidden + filter_hit 供观测)→ 规则截断摘要 → 落库。
 * 来源侧每轮推进 lastRunAt/nextRunAt,连续失败 ≥3 → status=error;
 * 失败上抛交 BullMQ failed 事件(后台采集总览「最近错误」的数据源)。
 */
import { isP2002, prisma } from "../db";
import { logger } from "../logger";
import { getQueue, QUEUE_CRAWLER } from "../queue";

import { fetchSourceItems, type AdapterItem } from "./adapters";
import {
  CRAWL_MAX_CONSECUTIVE_FAILS,
  CRAWL_MAX_ITEMS_PER_RUN,
  CRAWL_SOURCE_STATUS_DEGRADED,
  CRAWL_SOURCE_STATUS_ERROR,
  CRAWL_SOURCE_STATUS_HEALTHY,
  TELEGRAM_STATUS_HIDDEN,
  TELEGRAM_STATUS_VISIBLE,
  type BlocklistScope,
} from "./constants";
import { matchBlocklist, matchHeuristics, type BlocklistWord, type FilterHit } from "./filter";
import { canonicalUrl, contentHash, truncateSummary } from "./normalize";
import { tryConsumeDailyQuota } from "./rate-limit";

/** 单来源单轮采集结果(worker 日志与后台台账观测字段) */
export interface CrawlOutcome {
  sourceId: number;
  fetched: number;
  /** 可见落库 */
  inserted: number;
  /** 命中过滤以 hidden 落库 */
  filtered: number;
  /** hash 重复跳过 */
  duplicated: number;
  skippedDailyCap: boolean;
}

type IngestVerdict = "inserted" | "filtered" | "duplicated";

function nextRunAt(intervalMin: number, from: Date): Date {
  return new Date(from.getTime() + intervalMin * 60_000);
}

/** 单条入库:去重 → 过滤 → 摘要 → 落库;命中过滤也落库(hidden),供后台观测误杀 */
async function ingestItem(
  sourceId: number,
  item: AdapterItem,
  words: readonly BlocklistWord[],
): Promise<IngestVerdict> {
  const url = canonicalUrl(item.url);
  const hash = contentHash(item.title, url);

  const exists = await prisma.telegram.findUnique({
    where: { contentHash: hash },
    select: { id: true },
  });
  if (exists) return "duplicated";

  const summary = truncateSummary(item.summaryCandidate || item.title);
  const hit: FilterHit | null =
    matchBlocklist(item.title, summary, words) ??
    matchHeuristics(item.title, item.summaryCandidate);

  try {
    await prisma.telegram.create({
      data: {
        sourceId,
        title: item.title,
        summary,
        url,
        publishedAt: item.publishedAt,
        contentHash: hash,
        status: hit ? TELEGRAM_STATUS_HIDDEN : TELEGRAM_STATUS_VISIBLE,
        filterHit: hit?.rule ?? null,
      },
      select: { id: true },
    });
    return hit ? "filtered" : "inserted";
  } catch (err) {
    if (isP2002(err)) return "duplicated"; // 并发轮次抢先落库
    throw err;
  }
}

/** 单来源采集一轮(worker「crawl」job 入口);来源不存在/停用直接空结果 */
export async function crawlSource(sourceId: number): Promise<CrawlOutcome> {
  const source = await prisma.crawlSource.findUnique({ where: { id: sourceId } });
  const outcome: CrawlOutcome = {
    sourceId,
    fetched: 0,
    inserted: 0,
    filtered: 0,
    duplicated: 0,
    skippedDailyCap: false,
  };
  if (!source || !source.enabled) return outcome;

  const now = new Date();

  // 每日上限:超限只顺延本轮不计失败(护栏非错误;计数已 INCR,多计 1 次无碍)
  if (source.dailyMaxRequests != null) {
    const allowed = await tryConsumeDailyQuota(source.id, source.dailyMaxRequests);
    if (!allowed) {
      outcome.skippedDailyCap = true;
      await prisma.crawlSource.update({
        where: { id: source.id },
        data: { lastRunAt: now, nextRunAt: nextRunAt(source.crawlIntervalMin, now) },
      });
      logger.warn({ event: "crawler.daily_cap_skip", sourceId: source.id, name: source.name });
      return outcome;
    }
  }

  try {
    const items = await fetchSourceItems(source.type, source.url);
    outcome.fetched = items.length;

    const words: BlocklistWord[] = (
      await prisma.blocklist.findMany({
        where: { enabled: true },
        select: { word: true, scope: true },
      })
    ).map((w) => ({ word: w.word, scope: w.scope as BlocklistScope }));
    for (const item of items.slice(0, CRAWL_MAX_ITEMS_PER_RUN)) {
      outcome[await ingestItem(source.id, item, words)] += 1;
    }

    await prisma.crawlSource.update({
      where: { id: source.id },
      data: {
        lastRunAt: now,
        nextRunAt: nextRunAt(source.crawlIntervalMin, now),
        consecutiveFails: 0,
        status: CRAWL_SOURCE_STATUS_HEALTHY,
      },
    });
    return outcome;
  } catch (err) {
    const fails = source.consecutiveFails + 1;
    await prisma.crawlSource.update({
      where: { id: source.id },
      data: {
        lastRunAt: now,
        nextRunAt: nextRunAt(source.crawlIntervalMin, now),
        consecutiveFails: fails,
        status:
          fails >= CRAWL_MAX_CONSECUTIVE_FAILS
            ? CRAWL_SOURCE_STATUS_ERROR
            : CRAWL_SOURCE_STATUS_DEGRADED,
      },
    });
    throw err;
  }
}

/** worker「tick」入口(每 60s):扫描到期来源逐源入队,失败隔离在单源 job */
export async function crawlDueSources(): Promise<{ due: number }> {
  const due = await prisma.crawlSource.findMany({
    where: {
      enabled: true,
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }],
    },
    select: { id: true, nextRunAt: true },
    orderBy: { id: "asc" },
  });
  const queue = getQueue(QUEUE_CRAWLER);
  for (const source of due) {
    // jobId 锚定到期时刻:同源同轮重复入队被 BullMQ 幂等挡掉
    await queue.add(
      "crawl",
      { sourceId: source.id },
      {
        jobId: `crawl-${source.id}-${source.nextRunAt?.getTime() ?? 0}`,
        removeOnComplete: 200,
        removeOnFail: 200,
      },
    );
  }
  return { due: due.length };
}
