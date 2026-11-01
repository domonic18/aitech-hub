/**
 * 站点统计 service(requirement §3.5;arch/05-services §1 分层):
 *  - ingestView:beacon 接收入口。去 bot/去管理员 → Redis 日缓冲
 *    (PV 直接缓冲;UV 按 IP+UA 哈希日去重;文章 PV 另设 1h 去重窗,arch/05-services §5);
 *    另同步落一行访问明细 stats_visit_log(全量 IP 短留存 7 天,M10 批⑥);
 *    /search 页带 q 时行级直插 stats_search_log(搜索词排行,180 天,2026-10-06);
 *    在线用户 presence 心跳(5 分钟滑窗 Redis ZSET,M28 批②,online.ts)。
 *  - purgeVisitLogs / purgeSearchLogs:worker 日调度清理保留窗口外明细行。
 *  - ingestBotFetch:爬虫抓取入账(2026-10-07 方案B,middleware→内部端点→
 *    同一 ref 日缓冲 source_class='bot';识别名单见同目录 bots.ts)。
 *  - ingestGeoFetch:GEO 机器面抓取入账(2026-10-09 方案A,面别分类见 geo.ts,
 *    独立 geo 日缓冲 → stats_geo_daily)。
 * 缓冲落库(flushStatsBuffer)在同级 flush.ts(worker 每 60s;
 * 缓冲键形 stats:buf:<kind>:<day> 由本文件写入、flush.ts 消费,改名需同批)。
 */
import { createHash } from "node:crypto";

import { deleteBatchedWhere, prisma } from "@/lib/db";
import { DAY_MS, statsDay } from "@/lib/datetime";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";
import { parsePostSegment } from "@/lib/content/post-path";
import { ingestInsightSignal } from "@/lib/insight/ingest";
import { geoPostIdOf, type GeoSurface } from "./geo";
import {
  BUFFER_TTL_SECONDS,
  POST_DEDUP_TTL_SECONDS,
  POSTMAP_TTL_SECONDS,
  UV_DEDUP_TTL_SECONDS,
  bufferKey,
  pageVisitorDedupKey,
  postLiveKey,
  postViewDedupKey,
  visitorDedupKey,
} from "./keys";
import { touchPresence } from "./online";
import {
  classifyReferrer,
  isBotUa,
  normalizePagePath,
  normalizeSearchTerm,
  parseClient,
  visitorHash,
} from "./classify";

export interface IngestInput {
  path: string;
  referrer: string | null;
  ua: string;
  ip: string;
  salt: string;
  isAdmin: boolean;
  /** /search 页携带的查询词原文(可选;仅在 path 为 /search 且 counted 时记入排行) */
  q?: string;
  /** /search 命中数(M34 批①,SearchHitMeta 经 beacon 透传):0=零结果(内容缺口
   * 信号);缺省=未统计(hit_count 落 null,增强前旧数据同口径) */
  hitCount?: number;
  /** 在线用户展示标识(可选):登录用户传用户名/邮箱,未登录不传——presence 心跳
   * 落 IP(M28 批②增量,标识解析在路由侧) */
  presenceLabel?: string;
}

export interface IngestResult {
  counted: boolean;
  reason: "ok" | "bot" | "admin";
  postCounted: boolean;
}

