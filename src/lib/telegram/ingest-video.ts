/**
 * 视频采集编排(M8 批②,arch/02 §3.2 前置批):
 * 平台行取 jar 池 → 适配器 listing → 增量地板(publishedAt > last_post_at,
 * 首采回填窗口限条)→ content_hash 去重 → 屏蔽词/启发式 → 视频 shell 落库
 * (media_type=video,降级可见)→ 解读就绪则入 interpreter 队列(M9)→ 推进博主地板与调度。
 * 失败归因:网关不可达=基础设施(不计博主连续失败);上游风控/结构=计失败。
 * 无水印 play_url 不落库,仅经 interpret job data 过境即焚(版权红线 arch/02 §3.2)。
 */
import { isP2002, prisma } from "../db";
import { logger } from "../logger";
import { CRAWL_JOB_VIDEO, getQueue, QUEUE_CRAWLER } from "../queue";

import { jarsFromConfig } from "./cookies";
import { isInterpretReady, markPendingAndEnqueue } from "./interpret-video";
import {
  SOCIAL_BACKFILL_DAYS,
  SOCIAL_BACKFILL_MAX_ITEMS,
  SOCIAL_BACKFILL_MAX_PAGES,
  SOCIAL_MANUAL_BACKFILL_DAYS,
  SOCIAL_MAX_CONSECUTIVE_FAILS,
  TELEGRAM_MEDIA_VIDEO,
  TELEGRAM_STATUS_HIDDEN,
  TELEGRAM_STATUS_VISIBLE,
  type BlocklistScope,
  type VideoPlatform,
} from "./constants";
import { matchBlocklist, matchHeuristics, type BlocklistWord, type FilterHit } from "./filter";
import { canonicalUrl, contentHash, decodeHtmlEntities, truncateSummary } from "./normalize";
import { tryConsumeDailyQuota } from "./rate-limit";
import { douyinAdapter } from "./adapters/video/douyin";
import {
  GatewayUnavailableError,
  GatewayUpstreamError,
  type VideoAdapter,
  type VideoItem,
} from "./adapters/video";

/** 平台适配器注册表(B站后补只加一行) */
const ADAPTERS: Partial<Record<VideoPlatform, VideoAdapter>> = {
  douyin: douyinAdapter,
};

export interface VideoCrawlOutcome {
  accountId: number;
  platform: string;
  /** 手动回填轮(30 天窗/3 页深扫/不设条帽;worker 日志可分辨) */
  backfill: boolean;
  fetched: number;
  inserted: number;
  filtered: number;
  duplicated: number;
  skippedDailyCap: boolean;
  skippedNoCookies: boolean;
}

function nextRunAt(intervalMin: number, from: Date): Date {
  return new Date(from.getTime() + intervalMin * 60_000);
}

async function loadBlocklistWords(): Promise<BlocklistWord[]> {
  const words = await prisma.blocklist.findMany({
    where: { enabled: true },
    select: { word: true, scope: true },
  });
  return words.map((w) => ({ word: w.word, scope: w.scope as BlocklistScope }));
}

