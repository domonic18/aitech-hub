/**
 * MCP 运维面工具表(M75):外部运营助手 agent 巡查采集健康度 + 受限自愈动作。
 *
 * 与内容/贴图工具同一端点、同一 admin PAT(不按鉴权切工具集);读侧记审计
 * (记键与命中,不记正文),写侧记 ids 与结果。
 *
 * 口径纪律:
 * - 健康读侧一律复用**后台板面同源**的现成函数(牌价源健康/渠道清单/队列实况/
 *   博主观测),不自写第二套判定——两套口径迟早分叉;
 * - **不复用 buildChannelLedger()**:它是 RSC 板面装配(多轮 groupBy),对高频
 *   轮询过重,这里用更轻的 listChannelsAdmin + 队列快照;
 * - 判定阈值集中在 `../collect/health-report.ts`(纯函数,单测直打);
 * - **写面最小**:只做「入队型重采」与「牌价上架/下架」两类,不开删除/停用源/
 *   重跑 job 这类不可逆动作;动作带冷却,防把并发为 1 的采集队列打爆。
 */
import { z } from "zod";

import { bulkReviewModelPricing } from "@/lib/pricing/admin";
import { listPricingSourceHealth } from "@/lib/pricing/health";
import { prisma } from "@/lib/db";
import { isOverLimit, recordHit } from "@/lib/auth/rate-limit";
import { listChannelsAdmin, triggerChannelCrawl } from "@/lib/telegram/channels-admin";
import {
  listBloggersAdmin,
  triggerBloggerBackfill,
  triggerBloggerCrawl,
} from "@/lib/telegram/bloggers-admin";
import { triggerRepoSync } from "@/lib/github/repos-admin";
import {
  getAsrOverview,
  getCrawlerQueueSnapshot,
  getGithubQueueSnapshot,
  getInterpreterQueueSnapshot,
  getSummarizerQueueSnapshot,
  getVideoObservation,
} from "@/lib/telegram/spider-queries";
import { logger } from "@/lib/logger";
import {
  channelProblems,
  decidePricingReview,
  pricingProblems,
  queueProblems,
  trimProblems,
  videoProblems,
  type HealthProblem,
  type PricingHealthInput,
} from "@/lib/collect/health-report";

import { fail, json } from "./json";
import { defineTool, type McpToolDef } from "./registry";

/** 巡查域(与工具入参同值) */
const HEALTH_DOMAINS = ["pricing", "telegram", "video", "queue"] as const;

/** 重采动作冷却:同一目标 5 分钟内只放一次(采集队列并发 1,重复入队会挤占真实积压) */
const RECOVERY_COOLDOWN_SECONDS = 300;

/** 快照缓存 TTL(进程内):吸收 agent 高频轮询,别把库打穿 */
const SNAPSHOT_TTL_MS = 45_000;

/** 牌价终审单次上限(agent 面比后台 UI 更严:后台 500) */
const REVIEW_MAX_IDS = 50;

/** 重采目标类型 */
const RECOVERY_TARGETS = ["channel", "blogger", "blogger_backfill", "github_repo"] as const;

/** 各域读侧的进程内缓存(按域分片,TTL 内复用) */
const blockCache = new Map<string, { at: number; data: unknown }>();

async function cachedBlock<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = blockCache.get(key);
  const now = Date.now();
  if (hit !== undefined && now - hit.at < SNAPSHOT_TTL_MS) return hit.data as T;
  const data = await load();
  blockCache.set(key, { at: now, data });
  return data;
}