/** 单次上报入账;任何 Redis 故障向上抛出,由调用方返回 5xx(beacon 不重试,可接受) */
export async function ingestView(input: IngestInput): Promise<IngestResult> {
  if (isBotUa(input.ua)) return { counted: false, reason: "bot", postCounted: false };
  if (input.isAdmin) return { counted: false, reason: "admin", postCounted: false };

  const day = statsDay();
  const path = normalizePagePath(input.path);
  const vhash = visitorHash(input.salt, input.ip, input.ua);

  // 日级访客去重(站点 UV)与页级访客去重(页面 UV)分别判定
  const [uvNew, pageUvNew] = await Promise.all([
    redis.set(visitorDedupKey(day, vhash), "1", "EX", UV_DEDUP_TTL_SECONDS, "NX"),
    redis.set(pageVisitorDedupKey(day, vhash, hash16(path)), "1", "EX", UV_DEDUP_TTL_SECONDS, "NX"),
  ]);
  const isUvNew = uvNew === "OK";
  const isPageUvNew = pageUvNew === "OK";

  const ref = classifyReferrer(input.referrer);
  const client = parseClient(input.ua);

  // 键先取到局部:同一键既要写又要挂过期,分头拼字符串漏挂一个就是
  // 批次A 那类「某类缓冲恒无 TTL」缺陷(2026-11-01 批C 顺手收口)
  const bufVisit = bufferKey("visit", day);
  const bufRef = bufferKey("ref", day);
  const bufPagePv = bufferKey("page", day, "pv");
  const bufPageUv = bufferKey("page", day, "uv");
  const bufClient = bufferKey("client", day);

  const pipe = redis.pipeline();
  pipe.hincrby(bufVisit, "pv", 1);
  if (isUvNew) pipe.hincrby(bufVisit, "uv", 1);
  pipe.hincrby(bufRef, `${ref.sourceClass}|${ref.sourceName}|pv`, 1);
  if (isUvNew) pipe.hincrby(bufRef, `${ref.sourceClass}|${ref.sourceName}|uv`, 1);
  pipe.hincrby(bufPagePv, path, 1);
  if (isPageUvNew) pipe.hincrby(bufPageUv, path, 1);
  pipe.hincrby(bufClient, `${client.browser}|${client.os}|${client.deviceType}`, 1);
  for (const k of [bufVisit, bufRef, bufPagePv, bufPageUv, bufClient]) {
    pipe.expire(k, BUFFER_TTL_SECONDS);
  }
  await pipe.exec();

  // 访问明细行(M10 批⑥):不 await 不阻断 beacon,失败仅告警(明细缺失可接受,
  // 聚合口径不受影响);IP 全量短留存,明文只进这张表
  prisma.statsVisitLog
    .create({
      data: {
        path,
        ip: input.ip.slice(0, 45),
        browser: client.browser.slice(0, 50),
        os: client.os.slice(0, 50),
        deviceType: client.deviceType.slice(0, 20),
        sourceClass: ref.sourceClass,
        sourceName: ref.sourceName.slice(0, 50),
        visitorHash: vhash,
      },
    })
    .catch((e: unknown) => logger.warn({ event: "stats.visit_log.failed", error: String(e) }));

  // 搜索词排行(2026-10-06 需求):仅 /search 页 counted PV 记词;行级直插不经缓冲,
  // 同样不 await 不阻断 beacon,失败仅告警(排行少计一次可接受,不阻塞主口径)。
  // M34 批①:命中数随行落 stats_search_log(0=零结果),并链式入洞察信号池
  // (ingestInsightSignal 自吞异常不 reject,refId=搜索词行 id,幂等)
  if ((path === "/search" || path === "/search/") && input.q) {
    const term = normalizeSearchTerm(input.q);
    if (term !== "") {
      const hitCount = input.hitCount;
      prisma.statsSearchLog
        .create({ data: { term, ...(hitCount === undefined ? {} : { hitCount }) } })
        .then((row) =>
          ingestInsightSignal({
            source: "internal-search",
            refId: row.id.toString(),
            rawText: term,
            signalAt: row.createdAt,
            meta: hitCount === undefined ? undefined : { hitCount },
          }),
        )
        .catch((e: unknown) => logger.warn({ event: "stats.search_log.failed", error: String(e) }));
    }
  }

  const postCounted = await countPostView(path, vhash, day);

  // 在线用户 presence(M28 批②):5 分钟滑窗心跳(去 bot/管理员后的真实访客);
  // 标识=登录用户名/邮箱,未登录落明文 IP(仅 Redis 内存键不入表);fire-and-forget
  // 失败仅告警(在线数少刷一次可接受)
  touchPresence(
    vhash,
    path,
    input.presenceLabel
      ? { kind: "user", label: input.presenceLabel }
      : { kind: "guest", label: input.ip },
  ).catch((e: unknown) => logger.warn({ event: "stats.presence.failed", error: String(e) }));

  return { counted: true, reason: "ok", postCounted };
}

// ── 爬虫抓取入账(2026-10-07 方案B)──────────────────────────────

/**
 * 爬虫页面抓取 PV:middleware 识别已命名爬虫(AI/搜索,bots.ts 名单)后经
 * 内部端点调此函数,写进与真人流量同一个 ref 日缓冲(source_class='bot'),
 * 复用既有 flush → stats_referrer_daily,零新表。只记 PV 不去重——抓取频次
 * 本身就是观测信号;真人管道(beacon)不受影响(爬虫根本不发 beacon)。
 */
