/**
 * 厂商动态采集编排(M58 批②,data-expansion-plan §5.1):crawlSource type=vendor
 * 分发入口。复用统一调度/健康度/限频/快照——本模块只做三件事:
 * 1. 取列表原文 → SourceCapture 落档(解析之前落盘,改版当天有证据);
 * 2. def.parse → 统一条目,单轮 ≤20;
 * 3. Redis 已处理标记(NX 抢占)→ 逐条入事件抽取队列(正文抓取/LLM 在 extract.ts)。
 *
 * 失败语义:取数/解析失败抛错 → crawlSource 通用 catch 记 consecutiveFails/
 * 健康度;抽取出错**不**回写源健康度(抓取成功即健康,方案 §5.2 失败隔离)。
 * 随机 job id:去重靠 Redis 标记 + entity_event.dedupeKey 双保险,不用确定性
 * jobId——BullMQ 保留窗口内同 id 会被静默丢弃(已知陷阱)。
 */
import { createHash } from "node:crypto";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { INSIGHT_JOB_EXTRACT_EVENT, QUEUE_INSIGHT, getQueue } from "@/lib/queue";
import { redis } from "@/lib/redis";

import { CRAWL_SOURCE_TYPE_VENDOR, VENDOR_CRAWL_INTERVAL_MIN } from "../../collect/constants";
import { SourceCapture } from "../../collect/snapshot-capture";
import { VENDOR_SEEN_TTL_SEC } from "./constants";
import type { VendorItem } from "./parse";
import { sortVendorItems } from "./parse";
import {
  VENDOR_DEFS,
  VENDOR_MAX_ITEMS,
  fetchVendorList,
  resolveVendorDef,
  type VendorDef,
} from "./registry";

/** 已处理标记:同厂商同 URL TTL 内只抽一次;失败由抽取侧释放重投 */
export function vendorSeenKey(vendorKey: string, url: string): string {
  const digest = createHash("sha1").update(url).digest("hex").slice(0, 20);
  return `insight:vendor:seen:${vendorKey}:${digest}`;
}

/** NX 抢占;Redis 抖动返回 true 放行——幂等由 dedupeKey 唯一索引兜底 */
async function acquireSeen(vendorKey: string, url: string): Promise<boolean> {
  try {
    const r = await redis.set(vendorSeenKey(vendorKey, url), "1", "EX", VENDOR_SEEN_TTL_SEC, "NX");
    return r === "OK";
  } catch {
    return true;
  }
}

/** 抽取失败/未绑定模型 → 释放标记,下一轮重试(抽取幂等,重跑事件数不增) */
export async function releaseVendorSeen(vendorKey: string, url: string): Promise<void> {
  try {
    await redis.del(vendorSeenKey(vendorKey, url));
  } catch {
    // 标记滞留仅延迟重试,不影响正确性
  }
}

/** 抽取任务载荷(单篇一条:失败隔离粒度最细,单篇 ≤1 次 LLM 调用;
 * source 不随载荷传——由 vendorKey 回查注册表,队列数据无法漂出白名单) */
export interface VendorExtractJobData {
  sourceId: number;
  vendorKey: string;
  item: { title: string; url: string; publishedAt: string | null; summary: string };
}

async function enqueueExtract(
  sourceId: number,
  def: VendorDef,
  item: VendorItem,
): Promise<boolean> {
  const data: VendorExtractJobData = {
    sourceId,
    vendorKey: def.key,
    item: {
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt?.toISOString() ?? null,
      summary: item.summary,
    },
  };
  try {
    await getQueue(QUEUE_INSIGHT).add(INSIGHT_JOB_EXTRACT_EVENT, data, {
      attempts: 1,
      removeOnComplete: 200,
      removeOnFail: true,
    });
    return true;
  } catch (e) {
    logger.warn({
      event: "insight.vendor.enqueue_failed",
      sourceId,
      url: item.url,
      error: String(e),
    });
    return false;
  }
}

export interface VendorSourceCrawlResult {
  ok: boolean;
  fetched: number;
  queued: number;
}

/** 单厂商渠道爬取(crawlSource type=vendor 分发入口;now 仅留接口一致性) */
export async function runVendorSourceCrawl(
  source: { id: number; url: string; config: unknown },
  now: Date = new Date(),
): Promise<VendorSourceCrawlResult> {
  void now;
  const def = resolveVendorDef(source.config);
  if (def === null) {
    throw new Error(`vendor 渠道 config.vendorKey 未注册(源 id=${source.id})`);
  }
  const capture = new SourceCapture(source.id, source.url);
  try {
    const raw = await fetchVendorList(def, source.url);
    await capture.capture({ tab: "feed", html: raw, httpStatus: 200 });
    // 发布日倒序后再截断:升序 feed / 无日期列表都按最新优先取
    const items = sortVendorItems(def.parse(raw, source.url)).slice(0, VENDOR_MAX_ITEMS);
    if (items.length === 0) {
      // 页面改版与真空列表同态;原文已落档,计源失败让健康度变红等人工介入
      await capture.finish("empty", 0);
      throw new Error(`${def.label} 列表解析 0 条(疑似页面改版,快照可回溯)`);
    }
    let queued = 0;
    for (const item of items) {
      if (!(await acquireSeen(def.key, item.url))) continue;
      if (await enqueueExtract(source.id, def, item)) queued += 1;
      else await releaseVendorSeen(def.key, item.url);
    }
    await capture.finish("success", items.length);
    return { ok: true, fetched: items.length, queued };
  } catch (e) {
    await capture.finish("failed", null, e instanceof Error ? e.message : String(e));
    throw e; // RateLimitedError 需原样上抛(crawlSource 识别后顺延不记失败)
  }
}

/** 渠道种子幂等(crawl_source 只补缺不改值;URL/启停/周期归后台所有) */
export async function syncVendorChannels(): Promise<number> {
  const names = VENDOR_DEFS.map((d) => `vendor:${d.key}`);
  const existing = new Set(
    (
      await prisma.crawlSource.findMany({ where: { name: { in: names } }, select: { name: true } })
    ).map((r) => r.name),
  );
  for (const def of VENDOR_DEFS) {
    await prisma.crawlSource.upsert({
      where: { name: `vendor:${def.key}` },
      update: {}, // 后台已调过的 URL/周期/启停一律不覆盖
      create: {
        name: `vendor:${def.key}`,
        type: CRAWL_SOURCE_TYPE_VENDOR,
        url: def.defaultUrl,
        crawlIntervalMin: VENDOR_CRAWL_INTERVAL_MIN,
        enabled: true,
        config: { vendorKey: def.key },
        remark: def.label,
      },
      select: { id: true },
    });
  }
  // 注册表里没有的 vendor 行每轮必抛「key 未注册」——只停用不删行(台账/快照可回溯)
  await prisma.crawlSource.updateMany({
    where: { type: CRAWL_SOURCE_TYPE_VENDOR, enabled: true, NOT: { name: { in: names } } },
    data: { enabled: false },
  });
  return names.filter((n) => !existing.has(n)).length;
}
