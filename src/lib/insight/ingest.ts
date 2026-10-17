/**
 * 洞察信号入池(M34 批①,docs/plan/insight-plan.md §3/§5):内部零采集源统一
 * 写侧入口——搜索词(stats beacon)/agent 问句(会话首条)/文章评论/站点反馈/
 * 电报 AI 解读产物。调用方一律 fire-and-forget(void 前缀不 await):本函数
 * 自吞异常仅告警——信号少记一条可接受,主口径(PV/评论/反馈/解读)永远优先。
 * 幂等:(source, ref_id) 唯一约束,P2002 视为重复静默跳过——存量回填脚本与
 * 实时入池可安全并发。归一=trim+连续空白折叠(与 normalizeSearchTerm 同构,
 * 上限不同各源自截);raw 截 4000、归一截 2000(聚类/向量输入批② 消费)。
 * L0 过滤批② 再接(内部源信噪比高,先全量入池)。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

/** 批① 内部源 → 五介质映射(方案 §2);外部源批③④ 起随 fetcher 显式带 medium */
export const INSIGHT_SOURCE_MEDIUM = {
  "internal-search": "search",
  "internal-agent": "search",
  "internal-comment": "voice",
  "internal-feedback": "voice",
  "telegram-ai": "ai-record",
} as const;

export type InsightSource = keyof typeof INSIGHT_SOURCE_MEDIUM;

export type InsightMedium = (typeof INSIGHT_SOURCE_MEDIUM)[InsightSource];

export type IngestOutcome = "ingested" | "duplicate" | "error";

const RAW_MAX = 4000;
const NORMALIZED_MAX = 2000;
const REF_ID_MAX = 120;

export interface InsightSignalInput {
  source: InsightSource;
  refId: string;
  rawText: string;
  signalAt: Date;
  meta?: Record<string, unknown>;
}

/** 归一口径:trim + 连续空白折叠为单空格(不动大小写;截断由调用侧上限统一收口) */
function normalizeText(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * 单条信号入池;永不 reject(内部自吞,返回结果供回填脚本统计)。
 * 空文本无挖掘价值不入池(返回 error,不打日志噪音)。
 */
export async function ingestInsightSignal(input: InsightSignalInput): Promise<IngestOutcome> {
  const raw = input.rawText.trim().slice(0, RAW_MAX);
  if (raw === "") return "error";
  const normalized = normalizeText(raw).slice(0, NORMALIZED_MAX);
  try {
    await prisma.insightSignal.create({
      data: {
        source: input.source,
        medium: INSIGHT_SOURCE_MEDIUM[input.source],
        refId: input.refId.trim().slice(0, REF_ID_MAX),
        rawText: raw,
        normalizedText: normalized,
        meta: input.meta === undefined ? undefined : (input.meta as Prisma.InputJsonValue),
        signalAt: input.signalAt,
      },
      select: { id: true },
    });
    return "ingested";
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return "duplicate";
    }
    logger.warn({ event: "insight.ingest_failed", source: input.source, error: String(e) });
    return "error";
  }
}