/** 单条视频入库:去重 → 过滤 → 摘要 → shell 落库(命中过滤也落库 hidden 供观测)→ 可见条入解读队列 */
async function ingestVideoItem(
  platformRowId: number,
  nickname: string,
  platform: string,
  item: VideoItem,
  words: readonly BlocklistWord[],
  secUid: string,
  interpretReady: boolean,
): Promise<"inserted" | "filtered" | "duplicated"> {
  const url = canonicalUrl(item.url);
  // 实体解码先行(与 ingest.ts 同口径,2026-10-09 验收反馈问题3)
  const title = decodeHtmlEntities(item.title).trim().slice(0, 500);
  const hash = contentHash(title, url);

  const exists = await prisma.telegram.findUnique({
    where: { contentHash: hash },
    select: { id: true },
  });
  if (exists) return "duplicated";

  const caption = decodeHtmlEntities(item.caption ?? "").trim();
  const summary = truncateSummary(caption || title);
  const hit: FilterHit | null =
    matchBlocklist(title, summary, words) ?? matchHeuristics(title, caption);

  try {
    const created = await prisma.telegram.create({
      data: {
        sourceId: platformRowId,
        title: title || null,
        summary,
        url,
        publishedAt: item.publishedAt,
        contentHash: hash,
        status: hit ? TELEGRAM_STATUS_HIDDEN : TELEGRAM_STATUS_VISIBLE,
        filterHit: hit?.rule ?? null,
        mediaType: TELEGRAM_MEDIA_VIDEO,
        videoPlatform: platform,
        videoBlogger: nickname,
        videoCoverUrl: item.coverUrl,
        videoDuration: item.durationSeconds,
        videoEngagement: item.engagement,
      },
      select: { id: true },
    });
    if (hit) return "filtered";
    // 可见新条 + 解读就绪 → 入队解读(playUrl 仅经 job data 过境,禁落库;M12 起
    // 不再要求网关透出直链——job 内网关重拉,拉不到降级文案解读,存量另有
    // ai-backfill-tick 5min 补扫兜底;入队失败不拖垮采集轮)。pending→入队→
    // 回滚顺序由 markPendingAndEnqueue 单点保证
    if (interpretReady) {
      try {
        await markPendingAndEnqueue(created.id, {
          videoId: item.videoId,
          playUrl: item.playUrl,
          platform,
          secUid,
        });
      } catch (err) {
        logger.warn({
          event: "crawler.video.interpret_enqueue_failed",
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

/** 单博主采集一轮(worker「crawl-video」job 入口;opts.backfill 为手动回填轮);账号不存在/停用返回空结果 */
export async function crawlVideoAccount(
  accountId: number,
  opts: { backfill?: boolean } = {},
): Promise<VideoCrawlOutcome> {
  const account = await prisma.socialAccount.findUnique({
    where: { id: accountId },
    include: { platformRow: true },
  });
  const outcome: VideoCrawlOutcome = {
    accountId,
    platform: account?.platform ?? "",
    backfill: opts.backfill === true,
    fetched: 0,
    inserted: 0,
    filtered: 0,
    duplicated: 0,
    skippedDailyCap: false,
    skippedNoCookies: false,
  };
  if (!account || !account.enabled || !account.platformRow.enabled) return outcome;

  const now = new Date();
  const advance = (data: Record<string, unknown> = {}) =>
    prisma.socialAccount.update({
      where: { id: account.id },
      data: {
        lastRunAt: now,
        nextRunAt: nextRunAt(account.crawlIntervalMin, now),
        ...data,
      },
      select: { id: true },
    });

  // 平台日上限(锚平台行,与渠道侧同款护栏):超限只顺延不计失败
  const { dailyMaxRequests } = account.platformRow;
  if (dailyMaxRequests != null) {
    const allowed = await tryConsumeDailyQuota(account.platformRow.id, dailyMaxRequests);
    if (!allowed) {
      outcome.skippedDailyCap = true;
      await advance();
      logger.warn({
        event: "crawler.video.daily_cap_skip",
        accountId: account.id,
        nickname: account.nickname,
      });
      return outcome;
    }
  }

  // Cookie 池:未配置密钥或池为空是运营缺口——记 last_error 但不计失败,导入后自然恢复
  const jars = jarsFromConfig(account.platformRow.config);
  if (jars.length === 0) {
    outcome.skippedNoCookies = true;
    await advance({ lastError: "Cookie 池为空(待导入)" });
    logger.warn({
      event: "crawler.video.no_cookies",
      accountId: account.id,
      nickname: account.nickname,
    });
    return outcome;
  }

  const adapter = ADAPTERS[account.platform as VideoPlatform];
  if (!adapter) {
    await advance({ lastError: `平台适配器未实现(${account.platform})` });
    throw new Error(`视频适配器未实现(platform=${account.platform})`);
  }

  try {
    const items = await adapter.fetchRecentVideos({
      secUid: account.secUid,
      cookies: jars,
      ...(outcome.backfill ? { maxPages: SOCIAL_BACKFILL_MAX_PAGES } : {}),
    });
    outcome.fetched = items.length;

    // 增量地板:只采比 last_post_at 新的;首采回填窗口(7 天)再限条防新登记刷屏;
    // 手动回填(批⑧)绕过地板与条帽,按 30 天窗深扫补采
    const nowMs = now.getTime();
    const firstRun = account.lastPostAt === null;
    const floorMs = outcome.backfill
      ? nowMs - SOCIAL_MANUAL_BACKFILL_DAYS * 86_400_000
      : firstRun
        ? nowMs - SOCIAL_BACKFILL_DAYS * 86_400_000
        : (account.lastPostAt?.getTime() ?? 0);
    const cap = !outcome.backfill && firstRun ? SOCIAL_BACKFILL_MAX_ITEMS : items.length;
    const candidates = items
      .filter((it) => (it.publishedAt?.getTime() ?? nowMs) > floorMs)
      .slice(0, cap);

    const words = await loadBlocklistWords();
    // 解读就绪整轮 resolve 一次(interpret 绑定即就绪,M12 起不前置 ASR,省逐条双查)
    const interpretReady = await isInterpretReady();
    for (const item of candidates) {
      outcome[
        await ingestVideoItem(
          account.platformRow.id,
          account.nickname,
          account.platform,
          item,
          words,
          account.secUid,
          interpretReady,
        )
      ] += 1;
    }

    // 地板推进取全部拉取结果的最大发布时间(含被回填上限截掉的),避免下轮重复扫;
    // 三项 Math.max 守卫:回填地板(now-30d)可能低于 last_post_at,推进绝不回退
    const maxPublishedMs = Math.max(floorMs, ...items.map((it) => it.publishedAt?.getTime() ?? 0));
    await advance({
      consecutiveFails: 0,
      lastError: null,
      lastPostAt: new Date(Math.max(maxPublishedMs, floorMs, account.lastPostAt?.getTime() ?? 0)),
    });
    return outcome;
  } catch (err) {
    if (err instanceof GatewayUnavailableError) {
      // 基础设施故障 ≠ 博主采集失败:顺延本轮,连续失败不累计(告警走 BullMQ failed)
      await advance();
      logger.warn({
        event: "crawler.video.gateway_unavailable",
        accountId: account.id,
        error: err.message,
      });
      throw err;
    }
    const fails =
      err instanceof GatewayUpstreamError ? account.consecutiveFails + 1 : account.consecutiveFails;
    const message = err instanceof Error ? err.message : String(err);
    await advance({
      consecutiveFails: fails,
      lastError: message.slice(0, 500),
    });
    if (fails >= SOCIAL_MAX_CONSECUTIVE_FAILS) {
      logger.error({
        event: "crawler.video.degraded",
        accountId: account.id,
        nickname: account.nickname,
        fails,
      });
    }
    throw err;
  }
}

/** tick 入口:扫到期博主逐个入队(平台行停用的自然被 where 过滤) */
export async function enqueueDueVideoAccounts(): Promise<{ due: number }> {
  const due = await prisma.socialAccount.findMany({
    where: {
      enabled: true,
      platformRow: { enabled: true },
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }],
    },
    select: { id: true, nextRunAt: true },
    orderBy: { id: "asc" },
  });
  const queue = getQueue(QUEUE_CRAWLER);
  for (const account of due) {
    // jobId 锚定到期时刻:同账号同轮重复入队被 BullMQ 幂等挡掉
    await queue.add(
      CRAWL_JOB_VIDEO,
      { accountId: account.id },
      {
        jobId: `crawl-video-${account.id}-${account.nextRunAt?.getTime() ?? 0}`,
        removeOnComplete: 200,
        removeOnFail: 200,
      },
    );
  }
  return { due: due.length };
}
