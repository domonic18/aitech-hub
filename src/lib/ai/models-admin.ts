/**
 * 模型台账管理(M8 批⑥,arch/04 §4「模型配置」):ai_model 多行 CRUD + 脱敏
 * 视图 + 探针取数。API Key write-only(创建可空=无鉴权;更新空/缺省=保留),
 * AES-256-GCM 密文落 api_key_enc(密钥 AUTH_SECRET 派生),api_key_mask 冗余回显;
 * 读侧永不返回密文与明文,日志禁打凭据值。
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { logger } from "../logger";
import { decryptSecret, encryptSecret, maskSecret } from "../crypto/secret-box";
import {
  AI_MODEL_PROTOCOLS,
  AI_MODEL_PURPOSES,
  TEST_STATUS_FAIL,
  TEST_STATUS_OK,
} from "./constants";
import { AiAdminError } from "./errors";

/** 脱敏行视图(永不含 apiKeyEnc;RSC 页与 GET /api/models 共用) */
export interface AiModelRow {
  id: number;
  name: string;
  provider: string;
  protocol: string;
  baseUrl: string | null;
  modelId: string;
  apiKeyMask: string | null;
  purposes: string[];
  supportsVision: boolean;
  concurrency: number;
  timeoutSec: number;
  /** 牌价(¥/1M tokens;生图模型用 pricePerImage ¥/张;null=未填,用量页费用按 0 折算) */
  priceIn: number | null;
  priceOut: number | null;
  pricePerImage: number | null;
  enabled: boolean;
  lastTestedAt: Date | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
  lastTestLatencyMs: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const ROW_SELECT = {
  id: true,
  name: true,
  provider: true,
  protocol: true,
  baseUrl: true,
  modelId: true,
  apiKeyMask: true,
  purposes: true,
  supportsVision: true,
  concurrency: true,
  timeoutSec: true,
  priceIn: true,
  priceOut: true,
  pricePerImage: true,
  enabled: true,
  lastTestedAt: true,
  lastTestStatus: true,
  lastTestError: true,
  lastTestLatencyMs: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AiModelSelect;

/** 已知 API 路径尾缀剥离(用户常粘贴完整端点;探针/解析层自拼路径) */
const BASE_URL_SUFFIXES = [
  "/chat/completions",
  "/completions",
  "/v1/messages",
  "/messages",
  "/embeddings",
  "/audio/transcriptions",
  "/v1/speech_to_text",
  "/speech_to_text",
];

/** trim → 去尾斜杠 → 剥已知端点尾缀(循环剥,直到无匹配) */
export function normalizeBaseUrl(raw: string): string {
  let out = raw.trim();
  while (out.endsWith("/")) out = out.slice(0, -1);
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of BASE_URL_SUFFIXES) {
      if (out.toLowerCase().endsWith(suffix) && out.length > suffix.length) {
        out = out.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  while (out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

export const AiModelCreateSchema = z.object({
  name: z.string().trim().min(1, "名称必填").max(100),
  provider: z.string().trim().min(1, "供应商必填").max(20),
  protocol: z.enum(AI_MODEL_PROTOCOLS),
  baseUrl: z.string().trim().max(500).optional().nullable(),
  modelId: z.string().trim().min(1, "模型 ID 必填").max(100),
  apiKey: z.string().trim().max(400).optional().nullable(),
  purposes: z.array(z.enum(AI_MODEL_PURPOSES)).min(1, "用途至少选一项"),
  supportsVision: z.boolean(),
  concurrency: z.number().int().min(1).max(64),
  timeoutSec: z.number().int().min(5).max(600),
  /** 牌价选填(¥/1M tokens;生图 ¥/张);缺省/null=未定价 */
  priceIn: z.number().min(0).max(100000).nullable().optional(),
  priceOut: z.number().min(0).max(100000).nullable().optional(),
  pricePerImage: z.number().min(0).max(100000).nullable().optional(),
});

export type AiModelInput = z.infer<typeof AiModelCreateSchema>;

/** 模型台账(接入顺序展示;只出脱敏字段) */
export async function listModelsAdmin(): Promise<AiModelRow[]> {
  return prisma.aiModel.findMany({ orderBy: { id: "asc" }, select: ROW_SELECT });
}

/** 新增;apiKey 空/null = 无鉴权(内网网关),非空 = 加密落库 */
export async function createAiModel(input: AiModelInput): Promise<{ id: number }> {
  const apiKey = input.apiKey?.trim() ? input.apiKey.trim() : null;
  const created = await prisma.aiModel.create({
    data: {
      name: input.name,
      provider: input.provider,
      protocol: input.protocol,
      baseUrl: normalizeBaseUrl(input.baseUrl ?? "") || null,
      modelId: input.modelId,
      apiKeyEnc: apiKey ? encryptSecret(apiKey) : null,
      apiKeyMask: apiKey ? maskSecret(apiKey) : null,
      purposes: input.purposes,
      supportsVision: input.supportsVision,
      concurrency: input.concurrency,
      timeoutSec: input.timeoutSec,
      priceIn: input.priceIn ?? null,
      priceOut: input.priceOut ?? null,
      pricePerImage: input.pricePerImage ?? null,
    },
    select: { id: true },
  });
  logger.info({
    event: "ai_model.created",
    modelId: created.id,
    provider: input.provider,
    protocol: input.protocol,
    purposes: input.purposes,
    hasKey: apiKey !== null,
  });
  return created;
}

/** 更新;apiKey 空/缺省 = 保留旧值,非空 = 换钥重加密 */
export async function updateAiModel(id: number, input: AiModelInput): Promise<{ id: number }> {
  const existing = await prisma.aiModel.findUnique({
    where: { id },
    select: { apiKeyEnc: true },
  });
  if (!existing) throw new AiAdminError("not_found", "模型不存在");
  const apiKey = input.apiKey?.trim() ? input.apiKey.trim() : null;
  const updated = await prisma.aiModel.update({
    where: { id },
    data: {
      name: input.name,
      provider: input.provider,
      protocol: input.protocol,
      baseUrl: normalizeBaseUrl(input.baseUrl ?? "") || null,
      modelId: input.modelId,
      ...(apiKey ? { apiKeyEnc: encryptSecret(apiKey), apiKeyMask: maskSecret(apiKey) } : {}),
      purposes: input.purposes,
      supportsVision: input.supportsVision,
      concurrency: input.concurrency,
      timeoutSec: input.timeoutSec,
      priceIn: input.priceIn ?? null,
      priceOut: input.priceOut ?? null,
      pricePerImage: input.pricePerImage ?? null,
    },
    select: { id: true },
  });
  logger.info({
    event: "ai_model.updated",
    modelId: updated.id,
    protocol: input.protocol,
    purposes: input.purposes,
    keyChanged: apiKey !== null,
  });
  return updated;
}

/** 启停(启停不影响绑定引用;解析层跳过停用模型回落备用) */
export async function setAiModelEnabled(id: number, enabled: boolean): Promise<void> {
  const r = await prisma.aiModel.updateMany({ where: { id }, data: { enabled } });
  if (r.count === 0) throw new AiAdminError("not_found", "模型不存在");
  logger.info({ event: enabled ? "ai_model.enabled" : "ai_model.disabled", modelId: id });
}

/** 物理删:被任务绑定引用 → 409 先解绑(FK SetNull 仅作 DB 层兜底) */
export async function deleteAiModel(id: number): Promise<void> {
  const bound = await prisma.aiTaskBinding.count({
    where: { OR: [{ primaryId: id }, { backupId: id }] },
  });
  if (bound > 0) {
    throw new AiAdminError("bound", "该模型被任务绑定引用,请先在「任务绑定」中解绑");
  }
  const r = await prisma.aiModel.deleteMany({ where: { id } });
  if (r.count === 0) throw new AiAdminError("not_found", "模型不存在");
  logger.info({ event: "ai_model.deleted", modelId: id });
}

/** 探针取数(内部解密;仅供 probe 调用,不回客户端不入日志) */
export async function getModelForTest(
  id: number,
): Promise<{ protocol: string; baseUrl: string | null; modelId: string; apiKey: string | null }> {
  const row = await prisma.aiModel.findUnique({
    where: { id },
    select: { protocol: true, baseUrl: true, modelId: true, apiKeyEnc: true },
  });
  if (!row) throw new AiAdminError("not_found", "模型不存在");
  return {
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    modelId: row.modelId,
    apiKey: row.apiKeyEnc ? decryptSecret(row.apiKeyEnc) : null,
  };
}

/** 探针结果落库(probe 永不 throw;这里同步持久化 last_test 四件套) */
export async function recordModelTest(
  id: number,
  r: { ok: boolean; latencyMs: number; detail: string; skipped?: boolean },
): Promise<void> {
  if (r.skipped) return; // 不支持的协议不覆盖既有测试结果
  await prisma.aiModel.update({
    where: { id },
    data: {
      lastTestedAt: new Date(),
      lastTestStatus: r.ok ? TEST_STATUS_OK : TEST_STATUS_FAIL,
      lastTestError: r.ok ? null : r.detail.slice(0, 500),
      lastTestLatencyMs: r.latencyMs,
    },
  });
  logger.info({ event: "ai_model.probe", modelId: id, ok: r.ok, latencyMs: r.latencyMs });
}
