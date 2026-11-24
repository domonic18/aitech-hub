/**
 * MCP 运维面·牌价行巡查只读工具(M79):给运营助手 agent 补上「眼睛」——
 * review_model_pricing 只收行 id,而 id 从哪来此前只能站长从后台抄给它。
 *
 * 本工具按状态/厂商筛模型牌价行,带【待复核】标、人工定稿标与**对应采集源
 * 的健康状态**(源\u2194行按 vendor + model 产出面解析,与 review 工具同一口径),
 * agent 可自助完成「巡查 → 圈行 → 分批上架/下架」闭环。
 *
 * 口径纪律:健康读侧复用 listPricingSourceHealth(后台板面同源,走 45s 进程内
 * 缓存),不自写第二套;只读入参有界(limit ≤100),审计记键与条数不记正文。
 */
import { z } from "zod";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { listPricingSourceHealth } from "@/lib/pricing/health";

import { fail, json } from "./json";
import { cachedBlock } from "./ops-readers";
import { defineTool, type McpToolDef } from "./registry";

/** Decimal(12,4) → number(展示口径;单批 ≤100 行,无精度放大问题) */
const dec = (v: { toNumber(): number } | null): number | null => (v === null ? null : v.toNumber());

export const opsPricingTools: McpToolDef[] = [
  defineTool(
    "list_model_pricing",
    "模型牌价行清单:巡查价格牌位状态、圈定待审行的只读工具。返回行 id、价格、" +
      "计价单位、状态(pending 待审/enabled 已上架/disabled 已下架)、是否带【待复核】标" +
      "(源上次采集失败、价已陈旧,上架会被闸门拒)、是否人工定稿、数据截至日,以及该行" +
      "厂商对应采集源的健康状态(与 review_model_pricing 同一解析口径)。" +
      "典型用法:status=pending 拿待审行 → 过滤掉 hasRecheckMark=true 与 sourceHealth 不健康的行" +
      "→ 把其余行的 id 交给 review_model_pricing 分批上架(单次 ≤50 ids)。",
    {
      status: z
        .enum(["pending", "enabled", "disabled", "all"])
        .default("pending")
        .describe("行状态筛选;缺省 pending(待审队列)"),
      vendor: z.string().max(40).optional().describe("按厂商模糊过滤(包含匹配)"),
      onlyRecheck: z
        .boolean()
        .optional()
        .describe("只看带【待复核】标的行(源上次采集失败、价已陈旧)"),
      limit: z.number().int().min(1).max(100).default(50).describe("本页条数"),
      offset: z.number().int().min(0).max(10000).default(0).describe("翻页偏移"),
    },
    async (args, actor) => {
      try {
        const vendor = args.vendor?.trim() ?? "";
        const where = {
          ...(args.status !== "all" ? { status: args.status } : {}),
          ...(vendor !== "" ? { vendor: { contains: vendor } } : {}),
          ...(args.onlyRecheck === true ? { note: { contains: "【待复核" } } : {}),
        };
        const [total, rows, sources] = await Promise.all([
          prisma.modelPricing.count({ where }),
          prisma.modelPricing.findMany({
            where,
            orderBy: [{ vendor: "asc" }, { modelKey: "asc" }],
            skip: args.offset,
            take: args.limit,
            select: {
              id: true,
              vendor: true,
              modelKey: true,
              currency: true,
              priceUnit: true,
              inputPrice: true,
              outputPrice: true,
              status: true,
              note: true,
              isPinned: true,
              dataAsOf: true,
            },
          }),
          cachedBlock("pricing", listPricingSourceHealth),
        ]);
        // 源\u2194行解析同 review 工具:vendor + model 产出面(套餐源不串)
        const sourceByVendor = new Map(
          sources.filter((s) => s.target === "model").map((s) => [s.vendor, s]),
        );
        logger.info({
          event: "mcp.list_model_pricing",
          actor,
          status: args.status,
          vendor: vendor !== "" ? vendor : null,
          onlyRecheck: args.onlyRecheck === true,
          count: rows.length,
          total,
        });
        return json({
          total,
          offset: args.offset,
          limit: args.limit,
          count: rows.length,
          rows: rows.map((r) => {
            const src = sourceByVendor.get(r.vendor) ?? null;
            return {
              id: r.id.toString(),
              vendor: r.vendor,
              modelKey: r.modelKey,
              currency: r.currency,
              priceUnit: r.priceUnit,
              inputPrice: dec(r.inputPrice),
              outputPrice: dec(r.outputPrice),
              status: r.status,
              hasRecheckMark: (r.note ?? "").includes("【待复核"),
              isPinned: r.isPinned,
              dataAsOf: r.dataAsOf.toISOString().slice(0, 10),
              note: r.note === null ? null : r.note.slice(0, 120),
              sourceHealth:
                src === null
                  ? null
                  : { status: src.status, consecutiveFails: src.consecutiveFails },
            };
          }),
        });
      } catch (e) {
        return fail(e);
      }
    },
  ),
];
