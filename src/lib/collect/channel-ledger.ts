/**
 * F17 采集渠道统一台账:按分组装配行(资讯 RSS / 厂商动态 / 榜单 / 社区语料 /
 * 牌价 / 视频平台 / 热榜源 / 发现任务 / GitHub)。板定六列 渠道|备注|自动调度|
 * 健康|最近运行|手动触发。动作全部消费既有 API:渠道 crawl|debug|status、
 * 博主 crawl(平台行「立即采集」= 逐启用博主入队)、insight trigger hotboard、
 * discovery trigger、github repo sync(行级 = 逐仓入队);「采集中」态取自
 * crawler 队列活跃视频 job(平台归属经 accountId 反查)。
 * 行类型与纯展示函数在 ./channel-ledger-types(客户端同源,拆文件防
 * prisma/ioredis 拖进浏览器包)。
 */
import type { JobRun } from "@prisma/client";

import { prisma } from "../db";
import { DISCOVERY_JOB_BILI, DISCOVERY_JOB_HOTWORDS, QUEUE_DISCOVERY } from "../queue";
import { INSIGHT_FETCH_CRON } from "./schedules";
import {
  SOCIAL_CRAWL_INTERVAL_MIN,
  TELEGRAM_MEDIA_VIDEO,
  VIDEO_PLATFORM_LABELS,
} from "../telegram/constants";
import { CRAWL_SOURCE_TYPE_PRICING, CRAWL_SOURCE_TYPE_SOCIAL_VIDEO } from "./constants";
import { hasSnapshots, outputCountOf, registryOutputCountByChannel } from "./channel-ledger-counts";
import { listChannelsAdmin, publicConfigJson } from "../telegram/channels-admin";
import { listHotSourcesAdmin } from "../insight/hot-source";
import { videoRunningSince } from "./crawler-runs";
import {
  channelGroupOfType,
  healthOf,
  intervalText,
  lastRunLabel,
  type ChannelLedgerRow,
} from "./channel-ledger-types";

// ── 各类行 ────────────────────────────────────────────────────────────────────

/** 文字类源行(资讯 RSS / 厂商动态 / 榜单 / 社区语料);pricing 走 pricingRows
 * 单独装配(行带快照入口),此处剔除防重复。产出计数按类型分表(registry 渠道
 * 落 insight_entity_event/insight_leaderboard_snapshot/insight_signal,见 channel-ledger-counts) */
async function sourceRows(): Promise<ChannelLedgerRow[]> {
  const [items, outputCounts] = await Promise.all([
    listChannelsAdmin(),
    registryOutputCountByChannel(),
  ]);
  return items
    .filter((c) => c.type !== CRAWL_SOURCE_TYPE_PRICING)
    .map((c) => {
      const { health, healthText } = healthOf(
        c.enabled,
        c.consecutiveFails,
        c.status as "healthy" | "error" | "degraded" | null,
      );
      return {
        key: `source-${c.id}`,
        group: channelGroupOfType(c.type),
        name: c.name,
        remark: c.remark,
        cadence: c.enabled ? intervalText(c.crawlIntervalMin) : "已暂停",
        enabled: c.enabled,
        health,
        healthText,
        lastRunLabel: lastRunLabel(c.lastRunAt, outputCountOf(c, outputCounts), "条"),
        statusEndpoint: `/api/channels/${c.id}/status`,
        primary: { type: "crawl", channelId: c.id },
        secondary: {
          type: "debug",
          channelId: c.id,
          label: health === "fail" ? "调试" : "试拉",
        },
        editChannel: {
          id: c.id,
          name: c.name,
          type: c.type,
          platform: c.platform,
          url: c.url,
          crawlIntervalMin: c.crawlIntervalMin,
          dailyMaxRequests: c.dailyMaxRequests,
          remark: c.remark,
          enabled: c.enabled,
          credentialMask: c.maskedConfig?.token ?? "",
          configJson: c.configJson,
        },
        snapshotsHref: hasSnapshots(c.type) ? `/admin/data/sources/${c.id}/snapshots/` : null,
      };
    });
}

