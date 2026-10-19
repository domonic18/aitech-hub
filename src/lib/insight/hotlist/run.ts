/**
 * 热榜拉取编排(M34 批③,方案 §3 日频):逐源 fetch → 截前 N → 逐条入池
 * (refreshMeta=仍在榜次日刷新 meta 与 signal_at,位次/热度更新、信号续热)。
 * 失败隔离:单源网络/契约异常记数不弃整轮;单条入池永不 reject(ingest 自吞)。
 * 源闸(批③ 验收反馈:纳入采集计划管理):逐轮读 insight_hot_source 启停表,
 * 停用源整源跳过;每源拉取态(最近拉取/连败/末次错误)best-effort 回写登记表。
 * meta 携带 {rank, heat?, url?, batch}:batch=本轮时间戳,读侧「今日热榜」视图
 * 按(源内)最新 batch 取当日榜面,出榜旧条目自然沉淀为历史信号。
 */
import { logger } from "../../logger";

import type { HotFetcher, HotItem } from "./types";
import { HOT_FETCHERS } from "./registry";
import { HOTLIST_MAX_ITEMS } from "../constants";
import { enabledHotSources, recordHotSourceRun } from "../hot-source";
import { ingestInsightSignal, type IngestOutcome } from "../ingest";

export interface HotlistSourceOutcome {
  source: string;
  /** 拉到条数(截前 N 后) */
  fetched: number;
  ingested: number;
  /** 仍在榜刷新(位次/热度/meta 更新) */
  refreshed: number;
  duplicate: number;
  /** 解析/网络失败(整源计 1) */
  failed: boolean;
  /** 入池异常条数(ingest 返 error) */
  errors: number;
}

export interface HotlistOutcome {
  batch: number;
  sources: HotlistSourceOutcome[];
}

/** 逐条入池并按结果聚合(refreshMeta 只对热榜源开启) */
async function ingestItems(
  fetcher: HotFetcher,
  items: HotItem[],
  batch: number,
): Promise<HotlistSourceOutcome> {
  const outcome: HotlistSourceOutcome = {
    source: fetcher.source,
    fetched: items.length,
    ingested: 0,
    refreshed: 0,
    duplicate: 0,
    failed: false,
    errors: 0,
  };
  const now = new Date();
  for (const it of items) {
    const r: IngestOutcome = await ingestInsightSignal(
      {
        source: fetcher.source,
        refId: it.refId,
        rawText: it.title,
        signalAt: now,
        meta: { rank: it.rank, heat: it.heat, url: it.url, batch },
      },
      { refreshMeta: true },
    );
    if (r === "ingested") outcome.ingested += 1;
    else if (r === "refreshed") outcome.refreshed += 1;
    else if (r === "duplicate") outcome.duplicate += 1;
    else outcome.errors += 1;
  }
  return outcome;
}

export async function runHotlistFetch(
  fetchers: readonly HotFetcher[] = HOT_FETCHERS,
): Promise<HotlistOutcome> {
  const batch = Date.now();
  const sources: HotlistSourceOutcome[] = [];
  // 源闸:停用源整源跳过(缺行=启用,见 hot-source 模块头注)
  const allowed = await enabledHotSources();
  for (const fetcher of fetchers) {
    if (!allowed.has(fetcher.source)) {
      logger.info({ event: "insight.hotlist_source_skipped", source: fetcher.source });
      continue;
    }
    let items: HotItem[];
    try {
      items = (await fetcher.fetchItems()).slice(0, HOTLIST_MAX_ITEMS);
    } catch (e) {
      logger.warn({
        event: "insight.hotlist_source_failed",
        source: fetcher.source,
        error: String(e),
      });
      await recordHotSourceRun(fetcher.source, false, String(e));
      sources.push({
        source: fetcher.source,
        fetched: 0,
        ingested: 0,
        refreshed: 0,
        duplicate: 0,
        failed: true,
        errors: 0,
      });
      continue;
    }
    const outcome = await ingestItems(fetcher, items, batch);
    await recordHotSourceRun(fetcher.source, !outcome.failed);
    sources.push(outcome);
  }
  return { batch, sources };
}
