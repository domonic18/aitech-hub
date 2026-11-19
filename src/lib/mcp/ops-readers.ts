/**
 * MCP 运维面读侧数据装载(M75):各域健康数据的取数 + 进程内快照缓存。
 *
 * 与 tools.ops.ts 的工具定义分离:装载是「取数」,判定在 collect/health-report.ts
 * (纯函数),工具层只做拼装——三件事各归各,单个文件不超长。
 *
 * 口径纪律:读侧一律复用**后台板面同源**的现成函数,不自写第二套判定;
 * **不复用 buildChannelLedger()**(RSC 板面装配,多轮 groupBy,对高频轮询过重)。
 */
import { listPricingSourceHealth } from "@/lib/pricing/health";
import { listChannelsAdmin } from "@/lib/telegram/channels-admin";
import { listBloggersAdmin } from "@/lib/telegram/bloggers-admin";
import {
  getCrawlerQueueSnapshot,
  getGithubQueueSnapshot,
  getInterpreterQueueSnapshot,
  getSummarizerQueueSnapshot,
} from "@/lib/telegram/spider-queries";
import type { PricingHealthInput } from "@/lib/collect/health-report";

/** 巡查域(与工具入参同值) */
export const HEALTH_DOMAINS = ["pricing", "telegram", "video", "queue"] as const;

/** 快照缓存 TTL(进程内):吸收 agent 高频轮询,别把库打穿 */
const SNAPSHOT_TTL_MS = 45_000;

/** 各域读侧的进程内缓存(按域分片,TTL 内复用) */
const blockCache = new Map<string, { at: number; data: unknown }>();

/** TTL 内复用同一份快照 */
export async function cachedBlock<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = blockCache.get(key);
  const now = Date.now();
  if (hit !== undefined && now - hit.at < SNAPSHOT_TTL_MS) return hit.data as T;
  const data = await load();
  blockCache.set(key, { at: now, data });
  return data;
}

/** 牌价源健康 → 判定输入(裁字段,免得把整行塞进判定) */
export function toPricingInputs(
  rows: Awaited<ReturnType<typeof listPricingSourceHealth>>,
): PricingHealthInput[] {
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    vendor: r.vendor,
    enabled: r.enabled,
    status: r.status,
    consecutiveFails: r.consecutiveFails,
    rows: r.rows,
    lastCapture: r.lastCapture,
  }));
}

/** 渠道清单 → 判定输入(裁掉凭证/配置,只留健康面) */
export async function loadChannels(): Promise<
  Array<{
    id: number;
    name: string;
    type: string;
    enabled: boolean;
    consecutiveFails: number;
    status: string;
    lastRunAt: Date | null;
    nextRunAt: Date | null;
    count24h: number;
  }>
> {
  const rows = await listChannelsAdmin();
  return (
    rows
      // 牌价源走 pricing 域、视频平台行走 video 域,此处只留文章/资讯类采集渠道
      .filter((c) => c.type !== "pricing" && c.type !== "social_video")
      .map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        enabled: c.enabled,
        consecutiveFails: c.consecutiveFails,
        status: c.status,
        lastRunAt: c.lastRunAt,
        nextRunAt: c.nextRunAt,
        count24h: c.count24h,
      }))
  );
}

/** 队列实况 → 判定输入 */
export async function loadQueues(): Promise<
  Array<{
    name: string;
    counts: { waiting: number; active: number; completed: number; failed: number; delayed: number };
    tickAlive: boolean;
    recentFailed: Array<{
      id: string;
      name: string;
      sourceName: string | null;
      reason: string;
      at: Date | null;
    }>;
    oldestWaitingMs?: number | null;
    todayDone?: number;
    dailyMax?: number | null;
  }>
> {
  const [crawler, github, interpreter, summarizer] = await Promise.all([
    getCrawlerQueueSnapshot(),
    getGithubQueueSnapshot(),
    getInterpreterQueueSnapshot(),
    getSummarizerQueueSnapshot(),
  ]);
  return [
    {
      name: "crawler",
      counts: crawler.counts,
      tickAlive: crawler.tickAlive,
      recentFailed: crawler.recentFailed,
    },
    {
      name: "github",
      counts: github.counts,
      tickAlive: github.tickAlive,
      recentFailed: github.recentFailed,
    },
    {
      name: "interpreter",
      counts: interpreter.counts,
      tickAlive: true,
      recentFailed: [],
      oldestWaitingMs: interpreter.oldestWaitingMs,
      todayDone: interpreter.todayDone,
      dailyMax: interpreter.dailyMax,
    },
    {
      name: "summarizer",
      counts: summarizer.counts,
      tickAlive: true,
      recentFailed: [],
      oldestWaitingMs: summarizer.oldestWaitingMs,
      todayDone: summarizer.todayDone,
      dailyMax: summarizer.dailyMax,
    },
  ];
}

/** 视频博主 → 判定输入 */
export async function loadBloggers(): Promise<
  Array<{
    id: number;
    nickname: string;
    platform: string;
    enabled: boolean;
    platformEnabled: boolean;
    consecutiveFails: number;
    lastError: string | null;
    lastRunAt: Date | null;
  }>
> {
  const rows = await listBloggersAdmin();
  return rows.map((b) => ({
    id: b.id,
    nickname: b.nickname,
    platform: b.platform,
    enabled: b.enabled,
    platformEnabled: b.platformEnabled,
    consecutiveFails: b.consecutiveFails,
    lastError: b.lastError,
    lastRunAt: b.lastRunAt,
  }));
}