/** 牌价渠道行(M56 验收:统一并入采集渠道维护;次钮=源页外链) */
async function pricingRows(): Promise<ChannelLedgerRow[]> {
  const items = await prisma.crawlSource.findMany({
    where: { type: CRAWL_SOURCE_TYPE_PRICING },
    orderBy: { id: "asc" },
  });
  return items.map((c) => {
    const { health, healthText } = healthOf(
      c.enabled,
      c.consecutiveFails,
      c.status as "healthy" | "error" | "degraded" | null,
    );
    return {
      key: `pricing-${c.id}`,
      group: "pricing" as const,
      name: c.name,
      remark: c.remark,
      cadence: c.enabled ? intervalText(c.crawlIntervalMin) : "已暂停",
      enabled: c.enabled,
      health,
      healthText,
      lastRunLabel: lastRunLabel(c.lastRunAt, null, "项"),
      statusEndpoint: `/api/channels/${c.id}/status`,
      primary: { type: "crawl", channelId: c.id },
      secondary: { type: "link", href: c.url, label: "源页" },
      editChannel: {
        id: c.id,
        name: c.name,
        type: c.type,
        platform: c.platform,
        url: c.url,
        crawlIntervalMin: c.crawlIntervalMin,
        dailyMaxRequests: c.dailyMaxRequests,
        remark: c.remark,
        enabled: c.enabled,
        credentialMask: "",
        configJson: publicConfigJson(c.config),
      },
      snapshotsHref: `/admin/data/sources/${c.id}/snapshots/`,
    };
  });
}

async function videoRows(): Promise<ChannelLedgerRow[]> {
  const since24h = new Date(Date.now() - 24 * 3_600_000);
  const [platformRows, bloggers, videoCounts, runningSince] = await Promise.all([
    prisma.crawlSource.findMany({
      where: { type: CRAWL_SOURCE_TYPE_SOCIAL_VIDEO },
      orderBy: { id: "asc" },
    }),
    prisma.socialAccount.findMany({
      select: {
        id: true,
        platform: true,
        enabled: true,
        platformRow: { select: { enabled: true } },
        lastRunAt: true,
      },
    }),
    prisma.telegram.groupBy({
      by: ["videoPlatform"],
      where: { mediaType: TELEGRAM_MEDIA_VIDEO, createdAt: { gte: since24h } },
      _count: { _all: true },
    }),
    videoRunningSince(),
  ]);
  const count24h = new Map(videoCounts.map((g) => [g.videoPlatform ?? "", g._count._all]));
  return platformRows.map((p) => {
    const platform = p.platform ?? p.name;
    const mine = bloggers.filter((b) => b.platform === platform);
    const enabledIds = mine.filter((b) => b.enabled && b.platformRow.enabled).map((b) => b.id);
    const lastRunAt = mine.reduce<Date | null>(
      (acc, b) => (b.lastRunAt !== null && (acc === null || b.lastRunAt > acc) ? b.lastRunAt : acc),
      null,
    );
    const since = runningSince.get(platform);
    const { health, healthText } = healthOf(p.enabled, p.consecutiveFails, null);
    return {
      key: `video-${platform}`,
      group: "video" as const,
      name: VIDEO_PLATFORM_LABELS[platform] ?? platform,
      remark: p.remark,
      cadence: p.enabled
        ? `博主 ${mine.length} · ≥${Math.round(SOCIAL_CRAWL_INTERVAL_MIN / 60)}h`
        : "已暂停",
      enabled: p.enabled,
      health,
      healthText,
      lastRunLabel: lastRunLabel(lastRunAt, count24h.get(platform) ?? 0, "条"),
      statusEndpoint: `/api/channels/${p.id}/status`,
      primary:
        since !== undefined
          ? { type: "running", sinceMs: since }
          : { type: "crawlBloggers", bloggerIds: enabledIds },
      secondary:
        since !== undefined
          ? { type: "link", href: "/admin/data/run/?t=overview", label: "查看实时 →" }
          : { type: "link", href: "/admin/data/sources/?t=bloggers", label: "编辑" },
      editChannel: null,
      snapshotsHref: null,
    };
  });
}

function hotCadence(): string {
  const minute = INSIGHT_FETCH_CRON.split(" ")[0] ?? "43";
  return `每小时 :${minute}`;
}

async function hotRows(): Promise<ChannelLedgerRow[]> {
  const items = await listHotSourcesAdmin();
  return items.map((h) => {
    const { health, healthText } = healthOf(h.enabled, h.consecutiveFails, null);
    return {
      key: `hot-${h.source}`,
      group: "hot" as const,
      name: h.label,
      remark: null,
      cadence: h.enabled ? hotCadence() : "已暂停",
      enabled: h.enabled,
      health,
      healthText,
      lastRunLabel: lastRunLabel(h.lastRunAt, h.todayCount, "条"),
      statusEndpoint: `/api/insight/hot-sources/${h.source}/status`,
      primary: { type: "hotboard" },
      secondary: { type: "link", href: "/admin/data/run/?t=jobs", label: "记录" },
      editChannel: null,
      snapshotsHref: null,
    };
  });
}

