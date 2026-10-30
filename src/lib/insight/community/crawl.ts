/**
 * 社区需求语料采集编排(M58 批④,data-expansion-plan §7):crawlSource
 * type=community 分发入口。复用统一调度/健康度/限频/快照——本模块只做四件事:
 * 1. 组装运行参数(百度种子/GitHub 仓库白名单/token);
 * 2. 取数 → SourceCapture 落档(解析之前落盘);
 * 3. def.parse → L0 准入(过短/纯符号/营销/重复)→ 日预算截断;
 * 4. 逐条 ingestInsightSignal 入信号池(source=community-<key>),非中文源
 *    由 ingest 自动入翻译队列。
 *
 * 失败语义:取数/解析失败抛错 → crawlSource 通用 catch 记 consecutiveFails/
 * 健康度;入池单条永不 reject(ingest 自吞)。Redis 不可用时日预算放行
 * (降级开放),不阻塞采集。
 */
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";

import { CRAWL_SOURCE_TYPE_COMMUNITY } from "../../collect/constants";
import { SourceCapture } from "../../collect/snapshot-capture";
import { ingestInsightSignal } from "../ingest";
import { l0Screen, type L0Reason } from "../l0";
import {
  COMMUNITY_BAIDU_FALLBACK_SEEDS,
  COMMUNITY_BAIDU_HOT_SEEDS,
  COMMUNITY_BAIDU_HOT_WINDOW_MS,
  COMMUNITY_BAIDU_MAX_SEEDS,
  COMMUNITY_BAIDU_TAG_SEEDS,
  COMMUNITY_DAILY_CAPS,
  COMMUNITY_OSS_DEFAULT_REPOS,
  COMMUNITY_OSS_MAX_REPOS,
} from "./constants";
import type { CommunityItem } from "./parse";
import {
  COMMUNITY_DEFS,
  resolveCommunityDef,
  type CommunityContext,
  type CommunityDef,
} from "./registry";

/** 单源单轮结果(worker 日志/台账观测) */
export interface CommunityCrawlResult {
  ok: boolean;
  /** 解析出的条目(含 L0 拦截前) */
  fetched: number;
  ingested: number;
  /** 已入池过的条目(社区源逐轮高度重叠;真机首轮 hn 10 条次轮全重复) */
  existing: number;
  /** L0 拦截 + 日预算截断合计 */
  dropped: number;
}

function stringArray(config: Record<string, unknown>, key: string): string[] {
  const value = config[key];
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === "string" ? v.trim() : "")).filter((v) => v !== "");
}

/** 百度种子:config.seeds 优先;缺省 = 站点热门标签 + 近期热搜词(发现热词回路) */
async function defaultBaiduSeeds(now: Date): Promise<string[]> {
  const [tags, hot] = await Promise.all([
    prisma.tag
      .findMany({
        select: { name: true, _count: { select: { posts: true } } },
        take: 50,
      })
      .catch(() => []),
    prisma.insightSignal
      .findMany({
        where: {
          source: "hot-baidu",
          signalAt: { gte: new Date(now.getTime() - COMMUNITY_BAIDU_HOT_WINDOW_MS) },
        },
        orderBy: { signalAt: "desc" },
        take: COMMUNITY_BAIDU_HOT_SEEDS,
        select: { normalizedText: true },
      })
      .catch(() => []),
  ]);
  const tagSeeds = tags
    .sort((a, b) => b._count.posts - a._count.posts)
    .slice(0, COMMUNITY_BAIDU_TAG_SEEDS)
    .map((t) => t.name);
  const hotSeeds = hot.map((h) => h.normalizedText);
  const all = [...tagSeeds, ...hotSeeds];
  return all.length > 0 ? all : COMMUNITY_BAIDU_FALLBACK_SEEDS;
}

async function buildContext(
  def: CommunityDef,
  config: Record<string, unknown>,
  now: Date,
): Promise<CommunityContext> {
  const cfgSeeds = stringArray(config, "seeds");
  const seeds =
    def.key === "baidu" ? (cfgSeeds.length > 0 ? cfgSeeds : await defaultBaiduSeeds(now)) : [];
  const cfgRepos = stringArray(config, "repos").filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r));
  const repos = (cfgRepos.length > 0 ? cfgRepos : COMMUNITY_OSS_DEFAULT_REPOS).slice(
    0,
    COMMUNITY_OSS_MAX_REPOS,
  );
  const token = typeof config.token === "string" && config.token !== "" ? config.token : null;
  return {
    seeds: [...new Set(seeds)].slice(0, COMMUNITY_BAIDU_MAX_SEEDS),
    repos,
    token,
  };
}

/** 日预算截断:返回本轮可入池条数(纯函数,单测覆盖) */
export function clampByQuota(want: number, used: number, cap: number): number {
  if (want <= 0) return 0;
  return Math.max(0, Math.min(want, cap - used));
}

