/**
 * 任务B·B站发现周频(M25,discovery-plan §4):active 词双窗 search
 * (90d 找博主 / 7d 找热点视频)→ 聚合(博主 topN / 视频≥5万播放)→ L0 预筛 →
 * 身份幂等落库 → L0 pass 的新视频推飞书选题库(回写 record 防重推)。
 * 风控纪律(constants 固化):search 词间 6-9s、412 退避 15s×3、card 拆阶段
 * 延迟 30s + 条间 3-4.2s;单窗失败按词留痕不弃整轮。
 */
import { logger } from "../logger";
import { statsDay } from "../datetime";

import { biliCard, biliSearchVideo } from "./bili/api";
import { BiliRiskControlError } from "./bili/errors";
import {
  BILI_BACKOFF_412_MS,
  BILI_CARD_GAP_MS,
  BILI_CARD_PHASE_DELAY_MS,
  BILI_SEARCH_GAP_MS,
  BILI_SEARCH_RETRY,
  DISCOVERY_BLOGGER_TOP_N,
  DISCOVERY_BLOGGER_WINDOW_DAYS,
  DISCOVERY_PLATFORM_BILIBILI,
  DISCOVERY_SEARCH_PAGE_SIZE,
  DISCOVERY_VIDEO_MIN_PLAY,
  DISCOVERY_VIDEO_WINDOW_DAYS,
} from "./constants";
import { aggregateBloggers, aggregateVideos, type WordResult } from "./aggregate";
import { saveCandidates, markCandidateFeishu, type CandidateInput } from "./candidates";
import { isFeishuPushConfigured, pushVideoToBitable } from "./feishu";
import { takeActiveWords, touchWords } from "./keywords";
import { l0Check } from "./l0";
import { randomGapMs, sleep } from "./timing";

export interface BiliOutcome {
  /** 本轮词数 */
  words: number;
  /** 失败词(两窗任一重试后仍败即记;明细在 word_failed 事件) */
  failedWords: string[];
  /** 落库候选数(博主+视频,含 L0 reject 留痕) */
  bloggerCandidates: number;
  videoCandidates: number;
  /** 本轮新落库数 */
  inserted: number;
  /** 飞书推送:pushed 成功 / skipped=true=未配置跳过 / failed 失败数 */
  feishuPushed: number;
  feishuSkipped: boolean;
  feishuFailed: number;
}

/** 单窗搜索 + 412 退避重试(纪律:15s × ≤3,仍败抛给调用方按词留痕) */
async function searchWindow(
  keyword: string,
  beginSec: number,
  endSec: number,
): Promise<WordResult> {
  for (let attempt = 1; attempt <= BILI_SEARCH_RETRY; attempt += 1) {
    try {
      const page = await biliSearchVideo({
        keyword,
        pageSize: DISCOVERY_SEARCH_PAGE_SIZE,
        beginSec,
        endSec,
      });
      if (page.dropped > 0) {
        logger.warn({ event: "discovery.bili.search_dropped", keyword, dropped: page.dropped });
      }
      return { word: keyword, items: page.items };
    } catch (e) {
      // 仅风控退避重试;不可达/契约漂移无重试价值直接抛
      if (!(e instanceof BiliRiskControlError) || attempt === BILI_SEARCH_RETRY) throw e;
      logger.warn({ event: "discovery.bili.risk_backoff", keyword, attempt });
      await sleep(BILI_BACKOFF_412_MS);
    }
  }
  throw new Error("unreachable");
}

const DAY_SEC = 86_400;

