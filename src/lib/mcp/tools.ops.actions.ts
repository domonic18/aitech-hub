/**
 * MCP 运维面·受限动作工具表(M75):入队型重采 + 牌价上架/下架。
 *
 * 动作面刻意最小:只做「入队型重采」与「牌价上架/下架」两类,不开删除/停用源/
 * 重跑 job 这类不可逆动作。
 *
 * 牌价上架/下架的护栏(上架严、下架宽)见 pricing/review-gate.ts(纯函数,单测直打)。
 */
import { z } from "zod";

import { bulkReviewModelPricing } from "@/lib/pricing/admin-model";
import { listPricingSourceHealth } from "@/lib/pricing/health";
import { buildPricingSourceResolver } from "@/lib/pricing/source-resolve";
import { decidePricingReview } from "@/lib/pricing/review-gate";
import { offlinePricingSource } from "@/lib/pricing/offline-source";
import { prisma } from "@/lib/db";
import { isOverLimit, recordHit } from "@/lib/auth/rate-limit";
import { triggerChannelCrawl } from "@/lib/telegram/channels-admin";
import { triggerBloggerBackfill, triggerBloggerCrawl } from "@/lib/telegram/bloggers-admin";
import { triggerRepoSync } from "@/lib/github/repos-admin";
import { logger } from "@/lib/logger";

import { fail, json } from "./json";
import { defineTool, type McpToolDef } from "./registry";

/** 重采动作冷却:同一目标 5 分钟内只放一次(采集队列并发 1,重复入队会挤占真实积压) */
const RECOVERY_COOLDOWN_SECONDS = 300;

/** 牌价终审单次上限(agent 面比后台 UI 更严:后台 500) */
const REVIEW_MAX_IDS = 50;

/** 跳过行回显上限(其余只给计数——回执全量会撑爆 agent 上下文) */
const SKIPPED_ECHO_MAX = 20;

/** 重采目标类型 */
const RECOVERY_TARGETS = ["channel", "blogger", "blogger_backfill", "github_repo"] as const;

/** 运维面动作工具表(2 只:重采 + 牌价终审) */
export const opsActionTools: McpToolDef[] = [
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
          select: {
            id: true,
            vendor: true,
            modelKey: true,
            status: true,
            note: true,
            isPinned: true,
            provider: { select: { key: true } },
          },
        });
        const found = new Map(rows.map((r) => [r.id.toString(), r]));
        const missing = args.ids.filter((id) => !found.has(id));

        // 源健康口径:与牌价源健康读侧同源,走 source-resolve(providerKey +
        // 产出面优先,vendor 兜底)——聚合行(词元所·XXX)靠 providerKey 连上源,
        // 同厂商的模型源与套餐源分开
        const resolveSource = buildPricingSourceResolver(await listPricingSourceHealth());
        const decisions = decidePricingReview(
          rows.map((r) => ({
            id: r.id.toString(),
            vendor: r.vendor,
            modelKey: r.modelKey,
            status: r.status,
            note: r.note,
            isPinned: r.isPinned,
            target: "model" as const,
            providerKey: r.provider?.key ?? null,
          })),
          args.status,
          (row) => {
            const src = resolveSource(row);
            return src === undefined
              ? undefined
              : { status: src.status, consecutiveFails: src.consecutiveFails };
          },
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

  defineTool(
    "offline_pricing_source",
    "把某个牌价采集源因抓取失败而陈旧的**已上架**数据下架(止损):按 sourceKey 定位源," +
      "圈定该源名下的行(口径同健康读侧:providerKey + 产出面优先、vendor 兜底)," +
      "把 status=enabled 的置 disabled。人工定稿行(is_pinned)与待终审行不动;已下架的跳过(幂等)。" +
      "必须 confirm=true 并写 reason(记审计)。**只下架不上架**——重新上架走逐条 review_model_pricing。" +
      "本工具只负责执行下架,**该不该下架由调用方判断**:回执带源的状态、连败次数与最近采集错误原文," +
      "请先用 get_health_snapshot 核对再下架(源完全健康时本工具会拒)。",
    {
      sourceKey: z
        .string()
        .trim()
        .min(1)
        .max(60)
        .describe("牌价源 key(如 tencent-tokenplan),取自 get_health_snapshot 的 pricing 段"),
      confirm: z.boolean().describe("必须显式传 true(防误触)"),
      reason: z.string().min(1).max(200).describe("下架原因(记审计):写清源失败与时间"),
    },
    async (args, actor) => {
      try {
        if (args.confirm !== true) {
          return fail(new Error("下架属对外可见动作,必须显式传 confirm=true"), {
            code: "confirm_required",
            retryable: false,
            hint: "确认无误后带 confirm=true 重试",
          });
        }
        const src = (await listPricingSourceHealth()).find((s) => s.key === args.sourceKey);
        if (src === undefined) {
          return fail(new Error(`找不到牌价源 pricing:${args.sourceKey}`), {
            code: "not_found",
            retryable: false,
            hint: "sourceKey 取自 get_health_snapshot 的 pricing 段 key",
          });
        }
        // 最小闸:完全健康的源拒(把好价打成错价);其余该不该下架由调用方判断
        if (src.status === "healthy" && src.consecutiveFails === 0) {
          return fail(new Error(`牌价源 ${src.label} 当前健康(status=healthy,连败 0),不应下架`), {
            code: "source_healthy",
            retryable: false,
            hint: "确认要下架请先用 get_health_snapshot 看该源的真实状态",
          });
        }
        const result = await offlinePricingSource({
          vendor: src.vendor,
          target: src.target,
          providerKey: src.providerKey,
        });
        logger.info({
          event: "mcp.offline_pricing_source",
          actor,
          sourceKey: args.sourceKey,
          vendor: src.vendor,
          target: src.target,
          changed: result.changed.length,
          applied: result.applied,
          skipped: result.skipped.length,
          reason: args.reason,
        });
        return json({
          ok: true,
          sourceKey: src.key,
          sourceLabel: src.label,
          vendor: src.vendor,
          target: src.target,
          // 源的事实(判断依据在调用方侧):状态/连败/最近采集错误原文
          sourceStatus: src.status,
          consecutiveFails: src.consecutiveFails,
          lastCaptureError: src.lastCapture?.error ?? null,
          rows: src.rows,
          // 匹配口径:vendor 逐字相等 + 产出面(与健康读侧同源)
          matchRule: "vendor 逐字相等 + 产出面(model/plan)",
          changed: result.changed,
          applied: result.applied,
          skippedTotal: result.skipped.length,
          skipped: result.skipped.slice(0, SKIPPED_ECHO_MAX),
          reason: args.reason,
        });
      } catch (e) {
        return fail(e);
      }
    },
  ),
];
