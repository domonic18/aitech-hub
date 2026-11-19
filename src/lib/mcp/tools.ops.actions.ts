/**
 * MCP 运维面·受限动作工具表(M75):入队型重采 + 牌价上架/下架。
 *
 * 动作面刻意最小:只做「入队型重采」与「牌价上架/下架」两类,不开删除/停用源/
 * 重跑 job 这类不可逆动作。
 *
 * 牌价上架/下架的护栏(上架严、下架宽)见 pricing/review-gate.ts(纯函数,单测直打)。
 */
import { z } from "zod";

import { bulkReviewModelPricing } from "@/lib/pricing/admin";
import { listPricingSourceHealth } from "@/lib/pricing/health";
import { decidePricingReview } from "@/lib/pricing/review-gate";
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