/** 牌价源健康 → 判定输入(裁字段,免得把整行塞进判定) */
function toPricingInputs(
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
async function loadChannels(): Promise<
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
async function loadQueues(): Promise<
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
async function loadBloggers(): Promise<
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

/** 运维面工具表(4 只:2 只只读巡查 + 2 只受限动作) */
export const opsTools: McpToolDef[] = [
  defineTool(
    "get_health_snapshot",
    "取采集健康度总览:价格采集源 / 文章(渠道)采集 / 视频博主 / 队列与 AI 管线 四域," +
      "并给出结构化问题清单 problems[]（critical=源已挂或数据已脏, warning=降级或积压)," +
      "每条带证据与建议,可直接写进周报。domains 可只取关心的域;默认全取。",
    {
      domains: z
        .array(z.enum(HEALTH_DOMAINS))
        .max(HEALTH_DOMAINS.length)
        .optional()
        .describe("只取这些域(缺省全取):pricing 牌价 / telegram 渠道 / video 视频 / queue 队列"),
      includeProblems: z.boolean().default(true).describe("是否带 problems[] 问题清单"),
      problemLimit: z.number().int().min(1).max(50).default(20).describe("问题清单条数上限"),
    },
    async (args, actor) => {
      try {
        const want = (d: (typeof HEALTH_DOMAINS)[number]): boolean =>
          args.domains === undefined || args.domains.includes(d);
        const [pricing, channels, bloggers, queues, videoObs, asr] = await Promise.all([
          want("pricing")
            ? cachedBlock("pricing", async () => listPricingSourceHealth())
            : Promise.resolve(null),
          want("telegram") ? cachedBlock("telegram", loadChannels) : Promise.resolve(null),
          want("video") ? cachedBlock("video", loadBloggers) : Promise.resolve(null),
          want("queue") ? cachedBlock("queue", loadQueues) : Promise.resolve(null),
          want("video") ? getVideoObservation() : Promise.resolve(null),
          want("queue") ? getAsrOverview() : Promise.resolve(null),
        ]);

        const problems: HealthProblem[] = [];
        if (pricing !== null) problems.push(...pricingProblems(toPricingInputs(pricing)));
        if (channels !== null) problems.push(...channelProblems(channels));
        if (bloggers !== null) problems.push(...videoProblems(bloggers));
        if (queues !== null) problems.push(...queueProblems(queues));
        const trimmed =
          args.includeProblems === false
            ? { items: [], truncated: 0 }
            : trimProblems(problems, args.problemLimit);

        logger.info({
          event: "mcp.get_health_snapshot",
          actor,
          domains: args.domains ?? [...HEALTH_DOMAINS],
          problemCount: problems.length,
        });
        return json({
          generatedAt: new Date().toISOString(),
          blocks: {
            pricing:
              pricing === null
                ? null
                : pricing.map((p) => ({
                    key: p.key,
                    label: p.label,
                    vendor: p.vendor,
                    enabled: p.enabled,
                    intervalMin: p.intervalMin,
                    status: p.status,
                    consecutiveFails: p.consecutiveFails,
                    lastRunAt: p.lastRunAt,
                    nextRunAt: p.nextRunAt,
                    rows: p.rows,
                    lastCapture: p.lastCapture,
                  })),
            telegram: channels,
            video: bloggers === null ? null : { bloggers, observation: videoObs },
            queue: queues === null ? null : { queues, asr },
          },
          problems: trimmed.items,
          problemCount: problems.length,
          problemTruncated: trimmed.truncated,
        });
      } catch (e) {
        return fail(e);
      }
    },
  ),

  defineTool(
    "get_health_failures",
    "取一段时间内的采集失败明细(错误原文):采集快照解析失败 / 后台任务失败 / 队列失败任务 / " +
      "博主抓取失败。写周报时用它把「哪个源、报什么错」列具体。",
    {
      domain: z.enum(HEALTH_DOMAINS).optional().describe("只看某一域"),
      source: z.string().max(100).optional().describe("按源名/渠道名/博主昵称模糊过滤"),
      sinceHours: z.number().int().min(1).max(168).default(24).describe("回看窗口(小时,上限 7 天)"),
      limit: z.number().int().min(1).max(50).default(20).describe("条数上限"),
    },
    async (args, actor) => {
      try {
        const since = new Date(Date.now() - args.sinceHours * 3_600_000);
        const kw = args.source?.trim().toLowerCase() ?? "";
        const hit = (s: string | null | undefined): boolean =>
          kw === "" || (s ?? "").toLowerCase().includes(kw);

        const [snapshots, runs, bloggers, channels] = await Promise.all([
          prisma.crawlSnapshot.findMany({
            where: { capturedAt: { gte: since }, error: { not: null } },
            orderBy: { capturedAt: "desc" },
            take: args.limit,
            select: {
              sourceId: true,
              capturedAt: true,
              parseStatus: true,
              error: true,
              source: { select: { name: true } },
            },
          }),
          prisma.jobRun.findMany({
            where: { status: "failed", startedAt: { gte: since } },
            orderBy: { startedAt: "desc" },
            take: args.limit,
            select: { queue: true, jobName: true, error: true, startedAt: true },
          }),
          listBloggersAdmin(),
          listChannelsAdmin(),
        ]);

        const failures: Array<{
          domain: string;
          kind: string;
          sourceId: string;
          sourceName: string;
          error: string;
          at: string;
          status: string;
        }> = [];

        if (args.domain === undefined || args.domain === "pricing" || args.domain === "telegram") {
          for (const s of snapshots) {
            if (!hit(s.source.name)) continue;
            const domain = s.source.name.startsWith("pricing:") ? "pricing" : "telegram";
            if (args.domain !== undefined && args.domain !== domain) continue;
            failures.push({
              domain,
              kind: "snapshot",
              sourceId: String(s.sourceId),
              sourceName: s.source.name,
              error: (s.error ?? "").slice(0, 500),
              at: s.capturedAt.toISOString(),
              status: s.parseStatus,
            });
          }
        }
        if (args.domain === undefined || args.domain === "queue") {
          for (const r of runs) {
            if (!hit(`${r.queue}/${r.jobName}`)) continue;
            failures.push({
              domain: "queue",
              kind: "job_run",
              sourceId: "",
              sourceName: `${r.queue}/${r.jobName}`,
              error: (r.error ?? "").slice(0, 500),
              at: r.startedAt.toISOString(),
              status: "failed",
            });
          }
        }
        if (args.domain === undefined || args.domain === "video") {
          for (const b of bloggers) {
            if (b.lastError === null) continue;
            if (!hit(b.nickname)) continue;
            failures.push({
              domain: "video",
              kind: "blogger",
              sourceId: String(b.id),
              sourceName: b.nickname,
              error: b.lastError.slice(0, 500),
              at: (b.lastRunAt ?? new Date(0)).toISOString(),
              status: "failed",
            });
          }
        }
        if (args.domain === undefined || args.domain === "telegram" || args.domain === "pricing") {
          for (const c of channels) {
            if (c.consecutiveFails <= 0) continue;
            if (!hit(c.name)) continue;
            // 源类型决定归属域:牌价源归 pricing、视频平台归 video,其余归 telegram
            const domain =
              c.type === "pricing" ? "pricing" : c.type === "social_video" ? "video" : "telegram";
            if (args.domain !== undefined && args.domain !== domain) continue;
            failures.push({
              domain,
              kind: "channel",
              sourceId: String(c.id),
              sourceName: c.name,
              error: `连续失败 ${c.consecutiveFails} 次`,
              at: (c.lastRunAt ?? new Date(0)).toISOString(),
              status: c.status,
            });
          }
        }

        const ordered = failures
          .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
          .slice(0, args.limit);
        logger.info({
          event: "mcp.get_health_failures",
          actor,
          domain: args.domain ?? "all",
          sinceHours: args.sinceHours,
          count: ordered.length,
        });
        return json({
          window: { since: since.toISOString(), until: new Date().toISOString() },
          count: ordered.length,
          failures: ordered,
        });
      } catch (e) {
        return fail(e);
      }
    },
  ),

  defineTool(
    "trigger_recovery",
    "触发一次手动重采(仅入队,立即返回):目标可指采集渠道(channel,含牌价源)、" +
      "视频博主(blogger)、博主回补(blogger_backfill)、GitHub 仓库同步(github_repo)。" +
      "同一目标 5 分钟内只放一次(冷却),防把并发为 1 的采集队列打爆。不做删除/停用源。",
    {
      target: z.enum(RECOVERY_TARGETS).describe("重采目标类型"),
      id: z.number().int().positive().describe("目标 id(渠道/博主/仓库的 id)"),
      reason: z.string().max(200).optional().describe("触发原因(记审计)"),
    },
    async (args, actor) => {
      try {
        const bucket = `mcp:recovery:${args.target}:${args.id}`;
        if (await isOverLimit(bucket, 1)) {
          return fail(
            new Error(`该目标 ${args.target}#${args.id} 刚触发过重采,5 分钟内请勿重复触发`),
            {
              code: "cooldown",
              retryable: true,
              hint: "等冷却窗口过去再试;或先看 get_health_failures 确认是否需要",
            },
          );
        }
        await recordHit(bucket, RECOVERY_COOLDOWN_SECONDS);
        switch (args.target) {
          case "channel":
            await triggerChannelCrawl(args.id);
            break;
          case "blogger":
            await triggerBloggerCrawl(args.id);
            break;
          case "blogger_backfill":
            await triggerBloggerBackfill(args.id);
            break;
          case "github_repo":
            await triggerRepoSync(args.id);
            break;
        }
        logger.info({
          event: "mcp.trigger_recovery",
          actor,
          target: args.target,
          targetId: args.id,
          reason: args.reason ?? null,
        });
        return json({ ok: true, target: args.target, id: args.id, enqueued: true });
      } catch (e) {
        return fail(e);
      }
    },
  ),

  defineTool(
    "review_model_pricing",
    "牌价上架/下架(批量):ids 逐条给,status=enabled 上架 或 disabled 下架。" +
      "上架受闸门约束:行带「待复核」标(源上次采集失败、价已陈旧)或对应采集源不健康 → 拒;" +
      "已同态行跳过。上架须 confirm=true 并写 reason(留审计)。下架为止损,不做这两道闸。",
    {
      ids: z
        .array(z.string().regex(/^\d{1,19}$/, "id 为纯数字字符串"))
        .min(1)
        .max(REVIEW_MAX_IDS)
        .describe(`要上架/下架的牌价行 id(纯数字串,≤${REVIEW_MAX_IDS} 条;逐条给,不支持按厂商通配)`),
      status: z.enum(["enabled", "disabled"]).describe("上架= enabled;下架= disabled"),
      confirm: z.boolean().describe("上架必须显式传 true(防误触)"),
      reason: z.string().max(200).optional().describe("操作原因(记审计)"),
    },
    async (args, actor) => {
      try {
        if (args.status === "enabled" && args.confirm !== true) {
          return fail(new Error("上架属对外公开动作,必须显式传 confirm=true"), {
            code: "confirm_required",
            retryable: false,
            hint: "确认无误后带 confirm=true 重试;下架(status=disabled)无需确认",
          });
        }
        const rows = await prisma.modelPricing.findMany({
          where: { id: { in: args.ids.map((id) => BigInt(id)) } },
          select: { id: true, vendor: true, modelKey: true, status: true, note: true },
        });
        const found = new Map(rows.map((r) => [r.id.toString(), r]));
        const missing = args.ids.filter((id) => !found.has(id));

        // 源健康口径:与牌价源健康读侧同源(vendor ↔ 源)
        const sourceByVendor = new Map(
          (await listPricingSourceHealth()).map((s) => [
            s.vendor,
            { status: s.status, consecutiveFails: s.consecutiveFails },
          ]),
        );
        const decisions = decidePricingReview(
          rows.map((r) => ({
            id: r.id.toString(),
            vendor: r.vendor,
            modelKey: r.modelKey,
            status: r.status,
            note: r.note,
          })),
          args.status,
          (vendor) => sourceByVendor.get(vendor),
        );
        const applyIds = decisions.filter((d) => d.action === "apply").map((d) => d.id);
        const changed =
          applyIds.length > 0 ? await bulkReviewModelPricing(applyIds, args.status) : 0;
        const skipped = decisions
          .filter((d) => d.action === "skip")
          .map((d) => ({ id: d.id, reason: d.reason ?? "" }));
        const rejected = decisions
          .filter((d) => d.action === "reject")
          .map((d) => ({ id: d.id, reason: d.reason ?? "" }));

        logger.info({
          event: "mcp.review_model_pricing",
          actor,
          status: args.status,
          requested: args.ids.length,
          changed,
          skipped: skipped.length,
          rejected: rejected.length,
          reason: args.reason ?? null,
        });
        return json({
          ok: true,
          status: args.status,
          changed,
          applied: applyIds,
          skipped,
          rejected,
          missing,
        });
      } catch (e) {
        return fail(e);
      }
    },
  ),
];