export async function runBiliDiscovery(cap: number): Promise<BiliOutcome> {
  const now = new Date();
  const round = statsDay(now).replace(/-/g, "");
  const words = await takeActiveWords(cap);
  const outcome: BiliOutcome = {
    words: words.length,
    failedWords: [],
    bloggerCandidates: 0,
    videoCandidates: 0,
    inserted: 0,
    feishuPushed: 0,
    feishuSkipped: false,
    feishuFailed: 0,
  };
  if (words.length === 0) return outcome;

  // 阶段一:双窗搜索逐词直拉(词间 6-9s;单窗失败留痕,另一窗结果仍可用)
  const nowSec = Math.floor(now.getTime() / 1000);
  const bloggerResults: WordResult[] = [];
  const videoResults: WordResult[] = [];
  for (const w of words) {
    let ok = true;
    try {
      bloggerResults.push(
        await searchWindow(w.word, nowSec - DISCOVERY_BLOGGER_WINDOW_DAYS * DAY_SEC, nowSec),
      );
    } catch (e) {
      ok = false;
      logger.warn({
        event: "discovery.bili.word_failed",
        word: w.word,
        window: "90d",
        error: e instanceof Error ? e.message : String(e),
      });
    }
    await sleep(randomGapMs(BILI_SEARCH_GAP_MS));
    try {
      videoResults.push(
        await searchWindow(w.word, nowSec - DISCOVERY_VIDEO_WINDOW_DAYS * DAY_SEC, nowSec),
      );
    } catch (e) {
      ok = false;
      logger.warn({
        event: "discovery.bili.word_failed",
        word: w.word,
        window: "7d",
        error: e instanceof Error ? e.message : String(e),
      });
    }
    if (!ok) outcome.failedWords.push(w.word);
    await sleep(randomGapMs(BILI_SEARCH_GAP_MS));
  }

  // 阶段二:card 拆阶段(search 连发后冷却再进,防 session 级风控;无 pass 不进)
  const bloggerTop = aggregateBloggers(bloggerResults).slice(0, DISCOVERY_BLOGGER_TOP_N);
  const l0ed = bloggerTop.map((b) => ({
    b,
    l0: l0Check({ name: b.author, sampleTitles: b.sampleTitles }),
  }));
  const toCard = l0ed.filter((x) => x.l0.verdict === "pass");
  if (toCard.length > 0) {
    await sleep(BILI_CARD_PHASE_DELAY_MS);
  }
  const bloggerRows: CandidateInput[] = [];
  for (const { b, l0 } of l0ed) {
    let fans: number | null = null;
    let archives: number | null = null;
    if (l0.verdict === "pass") {
      // 资料卡失败不阻塞:fans/archives 留空,后续轮次或人工补
      try {
        const card = await biliCard(b.mid);
        fans = card.fans;
        archives = card.archives;
      } catch (e) {
        logger.warn({
          event: "discovery.bili.card_failed",
          mid: b.mid,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      await sleep(randomGapMs(BILI_CARD_GAP_MS));
    }
    bloggerRows.push({
      type: "blogger",
      externalId: b.mid,
      author: b.author,
      homepageUrl: `https://space.bilibili.com/${b.mid}`,
      hitKeywords: b.hitKeywords,
      hitCount: b.hitCount,
      maxPlay: b.maxPlay,
      fans,
      archives,
      sampleTitles: b.sampleTitles,
      l0Verdict: l0.verdict,
      l0Reason: l0.reason,
    });
  }

  // 视频线:≥5万播放门槛 → L0 仅标题维度(视频看内容不看账号)
  const videoRows: CandidateInput[] = aggregateVideos(videoResults)
    .filter((v) => v.play >= DISCOVERY_VIDEO_MIN_PLAY)
    .map((v) => {
      const l0 = l0Check({ name: null, sampleTitles: [v.title] });
      return {
        type: "video" as const,
        externalId: v.bvid,
        title: v.title,
        author: v.author,
        homepageUrl: `https://www.bilibili.com/video/${v.bvid}`,
        hitKeywords: v.hitKeywords,
        hitCount: v.hitCount,
        maxPlay: v.play,
        totalPlay: v.play,
        l0Verdict: l0.verdict,
        l0Reason: l0.reason,
      };
    });

  outcome.bloggerCandidates = bloggerRows.length;
  outcome.videoCandidates = videoRows.length;
  const saved = await saveCandidates(
    [...bloggerRows, ...videoRows],
    DISCOVERY_PLATFORM_BILIBILI,
    round,
  );
  outcome.inserted = saved.filter((s) => s.created).length;

  // 飞书推送:仅本轮新落库的 L0 pass 视频(既有候选不重推;未配置整段跳过)
  const pushTargets = saved.filter(
    (s) => s.created && s.input.type === "video" && s.input.l0Verdict === "pass",
  );
  if (pushTargets.length > 0) {
    if (!isFeishuPushConfigured()) {
      outcome.feishuSkipped = true;
    } else {
      for (const t of pushTargets) {
        try {
          const recordId = await pushVideoToBitable({
            title: t.input.title ?? "",
            bvid: t.input.externalId,
            play: t.input.totalPlay ?? 0,
            author: t.input.author ?? "",
            hitKeywords: t.input.hitKeywords,
          });
          await markCandidateFeishu(t.id, recordId);
          outcome.feishuPushed += 1;
        } catch (e) {
          outcome.feishuFailed += 1;
          logger.warn({
            event: "discovery.bili.feishu_failed",
            bvid: t.input.externalId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }

  await touchWords(words.map((w) => w.id));
  logger.info({ event: "discovery.bili.done", ...outcome });
  return outcome;
}
