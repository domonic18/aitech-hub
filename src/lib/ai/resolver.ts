/**
 * 绑定解析(M8 批⑥交付,M9 消费):按任务角色解析主力→备用,
 * 停用/未绑定回落;无可用模型返回 null(消费方自行降级)。
 * apiKey 在此解密(仅供调用方构造请求,禁日志/禁回传客户端)。
 */
import { prisma } from "../db";
import { decryptSecret } from "../crypto/secret-box";
import type { AiTaskRole } from "./constants";

/** 解析结果(调用面:protocol/baseUrl/modelId/apiKey/超时/并发;source 供用量台账记降级) */
export interface ResolvedAiModel {
  id: number;
  name: string;
  protocol: string;
  baseUrl: string | null;
  modelId: string;
  apiKey: string | null;
  timeoutSec: number;
  concurrency: number;
  supportsVision: boolean;
  /** 本次实际命中的绑定位:primary=主力(用量 status ok),backup=备用(degraded) */
  source: "primary" | "backup";
}

/** 选边(纯函数,单测锚点):主力存在且启用 → 主力;否则备用;否则 null */
export function pickBoundModel(
  primary: { enabled: boolean } | null,
  backup: { enabled: boolean } | null,
): "primary" | "backup" | null {
  if (primary?.enabled) return "primary";
  if (backup?.enabled) return "backup";
  return null;
}

/** 角色日配额默认值(后台未设置时兜底;设置入口 /admin/models 任务绑定卡) */
export const DEFAULT_DAILY_MAX = 100;

/** 角色日配额(条/日;ai_task_binding.daily_max,null=默认;interpret/summarize 各自消费,M15 批② 起 UI 同步可配) */
export async function getRoleDailyMax(role: AiTaskRole): Promise<number> {
  const binding = await prisma.aiTaskBinding.findUnique({
    where: { role },
    select: { dailyMax: true },
  });
  return binding?.dailyMax ?? DEFAULT_DAILY_MAX;
}

/** 解析角色绑定;未绑定/全停用 → null(M9 消费方降级) */
export async function resolveAiModel(role: AiTaskRole): Promise<ResolvedAiModel | null> {
  const binding = await prisma.aiTaskBinding.findUnique({ where: { role } });
  if (!binding) return null;
  const ids = [binding.primaryId, binding.backupId].filter((x): x is number => x !== null);
  if (ids.length === 0) return null;
  const rows = await prisma.aiModel.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      protocol: true,
      baseUrl: true,
      modelId: true,
      apiKeyEnc: true,
      apiKeyMask: true,
      timeoutSec: true,
      concurrency: true,
      supportsVision: true,
      enabled: true,
    },
  });
  const primary = rows.find((r) => r.id === binding.primaryId) ?? null;
  const backup = rows.find((r) => r.id === binding.backupId) ?? null;
  const picked = pickBoundModel(primary, backup);
  if (!picked) return null;
  const row = picked === "primary" ? primary! : backup!;
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    modelId: row.modelId,
    apiKey: row.apiKeyEnc ? decryptSecret(row.apiKeyEnc) : null,
    timeoutSec: row.timeoutSec,
    concurrency: row.concurrency,
    supportsVision: row.supportsVision,
    source: picked,
  };
}
