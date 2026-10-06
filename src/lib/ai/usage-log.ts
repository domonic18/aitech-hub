/**
 * AI 用量台账写入/清理(M14 批⑦,验收反馈问题8):chatJsonTask(LLM)、ASR 转写、
 * 封面生图三类调用逐次落 ai_usage_log。写入失败只告警不反噬业务管道(观测数据
 * 不得阻塞主流程);聚合读侧在 usage-queries,费用读时按牌价现折算(不落库)。
 */
import { prisma } from "../db";
import { logger } from "../logger";

/** 台账单列 role 值(不属于 AI_MODEL_PURPOSES 四角色,看板单独给标签) */
export const AI_USAGE_ROLE_ASR = "asr";
export const AI_USAGE_ROLE_SEO = "seo";
export const AI_USAGE_ROLE_COVER_PROMPT = "cover-prompt";

export type AiUsageStatus = "ok" | "degraded" | "failed";

export interface AiUsageInput {
  role: string;
  /** ai_model.id(asr 行缺省) */
  modelId?: number;
  /** 展示用 model_id 文本(deepseek-chat / whisper-1 …) */
  modelKey: string;
  tokensIn?: number;
  tokensOut?: number;
  /** asr 行:转写音频秒 */
  audioSeconds?: number;
  durationMs?: number;
  /** degraded=切备用/降级(降级次数 KPI 口径);failed=终败 */
  status?: AiUsageStatus;
}

export async function recordAiUsage(input: AiUsageInput): Promise<void> {
  try {
    await prisma.aiUsageLog.create({
      data: {
        role: input.role,
        modelId: input.modelId,
        modelKey: input.modelKey.slice(0, 100),
        tokensIn: Math.max(0, Math.round(input.tokensIn ?? 0)),
        tokensOut: Math.max(0, Math.round(input.tokensOut ?? 0)),
        audioSeconds: Math.max(0, Math.round(input.audioSeconds ?? 0)),
        durationMs: Math.max(0, Math.round(input.durationMs ?? 0)),
        status: input.status ?? "ok",
      },
    });
  } catch (e) {
    logger.warn({
      event: "ai_usage.record_failed",
      role: input.role,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** 保留期(天):worker 日清与手动清理同口径 */
export const AI_USAGE_RETENTION_DAYS = 90;

/** 清理保留期前行数(手动触发与 worker cron 共用;返回删除行数) */
export async function purgeAiUsageOlderThan(days = AI_USAGE_RETENTION_DAYS): Promise<number> {
  const r = await prisma.aiUsageLog.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - days * 86_400_000) } },
  });
  return r.count;
}
