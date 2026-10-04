/**
 * 任务绑定管理(M8 批⑥,arch/04 §4):四角色(ai_task_binding,role 自然主键)
 * 各持主力/备用模型引用。校验:模型存在 + 启用 + purposes 含该角色;主力≠备用;
 * 双 null 允许(解绑)。M9 消费方经 resolver.ts 读绑定解析。
 */
import { z } from "zod";

import { prisma } from "../db";
import { logger } from "../logger";
import { AI_MODEL_PURPOSES, AI_ROLE_META } from "./constants";
import { AiAdminError } from "./errors";

export interface BindingRow {
  role: string;
  primaryId: number | null;
  backupId: number | null;
  /** 解读日配额(条/日;null=默认 100;当前仅 interpret 消费,M9 后台可配) */
  dailyMax: number | null;
}

/** 四角色台账;缺失角色行补齐(null/null,首访播种) */
export async function listBindingsAdmin(): Promise<BindingRow[]> {
  const rows = await prisma.aiTaskBinding.findMany();
  const byRole = new Map(rows.map((r) => [r.role, r]));
  const missing = AI_MODEL_PURPOSES.filter((role) => !byRole.has(role));
  if (missing.length > 0) {
    await prisma.aiTaskBinding.createMany({
      data: missing.map((role) => ({ role })),
      skipDuplicates: true,
    });
    for (const role of missing) {
      const created = await prisma.aiTaskBinding.findUniqueOrThrow({ where: { role } });
      byRole.set(role, created);
    }
  }
  return AI_MODEL_PURPOSES.map((role) => {
    const r = byRole.get(role)!;
    return { role: r.role, primaryId: r.primaryId, backupId: r.backupId, dailyMax: r.dailyMax };
  });
}

export const BindingUpdateSchema = z.object({
  role: z.enum(AI_MODEL_PURPOSES),
  primaryId: z.number().int().nullable(),
  backupId: z.number().int().nullable(),
  // 可选:省略 = 不动配额(部分更新语义);显式 null = 回默认 100
  dailyMax: z.number().int().min(1).max(1_000_000).nullable().optional(),
});

/**
 * 选型校验(纯函数,单测锚点):引用模型须存在启用且 purposes 含该角色,
 * 主力≠备用;双 null 允许。返回 null = 合法。
 */
export function validateBindingSelection(
  models: Array<{ id: number; enabled: boolean; purposes: string[] }>,
  role: string,
  primaryId: number | null,
  backupId: number | null,
): AiAdminError | null {
  if (primaryId !== null && backupId !== null && primaryId === backupId) {
    return new AiAdminError("invalid", "主力与备用不能为同一模型");
  }
  for (const [slot, id] of [
    ["主力", primaryId],
    ["备用", backupId],
  ] as const) {
    if (id === null) continue;
    const m = models.find((x) => x.id === id);
    if (!m) return new AiAdminError("not_found", `${slot}模型不存在`);
    if (!m.enabled) return new AiAdminError("disabled", `${slot}模型已停用,请先启用`);
    if (!m.purposes.includes(role)) {
      return new AiAdminError(
        "invalid",
        `${slot}模型用途不含「${AI_ROLE_META[role as keyof typeof AI_ROLE_META]?.label ?? role}」`,
      );
    }
  }
  return null;
}

/** 保存绑定;校验不过抛 AiAdminError(路由映射 409/404/400) */
export async function updateBinding(input: z.infer<typeof BindingUpdateSchema>): Promise<void> {
  const models = await prisma.aiModel.findMany({
    select: { id: true, enabled: true, purposes: true },
  });
  const error = validateBindingSelection(models, input.role, input.primaryId, input.backupId);
  if (error) throw error;
  await prisma.aiTaskBinding.upsert({
    where: { role: input.role },
    update: {
      primaryId: input.primaryId,
      backupId: input.backupId,
      dailyMax: input.dailyMax,
    },
    create: {
      role: input.role,
      primaryId: input.primaryId,
      backupId: input.backupId,
      dailyMax: input.dailyMax,
    },
  });
  logger.info({
    event: "ai_binding.updated",
    role: input.role,
    primaryId: input.primaryId,
    backupId: input.backupId,
    dailyMax: input.dailyMax,
  });
}