/** discovery job 摘要里的新词数(处理器回写 { inserted });无摘要不显示计数 */
function insertedFromSummary(run: Pick<JobRun, "summary"> | null): number | null {
  const s = run?.summary;
  if (s === null || s === undefined || typeof s !== "object") return null;
  const inserted = (s as Record<string, unknown>).inserted;
  return typeof inserted === "number" ? inserted : null;
}

async function discoveryRows(): Promise<ChannelLedgerRow[]> {
  const defs = [
    {
      job: "hotwords" as const,
      name: "热词发现",
      jobKey: `${QUEUE_DISCOVERY}/${DISCOVERY_JOB_HOTWORDS}`,
    },
    {
      job: "bili" as const,
      name: "B站发现",
      jobKey: `${QUEUE_DISCOVERY}/${DISCOVERY_JOB_BILI}`,
    },
  ];
  const runs = await Promise.all(
    defs.map((d) =>
      prisma.jobRun.findFirst({ where: { jobKey: d.jobKey }, orderBy: { startedAt: "desc" } }),
    ),
  );
  return defs.map((d, i) => {
    const run: JobRun | null = runs[i] ?? null;
    const inserted = insertedFromSummary(run);
    const failed = run?.status === "failed";
    return {
      key: `discovery-${d.job}`,
      group: "discovery" as const,
      name: d.name,
      remark:
        d.job === "hotwords"
          ? "种子词经 B站/Bing 搜索联想扩展,新词落 pending 待人工确认"
          : "B站双窗搜索(90 天找博主 / 7 天找热门视频),产出候选待终审",
      cadence: d.job === "hotwords" ? "每日 05:37" : "每周一 06:13",
      enabled: true,
      health: failed ? "fail" : "healthy",
      healthText: failed ? "故障·上次失败" : "健康",
      // 板「今日 05:37 · 7 词」;摘要缺新词数时不硬凑计数
      lastRunLabel: run === null ? "—" : lastRunLabel(run.startedAt, inserted, "词"),
      statusEndpoint: null,
      primary: { type: "discover", job: d.job },
      secondary: { type: "link", href: "/admin/insight/discovery/?t=words", label: "词库" },
      editChannel: null,
      snapshotsHref: null,
    };
  });
}

async function githubRows(): Promise<ChannelLedgerRow[]> {
  const repos = await prisma.githubRepo.findMany({
    select: {
      id: true,
      enabled: true,
      syncIntervalMin: true,
      lastSyncAt: true,
      consecutiveFails: true,
    },
  });
  const enabled = repos.filter((r) => r.enabled);
  const minInterval = Math.min(...enabled.map((r) => r.syncIntervalMin), 60);
  const lastSyncAt = enabled.reduce<Date | null>(
    (acc, r) =>
      r.lastSyncAt !== null && (acc === null || r.lastSyncAt > acc) ? r.lastSyncAt : acc,
    null,
  );
  const maxFails = enabled.reduce((acc, r) => Math.max(acc, r.consecutiveFails), 0);
  const { health, healthText } = healthOf(enabled.length > 0, maxFails, null);
  return [
    {
      key: "github",
      group: "github",
      name: "白名单仓库同步",
      remark: "元数据/README/commits/releases 增量同步(行级触发 = 逐仓入队)",
      cadence: intervalText(minInterval),
      enabled: enabled.length > 0,
      health,
      healthText,
      lastRunLabel: lastRunLabel(lastSyncAt, enabled.length, "仓"),
      statusEndpoint: null,
      primary: { type: "syncGithub", repoIds: enabled.map((r) => r.id) },
      secondary: { type: "link", href: "/admin/insight/discovery/?t=github", label: "白名单" },
      editChannel: null,
      snapshotsHref: null,
    },
  ];
}

/** 台账全量(RSC 一次装配;组序见 CHANNEL_GROUP_ORDER,组内按装配序) */
export async function buildChannelLedger(): Promise<ChannelLedgerRow[]> {
  const [sources, video, hot, discovery, github, pricing] = await Promise.all([
    sourceRows(),
    videoRows(),
    hotRows(),
    discoveryRows(),
    githubRows(),
    pricingRows(),
  ]);
  return [...sources, ...video, ...hot, ...discovery, ...github, ...pricing];
}

/** F19 健康表/F20 引擎卡的读侧已拆至 ./channel-health 与 ./crawler-runs(≤350 行红线) */