export async function ingestBotFetch(botName: string): Promise<void> {
  const day = statsDay();
  const key = bufferKey("ref", day);
  await redis
    .pipeline()
    .hincrby(key, `bot|${botName}|pv`, 1)
    .expire(key, BUFFER_TTL_SECONDS)
    .exec();
}

/**
 * GEO 机器面抓取入账(2026-10-09 方案A,GEO 统计):llms.txt 索引 / llms-full
 * 全文 / 文章 .md 直出三个机器专属面的抓取计数,独立 geo 日缓冲 → flush 落
 * stats_geo_daily(面 × 爬虫 × 文章粒度)。middleware 对 GEO 路径不分名单内外
 * 一律上报(长尾 Agent 不可枚举,未识别 UA 记 unknown-agent);只记 PV 不去重
 * (抓取频次即信号)。.md 抓取刻意不计入 content_post.views_count——那是真人
 * 阅读口径(方案A决策点②);命名爬虫的页面抓取总账仍走 ingestBotFetch。
 */
export async function ingestGeoFetch(
  surface: GeoSurface,
  botName: string,
  rawPath: string,
): Promise<void> {
  const day = statsDay();
  const key = bufferKey("geo", day);
  const postId = geoPostIdOf(surface, rawPath) ?? "";
  await redis
    .pipeline()
    .hincrby(key, `${surface}|${botName}|${postId}`, 1)
    .expire(key, BUFFER_TTL_SECONDS)
    .exec();
}

// ── 明细保留(worker 日调度,M10 批⑥)────────────────────────────────

/** 明细保留天数(2026-10-04 用户定调:全量 IP + 7 天短留存) */
const VISIT_LOG_RETENTION_DAYS = 7;

/** 清理保留窗口外的访问明细;返回删除行数(0 不打日志);分批防超时(M48 批F) */
export async function purgeVisitLogs(): Promise<number> {
  const cutoff = new Date(Date.now() - VISIT_LOG_RETENTION_DAYS * DAY_MS);
  return deleteBatchedWhere(prisma.statsVisitLog, { createdAt: { lt: cutoff } });
}

/** 搜索词明细保留天数(无 PII,比访问明细长;排行「全部」窗口的实际上界) */
const SEARCH_LOG_RETENTION_DAYS = 180;

/** 清理保留窗口外的搜索词明细;返回删除行数(0 不打日志);分批防超时(M48 批F) */
export async function purgeSearchLogs(): Promise<number> {
  const cutoff = new Date(Date.now() - SEARCH_LOG_RETENTION_DAYS * DAY_MS);
  return deleteBatchedWhere(prisma.statsSearchLog, { createdAt: { lt: cutoff } });
}

function hash16(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

/** 文章页 PV:路径形如 /post/<id>(-<slug>)?/ 才计(2026-10 URL 终态,id 锚定);
 * 同访客同文章 1h 一窗(防刷新虚增阅读数)。旧单段路径不再归属文章(迁移过渡期缓存页上报,量小可弃)。 */
async function countPostView(path: string, vhash: string, day: string): Promise<boolean> {
  const seg = path.replace(/^\/+|\/+$/g, "");
  if (!seg.startsWith("post/")) return false;
  const parsed = parsePostSegment(seg.slice("post/".length));
  if (!parsed) return false;
  const postId = parsed.id.toString();

  const mapKey = postLiveKey(postId);
  let live = await redis.get(mapKey);
  if (live === null) {
    const row = await prisma.post.findUnique({
      where: { id: parsed.id },
      select: { status: true, publishedAt: true },
    });
    live = row && row.status === "published" && row.publishedAt !== null ? "1" : "0";
    await redis.set(mapKey, live, "EX", POSTMAP_TTL_SECONDS);
  }
  if (live === "0") return false;

  const fresh =
    (await redis.set(
      postViewDedupKey(day, vhash, postId),
      "1",
      "EX",
      POST_DEDUP_TTL_SECONDS,
      "NX",
    )) === "OK";
  if (!fresh) return false;
  // 与其余五类缓冲同口径补兜底过期:此前只有本键裸增不设 TTL,worker 长停时
  // 该键永不过期,且 flush 的私有暂存键会继承到这个「无 TTL」态(2026-11-01 修复)。
  const bufKey = bufferKey("post", day);
  await redis.pipeline().hincrby(bufKey, postId, 1).expire(bufKey, BUFFER_TTL_SECONDS).exec();
  return true;
}
