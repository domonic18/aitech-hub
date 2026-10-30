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
 * 返 disabled——存量行保留不删,读侧与聚类工作集同步按白名单过滤;恢复=
 * source-registry 该源 enabled 翻回 true,调用点无需动。
 * 归一=trim+连续空白折叠(与 normalizeSearchTerm 同构,上限不同各源自截);
 * raw 截 4000、归一截 2000(聚类/向量输入批② 消费)。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { INSIGHT_JOB_TRANSLATE, QUEUE_INSIGHT, getQueue } from "@/lib/queue";

// 源→介质映射 / 在役源白名单 / InsightSource·InsightMedium 类型(M56 review P2-24
// 起单表收口):真相源在 ./source-registry,此处仅转出口保持既有 import 路径
// M58 批① 增语言/地域默认值投影(非中文源 ingest 即 pending 翻译)
import {
  INSIGHT_SOURCES_ENABLED,
  INSIGHT_SOURCE_LANG,
  INSIGHT_SOURCE_MEDIUM,
  INSIGHT_SOURCE_REGION,
  needsTranslation,
  type InsightLang,
  type InsightRegion,
  type InsightSource,
} from "./source-registry";

export { INSIGHT_SOURCES_ENABLED, INSIGHT_SOURCE_MEDIUM } from "./source-registry";
export type { InsightMedium, InsightSource } from "./source-registry";

export type IngestOutcome = "ingested" | "duplicate" | "refreshed" | "disabled" | "error";

const RAW_MAX = 4000;
const NORMALIZED_MAX = 2000;
const REF_ID_MAX = 120;

export interface InsightSignalInput {
  source: InsightSource;
  refId: string;
  rawText: string;
  signalAt: Date;
  /** 语言/地域逐条覆盖(M58;混合源用,缺省取注册表源级声明) */
  lang?: InsightLang | null;
  region?: InsightRegion | null;
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

/** 非中文信号入翻译队列(单条 job;Redis 抖动不入池失败——扫尾 cron 兜底) */
async function enqueueTranslation(signalId: bigint): Promise<void> {
  try {
    await getQueue(QUEUE_INSIGHT).add(
      INSIGHT_JOB_TRANSLATE,
      { signalId: signalId.toString() },
      {
        jobId: `insight-translate-${signalId}`,
        attempts: 1,
        removeOnComplete: 200,
        // 失败即删:确定性 jobId 在保留窗口内会静默去重(BullMQ 已知陷阱),
        // 删掉后扫尾/重投可复用同 id
        removeOnFail: true,
      },
    );
  } catch (e) {
    logger.warn({
      event: "insight.translate_enqueue_failed",
      signalId: signalId.toString(),
      error: String(e),
    });
  }
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
  const lang = input.lang ?? INSIGHT_SOURCE_LANG[input.source];
  const region = input.region ?? INSIGHT_SOURCE_REGION[input.source];
  // M58 批①:非中文源先待译——translationStatus=pending 期间不进 embedding
  // (embedding-repo 过滤),译文落库后顶替 normalizedText 再重嵌
  const translationStatus = needsTranslation(lang) ? "pending" : "none";
  try {
    const created = await prisma.insightSignal.create({
      data: {
        source: input.source,
        medium: INSIGHT_SOURCE_MEDIUM[input.source],
        lang,
        region,
        refId,
        rawText: raw,
        normalizedText: normalized,
        translationStatus,
        // M54:落库为未分类,分类 sweep(Jev)落 domain/subdomain——
        // 分类先于同域聚类,新信号当轮即入对桶
        domain: "unclassified",
        meta: input.meta === undefined ? undefined : (input.meta as Prisma.InputJsonValue),
        signalAt: input.signalAt,
      },
      select: { id: true },
    });
    if (translationStatus === "pending") await enqueueTranslation(created.id);
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
