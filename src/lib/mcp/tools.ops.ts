/**
 * MCP 运维面·只读巡查工具表(M75):外部运营助手 agent 巡查采集健康度。
 *
 * 与内容/贴图工具同一端点、同一 admin PAT(不按鉴权切工具集);读侧记审计
 * (记键与命中,不记正文)。
 *
 * 口径纪律:
 * - 健康读侧一律复用**后台板面同源**的现成函数(牌价源健康/渠道清单/队列实况/
 *   博主观测),不自写第二套判定——两套口径迟早分叉;
 * - 取数在 ops-readers.ts,判定在 collect/health-report.ts,本文件只做拼装;
 * - **写面在 tools.ops.actions.ts**(入队型重采 + 牌价上架/下架)。
 */
import { z } from "zod";

import { prisma } from "@/lib/db";
import { listChannelsAdmin } from "@/lib/telegram/channels-admin";
import { listBloggersAdmin } from "@/lib/telegram/bloggers-admin";
import { getAsrOverview, getVideoObservation } from "@/lib/telegram/spider-queries";
import { logger } from "@/lib/logger";
import {
  aiindexProblems,
  channelProblems,
  pricingProblems,
  queueProblems,
  trimProblems,
  videoProblems,
  type HealthProblem,
} from "@/lib/collect/health-report";

import { fail, json } from "./json";
import { defineTool, type McpToolDef } from "./registry";
import {
  cachedBlock,
  HEALTH_DOMAINS,
  loadAiIndexHealth,
  loadBloggers,
  loadChannels,
  loadQueues,
  toPricingInputs,
} from "./ops-readers";
import { listPricingSourceHealth } from "@/lib/pricing/health";

/** 运维面只读工具表(2 只:总览 + 失败明细) */
export const opsReadTools: McpToolDef[] = [
  defineTool(
    "get_health_snapshot",
    "取采集健康度总览:价格采集源 / 文章(渠道)采集 / 视频博主 / 队列与 AI 管线 / " +
      "AI 智能指数能力水位 五域," +
      "并给出结构化问题清单 problems[]（critical=源已挂或数据已脏, warning=降级或积压)," +
      "每条带证据与建议,可直接写进周报。domains 可只取关心的域;默认全取。",
    {
      domains: z
        .array(z.enum(HEALTH_DOMAINS))
        .max(HEALTH_DOMAINS.length)
        .optional()
        .describe(
          "只取这些域(缺省全取):pricing 牌价 / telegram 渠道 / video 视频 / queue 队列 / aiindex 指数能力层",
        ),
      includeProblems: z.boolean().default(true).describe("是否带 problems[] 问题清单"),
      problemLimit: z.number().int().min(1).max(50).default(20).describe("问题清单条数上限"),
    },
    async (args, actor) => {
      try {
        const want = (d: (typeof HEALTH_DOMAINS)[number]): boolean =>
          args.domains === undefined || args.domains.includes(d);
        const [pricing, channels, bloggers, queues, videoObs, asr, aiIndex] = await Promise.all([
          want("pricing")
            ? cachedBlock("pricing", async () => listPricingSourceHealth())
            : Promise.resolve(null),
          want("telegram") ? cachedBlock("telegram", loadChannels) : Promise.resolve(null),
          want("video") ? cachedBlock("video", loadBloggers) : Promise.resolve(null),
          want("queue") ? cachedBlock("queue", loadQueues) : Promise.resolve(null),
          want("video") ? getVideoObservation() : Promise.resolve(null),
          want("queue") ? getAsrOverview() : Promise.resolve(null),
          want("aiindex") ? cachedBlock("aiindex", loadAiIndexHealth) : Promise.resolve(null),
        ]);

        const problems: HealthProblem[] = [];
        if (pricing !== null) problems.push(...pricingProblems(toPricingInputs(pricing)));
        if (channels !== null) problems.push(...channelProblems(channels));
        if (bloggers !== null) problems.push(...videoProblems(bloggers));
        if (queues !== null) problems.push(...queueProblems(queues));
        if (aiIndex !== null) problems.push(...aiindexProblems(aiIndex));
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
                    target: p.target,
                    url: p.url,
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
            aiindex: aiIndex,
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
            // ai-index 队列归 aiindex 域,不在 queue 域重复计
            if (r.queue === "ai-index") continue;
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
        if (args.domain === undefined || args.domain === "aiindex") {
          for (const r of runs) {
            if (r.queue !== "ai-index") continue;
            if (!hit(`${r.queue}/${r.jobName}`)) continue;
            failures.push({
              domain: "aiindex",
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
];
