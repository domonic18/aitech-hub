/**
 * 榜单采集编排(M58 批③,data-expansion-plan §6.2):crawlSource type=leaderboard
 * 分发入口。复用统一调度/健康度/限频/快照——本模块只做四件事:
 * 1. 取原文 → SourceCapture 落档(解析之前落盘,改版当天有证据);
 * 2. def.parse → 统一条目,按分值倒序(名次榜保持原序)截断 ≤def.maxItems(默认 20);
 * 3. 按 (source, board, entityKey, capturedDate) upsert,同日重跑整表覆盖;
 * 4. 清理超过保留期的旧快照行。
 *
 * 失败语义:取数/解析失败抛错 → crawlSource 通用 catch 记 consecutiveFails/
 * 健康度;抛错前不写任何行(保留上一可用日期数据,方案 §6.1「不写空数据」),
 * 公开页据「数据截至」自动降级显示。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

import {
  CRAWL_SOURCE_TYPE_LEADERBOARD,
  LEADERBOARD_CRAWL_INTERVAL_MIN,
} from "../collect/constants";
import { SourceCapture } from "../collect/snapshot-capture";
import { formatCnDate } from "../datetime";
import { LEADERBOARD_MAX_ITEMS } from "./constants";
import { snapshotMeta } from "./meta";
import type { LeaderboardItem } from "./parse";
import {
  LEADERBOARD_DEFS,
  fetchLeaderboardList,
  resolveLeaderboardDef,
  type LeaderboardDef,
} from "./registry";

/** 北京日 → @db.Date 存储值(UTC 零点,只存日期语义,勿当真实时刻用) */
export function leaderboardDay(now: Date): Date {
  return new Date(`${formatCnDate(now)}T00:00:00Z`);
}

export interface LeaderboardCrawlResult {
  ok: boolean;
  fetched: number;
  persisted: number;
}

/** 单榜单渠道爬取(crawlSource type=leaderboard 分发入口) */
export async function runLeaderboardSourceCrawl(
  source: { id: number; url: string; config: unknown },
  now: Date = new Date(),
): Promise<LeaderboardCrawlResult> {
  const def = resolveLeaderboardDef(source.config);
  if (def === null) {
    throw new Error(`leaderboard 渠道 config.boardKey 未注册(源 id=${source.id})`);
  }
  const capture = new SourceCapture(source.id, source.url);
  try {
    const raw = await fetchLeaderboardList(def, source.url);
    await capture.capture({
      tab: def.key,
      html: raw,
      httpStatus: 200,
    });
    const limit = def.maxItems ?? LEADERBOARD_MAX_ITEMS;
    const items = rankItems(def.parse(raw, source.url)).slice(0, limit);
    if (items.length === 0) {
      // 页面改版与真空榜单同态;原文已落档,计源失败让健康度变红等人工介入
      await capture.finish("empty", 0);
      throw new Error(`${def.label} 解析 0 条(疑似页面改版,快照可回溯)`);
    }
    const persisted = await persistSnapshots(source.id, def, items, leaderboardDay(now));
    await capture.finish("success", items.length);
    return { ok: true, fetched: items.length, persisted };
  } catch (e) {
    await capture.finish("failed", null, e instanceof Error ? e.message : String(e));
    throw e; // RateLimitedError 需原样上抛(crawlSource 识别后顺延不记失败)
  }
}

/** 名次口径:有分值按分值倒序(同分保持解析序);名次榜(arXiv 最新/GitHub 日榜)
 * 无分值,保持原始顺序即名次 */
export function rankItems(items: LeaderboardItem[]): LeaderboardItem[] {
  if (items.every((it) => it.score === null)) return items;
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const as = a.it.score ?? Number.NEGATIVE_INFINITY;
      const bs = b.it.score ?? Number.NEGATIVE_INFINITY;
      return as !== bs ? bs - as : a.i - b.i;
    })
    .map((x) => x.it);
}

/** 同日整表覆盖:先 upsert 本轮条目,再删同日已掉榜的行(重跑幂等:
 * 同一份原文跑两次,行数与名次完全一致)。source 落注册表 key。 */
async function persistSnapshots(
  sourceId: number,
  def: LeaderboardDef,
  items: LeaderboardItem[],
  capturedDate: Date,
): Promise<number> {
  let persisted = 0;
  for (const [i, it] of items.entries()) {
    const row = {
      entityName: it.entityName,
      entityType: it.entityType,
      vendor: it.vendor,
      rank: i + 1,
      score: it.score,
      scoreUnit: it.scoreUnit,
      // meta 必须 create/update 同写:同日重采(幂等常态)若不更新 meta,
      // 新展示字段(价格/摘要/描述)只在当日首插时落库,永远晚一天
      meta: snapshotMeta(it.url, sourceId, it.extra) as Prisma.InputJsonValue,
    };
    await prisma.insightLeaderboardSnapshot.upsert({
      where: {
        source_board_entityKey_capturedDate: {
          source: def.key,
          board: def.board,
          entityKey: it.entityKey,
          capturedDate,
        },
      },
      update: row,
      create: {
        source: def.key,
        board: def.board,
        entityKey: it.entityKey,
        capturedDate,
        ...row,
      },
      select: { id: true },
    });
    persisted += 1;
  }
  await prisma.insightLeaderboardSnapshot.deleteMany({
    where: {
      source: def.key,
      board: def.board,
      capturedDate,
      entityKey: { notIn: items.map((it) => it.entityKey) },
    },
  });
  return persisted;
}

/** 渠道种子幂等(crawl_source 只补缺不改值;URL/启停/周期归后台所有) */
export async function syncLeaderboardChannels(): Promise<number> {
  const names = LEADERBOARD_DEFS.map((d) => `leaderboard:${d.key}`);
  const existing = new Set(
    (
      await prisma.crawlSource.findMany({ where: { name: { in: names } }, select: { name: true } })
    ).map((r) => r.name),
  );
  for (const def of LEADERBOARD_DEFS) {
    await prisma.crawlSource.upsert({
      where: { name: `leaderboard:${def.key}` },
      update: {}, // 后台已调过的 URL/周期/启停一律不覆盖
      create: {
        name: `leaderboard:${def.key}`,
        type: CRAWL_SOURCE_TYPE_LEADERBOARD,
        url: def.defaultUrl,
        crawlIntervalMin: LEADERBOARD_CRAWL_INTERVAL_MIN,
        enabled: true,
        config: { boardKey: def.key },
        remark: def.label,
      },
      select: { id: true },
    });
  }
  // 注册表里没有的榜单行每轮必抛「key 未注册」——只停用不删行(台账可回溯)
  await prisma.crawlSource.updateMany({
    where: { type: CRAWL_SOURCE_TYPE_LEADERBOARD, enabled: true, NOT: { name: { in: names } } },
    data: { enabled: false },
  });
  logger.info({ event: "leaderboard.channels_synced", created: names.length - existing.size });
  return names.length - existing.size;
}
