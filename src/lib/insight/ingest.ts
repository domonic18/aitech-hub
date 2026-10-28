/**
 * 洞察信号入池(M34 批①,docs/plan/insight-plan.md §3/§5):统一写侧入口——
 * 站内(评论/电报 AI 解读产物)+ 外部热榜 fetcher(批③)。调用方一律
 * fire-and-forget(void 前缀不 await):本函数自吞异常仅告警——信号少记一条
 * 可接受,主口径(PV/评论/反馈/解读)永远优先。
 * 幂等:(source, ref_id) 唯一约束,P2002 视为重复静默跳过——存量回填脚本与
 * 实时入池可安全并发;热榜源开 refreshMeta:重复条目=仍在榜,刷新 meta(批次/
 * 位次/热度)与 signal_at(持续在榜=持续热度),返回 refreshed。
 * 停接入闸(批③ 渠道转向,2026-10-18 用户定调:站内搜索/agent 问句/站点反馈
 * 三源退出洞察中心,外部渠道为主):不在 INSIGHT_SOURCES_ENABLED 的源直接短路
 * 返 disabled——存量行保留不删,读侧与聚类工作集同步按白名单过滤;恢复=集合
 * 加回,调用点无需动。
 * 归一=trim+连续空白折叠(与 normalizeSearchTerm 同构,上限不同各源自截);
 * raw 截 4000、归一截 2000(聚类/向量输入批② 消费)。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

/** 源 → 五介质映射(方案 §2):内部搜索问句=search,评论反馈=voice,
 * 电报 AI 产物=ai-record;热榜(批③)=百度/B站热搜词=搜索形态,
 * 知乎热榜=社区讨论声音 */
export const INSIGHT_SOURCE_MEDIUM = {
  "internal-search": "search",
  "internal-agent": "search",
  "internal-comment": "voice",
  "internal-feedback": "voice",
  "telegram-ai": "ai-record",
  "hot-baidu": "search",
  "hot-zhihu": "voice",
  "hot-bilibili": "search",
} as const;

export type InsightSource = keyof typeof INSIGHT_SOURCE_MEDIUM;

export type InsightMedium = (typeof INSIGHT_SOURCE_MEDIUM)[InsightSource];

/**
 * 在役源白名单(停接入闸,见文件头注):站内三源(搜索/agent/反馈)批③ 退出,
 * 评论与电报 AI 保留;热榜三源为批③ 新渠道。
 */
export const INSIGHT_SOURCES_ENABLED: ReadonlySet<InsightSource> = new Set([
  "internal-comment",
  "telegram-ai",
  "hot-baidu",
  "hot-zhihu",
  "hot-bilibili",
]);

export type IngestOutcome = "ingested" | "duplicate" | "refreshed" | "disabled" | "error";

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

export interface IngestOptions {
  /** 重复条目时刷新 meta 与 signal_at(热榜:仍在榜=位次/热度更新,信号续热) */
  refreshMeta?: boolean;
}

/** 归一口径:trim + 连续空白折叠为单空格(不动大小写;截断由调用侧上限统一收口) */
function normalizeText(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * 单条信号入池;永不 reject(内部自吞,返回结果供回填脚本统计)。
 * 空文本无挖掘价值不入池(返回 error,不打日志噪音)。
 */
export async function ingestInsightSignal(
  input: InsightSignalInput,
  opts: IngestOptions = {},
): Promise<IngestOutcome> {
  if (!INSIGHT_SOURCES_ENABLED.has(input.source)) return "disabled";
  const raw = input.rawText.trim().slice(0, RAW_MAX);
  if (raw === "") return "error";
  const normalized = normalizeText(raw).slice(0, NORMALIZED_MAX);
  const refId = input.refId.trim().slice(0, REF_ID_MAX);
  try {
    await prisma.insightSignal.create({
      data: {
        source: input.source,
        medium: INSIGHT_SOURCE_MEDIUM[input.source],
        refId,
        rawText: raw,
        normalizedText: normalized,
        // M54:落库为未分类,分类 sweep(Jev)落 domain/subdomain——
        // 分类先于同域聚类,新信号当轮即入对桶
        domain: "unclassified",
        meta: input.meta === undefined ? undefined : (input.meta as Prisma.InputJsonValue),
        signalAt: input.signalAt,
      },
      select: { id: true },
    });
    return "ingested";
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      if (opts.refreshMeta === true && input.meta !== undefined) {
        await prisma.insightSignal.updateMany({
          where: { source: input.source, refId },
          data: {
            meta: input.meta as Prisma.InputJsonValue,
            signalAt: input.signalAt,
          },
        });
        return "refreshed";
      }
      return "duplicate";
    }
    logger.warn({ event: "insight.ingest_failed", source: input.source, error: String(e) });
    return "error";
  }
}
