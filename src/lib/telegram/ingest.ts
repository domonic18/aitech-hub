/**
 * 电报流入库编排(M7 批③b,arch/02 §3-§4):
 * 每日上限 → 适配器拉取 → content_hash 去重(先查后写,P2002 兜底并发)→
 * 屏蔽词/启发式过滤(命中 hidden + filter_hit 供观测)→ 规则截断摘要 → 落库
 * → 可见新条入轻解读队列(M12 批③ summarize;就绪整轮 resolve 一次)。
 * 来源侧每轮推进 lastRunAt/nextRunAt,连续失败 ≥3 → status=error;
 * 失败上抛交 BullMQ failed 事件(后台采集总览「最近错误」的数据源)。
 */
import { isP2002, prisma } from "../db";
import { logger } from "../logger";
import { CRAWL_JOB_SOURCE, getQueue, QUEUE_CRAWLER } from "../queue";

import { fetchSourceItems, RateLimitedError, type AdapterItem } from "./adapters";
import {
  CRAWL_MAX_CONSECUTIVE_FAILS,
  CRAWL_MAX_ITEMS_PER_RUN,
  CRAWL_SOURCE_STATUS_DEGRADED,
  CRAWL_SOURCE_STATUS_ERROR,
  CRAWL_SOURCE_STATUS_HEALTHY,
  CRAWL_SOURCE_TYPE_SOCIAL_VIDEO,
  TELEGRAM_STATUS_HIDDEN,
  TELEGRAM_STATUS_VISIBLE,
  type BlocklistScope,
} from "./constants";
import {
  matchBlocklist,
  matchHeuristics,
  matchesIncludeKeywords,
  parseIncludeKeywords,
  type BlocklistWord,
  type FilterHit,
} from "./filter";
import { canonicalUrl, contentHash, truncateSummary } from "./normalize";
import { tryConsumeDailyQuota } from "./rate-limit";
import { isSummarizeReady, markPendingAndEnqueueSummarize } from "./summarize-text";

/** 单来源单轮采集结果(worker 日志与后台台账观测字段) */
export interface CrawlOutcome {
  sourceId: number;
  fetched: number;
  /** 可见落库 */
  inserted: number;
  /** 命中过滤以 hidden 落库 */
  filtered: number;
  /** 主题准入不命中跳过(M14:includeKeywords 非空的渠道),不入库 */
  topicSkipped: number;
  /** hash 重复跳过 */
  duplicated: number;
  skippedDailyCap: boolean;
  /** 供应方限频(429)跳过,不记失败 */
  rateLimited: boolean;
}

type IngestVerdict = "inserted" | "filtered" | "duplicated";

function nextRunAt(intervalMin: number, from: Date): Date {
  return new Date(from.getTime() + intervalMin * 60_000);
}

/** 单条入库:去重 → 过滤 → 摘要 → 落库;命中过滤也落库(hidden),供后台观测误杀。
 * 可见新条 + summarize 就绪 → 入轻解读队列(M12 批③;入队失败不拖垮采集轮) */
async function ingestItem(
  sourceId: number,
  item: AdapterItem,
  words: readonly BlocklistWord[],
  summarizeReady: boolean,
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
    const created = await prisma.telegram.create({
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
    if (hit) return "filtered";
    // 可见新条 + summarize 就绪 → 入轻解读队列(pending→入队→回滚由 ai-shared 单点保证;
    // 失败不拖垮采集轮,存量由 ai-backfill-tick 5min 补扫兜底)
    if (summarizeReady) {
      try {
        await markPendingAndEnqueueSummarize(created.id);
      } catch (err) {
        logger.warn({
          event: "crawler.summarize_enqueue_failed",
          telegramId: created.id.toString(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return "inserted";
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
    topicSkipped: 0,
    duplicated: 0,
    skippedDailyCap: false,
    rateLimited: false,
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
    const items = await fetchSourceItems(source.type, source.url, source.config ?? undefined);
    outcome.fetched = items.length;

    const words: BlocklistWord[] = (
      await prisma.blocklist.findMany({
        where: { enabled: true },
        select: { word: true, scope: true },
      })
    ).map((w) => ({ word: w.word, scope: w.scope as BlocklistScope }));
    // 主题准入(M14):全站源经 config.includeKeywords 限定 AI 相关条目才入库,解析一轮
    const includeKeywords = parseIncludeKeywords(source.config);
    // summarize 就绪整轮 resolve 一次(镜像 ingest-video 的 interpretReady,省逐条双查)
    const summarizeReady = await isSummarizeReady();
    for (const item of items.slice(0, CRAWL_MAX_ITEMS_PER_RUN)) {
      // 主题外直接跳过(查重/落库都不做;观测走 topicSkipped 计数)
      if (!matchesIncludeKeywords(item.title, item.summaryCandidate ?? "", includeKeywords)) {
        outcome.topicSkipped += 1;
        continue;
      }
      outcome[await ingestItem(source.id, item, words, summarizeReady)] += 1;
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
    // 供应方限频(如机器之心免费档 1 次/60min):非渠道故障,不记失败只顺延
    if (err instanceof RateLimitedError) {
      await prisma.crawlSource.update({
        where: { id: source.id },
        data: { lastRunAt: now, nextRunAt: nextRunAt(source.crawlIntervalMin, now) },
      });
      outcome.rateLimited = true;
      logger.warn({ event: "crawler.rate_limited", sourceId: source.id, name: source.name });
      return outcome;
    }
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

/** worker「tick」入口(每 60s):扫描到期来源逐源入队,失败隔离在单源 job。
 * 平台行(type=social-video)自身不调度——Cookie 池/开关载体,视频博主扫
 * social_account 走 ingest-video#enqueueDueVideoAccounts(worker tick 同拍调)。 */
export async function crawlDueSources(): Promise<{ due: number }> {
  const due = await prisma.crawlSource.findMany({
    where: {
      enabled: true,
      type: { not: CRAWL_SOURCE_TYPE_SOCIAL_VIDEO },
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }],
    },
    select: { id: true, nextRunAt: true },
    orderBy: { id: "asc" },
  });
  const queue = getQueue(QUEUE_CRAWLER);
  for (const source of due) {
    // jobId 锚定到期时刻:同源同轮重复入队被 BullMQ 幂等挡掉
    await queue.add(
      CRAWL_JOB_SOURCE,
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