function beijingDayKey(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** 日预算(北京时间自然日;Redis 不可用放行——完整性让位于可用性) */
async function reserveQuota(key: string, want: number, cap: number, now: Date): Promise<number> {
  const redisKey = `insight:community:quota:${key}:${beijingDayKey(now)}`;
  try {
    const used = Number((await redis.get(redisKey)) ?? 0);
    const grant = clampByQuota(want, Number.isFinite(used) ? used : 0, cap);
    if (grant > 0) {
      await redis.incrby(redisKey, grant);
      await redis.expire(redisKey, 26 * 3_600);
    }
    return grant;
  } catch (e) {
    logger.warn({ event: "insight.community.quota_degraded", key, error: String(e) });
    return want;
  }
}

/** 前置去重(单次查询):社区源每轮结果高度重叠,逐条撞唯一键会刷 prisma
 * 错误日志、白占日预算与翻译队列;ingest 的 P2002 兜底仍保留(并发竞态)。
 * 也因此日预算按「本轮新增」计——重复轮次不消耗额度,避免自己把自己饿死。 */
async function filterExisting(source: string, items: CommunityItem[]): Promise<CommunityItem[]> {
  if (items.length === 0) return [];
  const rows = await prisma.insightSignal.findMany({
    where: { source, refId: { in: items.map((i) => i.refId) } },
    select: { refId: true },
  });
  const seen = new Set(rows.map((r) => r.refId));
  return items.filter((i) => !seen.has(i.refId));
}

/** 单社区渠道爬取(crawlSource type=community 分发入口) */
export async function runCommunitySourceCrawl(
  source: { id: number; url: string; config: unknown },
  now: Date = new Date(),
): Promise<CommunityCrawlResult> {
  const config =
    typeof source.config === "object" && source.config !== null
      ? (source.config as Record<string, unknown>)
      : {};
  const def = resolveCommunityDef(config);
  if (def === null) {
    throw new Error(`community 渠道 config.communityKey 未注册(源 id=${source.id})`);
  }
  const capture = new SourceCapture(source.id, source.url);
  try {
    const ctx = await buildContext(def, config, now);
    const raws = await def.collect(source.url, ctx);
    for (const raw of raws) {
      await capture.capture({ tab: raw.tab, html: raw.raw, httpStatus: raw.httpStatus });
    }
    const items = def.parse(raws, now);
    if (items.length === 0) {
      // 接口改版与真空结果同态;原文已落档,计源失败让健康度变红等人工介入
      await capture.finish("empty", 0);
      throw new Error(`${def.label} 解析 0 条(疑似接口改版,快照可回溯)`);
    }
    const screen = l0Screen(items);
    const fresh = await filterExisting(def.insightSource, screen.accepted);
    const existing = screen.accepted.length - fresh.length;
    const cap = COMMUNITY_DAILY_CAPS[def.key];
    const granted = await reserveQuota(def.key, fresh.length, cap, now);
    const batch = fresh.slice(0, granted);
    let ingested = 0;
    for (const item of batch) {
      const r = await ingestInsightSignal({
        source: def.insightSource,
        refId: item.refId,
        rawText: item.text,
        signalAt: item.signalAt ?? now,
        lang: item.lang,
        meta: { ...item.meta, url: item.url },
      });
      if (r === "ingested") ingested += 1;
    }
    const byReason: Partial<Record<L0Reason, number>> = {};
    for (const r of screen.rejected) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
    logger.info({
      event: "insight.community.crawled",
      sourceId: source.id,
      key: def.key,
      fetched: items.length,
      accepted: screen.accepted.length,
      existing,
      ingested,
      l0Rejected: byReason,
      quotaCut: fresh.length - granted,
    });
    await capture.finish("success", items.length);
    return {
      ok: true,
      fetched: items.length,
      ingested,
      existing,
      dropped: screen.rejected.length + (fresh.length - granted),
    };
  } catch (e) {
    await capture.finish("failed", null, e instanceof Error ? e.message : String(e));
    throw e; // RateLimitedError 需原样上抛(crawlSource 识别后顺延不记失败)
  }
}

/** 试拉预览(后台「调试」:取数+解析,不落快照、不入池、不动健康度) */
export async function previewCommunityItems(
  source: { url: string; config: unknown },
  now: Date = new Date(),
): Promise<Array<{ title: string; url: string; publishedAt: Date | null }>> {
  const config =
    typeof source.config === "object" && source.config !== null
      ? (source.config as Record<string, unknown>)
      : {};
  const def = resolveCommunityDef(config);
  if (def === null) throw new Error("community 渠道 config.communityKey 未注册");
  const ctx = await buildContext(def, config, now);
  const items = def.parse(await def.collect(source.url, ctx), now);
  return items.map((i) => ({ title: i.text.split("\n")[0], url: i.url, publishedAt: i.signalAt }));
}

/** 渠道种子幂等(crawl_source 只补缺不改值;URL/启停/周期归后台所有) */
export async function syncCommunityChannels(): Promise<number> {
  const names = COMMUNITY_DEFS.map((d) => `community:${d.key}`);
  const existing = new Set(
    (
      await prisma.crawlSource.findMany({ where: { name: { in: names } }, select: { name: true } })
    ).map((r) => r.name),
  );
  for (const def of COMMUNITY_DEFS) {
    await prisma.crawlSource.upsert({
      where: { name: `community:${def.key}` },
      update: {}, // 后台已调过的 URL/周期/启停一律不覆盖
      create: {
        name: `community:${def.key}`,
        type: CRAWL_SOURCE_TYPE_COMMUNITY,
        url: def.defaultUrl,
        crawlIntervalMin: def.defaultIntervalMin,
        enabled: true,
        config: { communityKey: def.key },
        remark: def.label,
      },
      select: { id: true },
    });
  }
  // 注册表里没有的 community 行每轮必抛「key 未注册」——只停用不删行(台账/快照可回溯)
  await prisma.crawlSource.updateMany({
    where: { type: CRAWL_SOURCE_TYPE_COMMUNITY, enabled: true, NOT: { name: { in: names } } },
    data: { enabled: false },
  });
  return names.filter((n) => !existing.has(n)).length;
}
