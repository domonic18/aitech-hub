/**
 * ASR 转写渠道管理(M8 批⑥,arch/04 §4):asr_config 单例(id=1)get-or-create,
 * openai/minimax 双协议(M9 解读管道消费)。API Key write-only + 脱敏回显,
 * 语义与 models-admin 一致;转写即删红线在消费方(arch/02 §3.2),本层只管配置。
 */
import { z } from "zod";

import { prisma } from "../db";
import { logger } from "../logger";
import { decryptSecret, encryptSecret, maskSecret } from "../crypto/secret-box";
import { ASR_PROTOCOLS, TEST_STATUS_FAIL, TEST_STATUS_OK } from "./constants";
import { AiAdminError } from "./errors";

/** 脱敏视图(永不含 apiKeyEnc) */
export interface AsrConfigView {
  provider: string;
  protocol: string;
  baseUrl: string | null;
  modelId: string;
  apiKeyMask: string | null;
  maxAudioSeconds: number;
  hotwords: string[];
  enabled: boolean;
  lastTestedAt: Date | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
  lastTestLatencyMs: number | null;
  updatedAt: Date;
}

/** 单例取用;首次访问落默认行(无鉴权/禁用,等管理员配置) */
export async function getAsrConfigAdmin(): Promise<AsrConfigView> {
  const row =
    (await prisma.asrConfig.findUnique({ where: { id: 1 } })) ??
    (await prisma.asrConfig.create({
      data: { id: 1, provider: "", protocol: "openai", modelId: "whisper-1" },
    }));
  return {
    provider: row.provider,
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    modelId: row.modelId,
    apiKeyMask: row.apiKeyMask,
    maxAudioSeconds: row.maxAudioSeconds,
    hotwords: row.hotwords,
    enabled: row.enabled,
    lastTestedAt: row.lastTestedAt,
    lastTestStatus: row.lastTestStatus,
    lastTestError: row.lastTestError,
    lastTestLatencyMs: row.lastTestLatencyMs,
    updatedAt: row.updatedAt,
  };
}

export const AsrUpdateSchema = z.object({
  provider: z.string().trim().min(1, "供应商必填").max(50),
  protocol: z.enum(ASR_PROTOCOLS),
  baseUrl: z.string().trim().max(500).optional().nullable(),
  modelId: z.string().trim().min(1, "模型必填").max(100),
  apiKey: z.string().trim().max(400).optional().nullable(),
  maxAudioSeconds: z.number().int().min(10).max(7200),
  hotwords: z.array(z.string().trim().min(1).max(50)).max(50),
  enabled: z.boolean(),
});

export type AsrUpdateInput = z.infer<typeof AsrUpdateSchema>;

/** 更新单例;apiKey 空/缺省 = 保留旧值,非空 = 换钥重加密 */
export async function updateAsrConfig(input: AsrUpdateInput): Promise<void> {
  await getAsrConfigAdmin(); // 确保单例行存在(首访落默认行)
  const apiKey = input.apiKey?.trim() ? input.apiKey.trim() : null;
  await prisma.asrConfig.update({
    where: { id: 1 },
    data: {
      provider: input.provider,
      protocol: input.protocol,
      baseUrl: normalizeAsrBaseUrl(input.baseUrl ?? "") || null,
      modelId: input.modelId,
      ...(apiKey ? { apiKeyEnc: encryptSecret(apiKey), apiKeyMask: maskSecret(apiKey) } : {}),
      maxAudioSeconds: input.maxAudioSeconds,
      hotwords: input.hotwords,
      enabled: input.enabled,
    },
  });
  logger.info({
    event: "asr_config.updated",
    provider: input.provider,
    protocol: input.protocol,
    keyChanged: apiKey !== null,
    enabled: input.enabled,
  });
}

/** ASR 端点尾缀剥离(openai /audio/transcriptions;minimax /v1/speech_to_text) */
function normalizeAsrBaseUrl(raw: string): string {
  let out = raw.trim();
  while (out.endsWith("/")) out = out.slice(0, -1);
  for (const suffix of ["/audio/transcriptions", "/v1/speech_to_text", "/speech_to_text"]) {
    if (out.toLowerCase().endsWith(suffix) && out.length > suffix.length) {
      out = out.slice(0, -suffix.length);
    }
  }
  while (out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

/** 探针取数(内部解密;仅供 probe,不回客户端不入日志) */
export async function getAsrForTest(): Promise<{
  protocol: string;
  baseUrl: string | null;
  modelId: string;
  apiKey: string | null;
}> {
  const row = await prisma.asrConfig.findUnique({
    where: { id: 1 },
    select: { protocol: true, baseUrl: true, modelId: true, apiKeyEnc: true },
  });
  if (!row) throw new AiAdminError("not_found", "ASR 配置不存在");
  return {
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    modelId: row.modelId,
    apiKey: row.apiKeyEnc ? decryptSecret(row.apiKeyEnc) : null,
  };
}

/** 探针结果落库;skipped(不支持的协议)不覆盖既有结果 */
export async function recordAsrTest(r: {
  ok: boolean;
  latencyMs: number;
  detail: string;
  skipped?: boolean;
}): Promise<void> {
  if (r.skipped) return;
  await prisma.asrConfig.update({
    where: { id: 1 },
    data: {
      lastTestedAt: new Date(),
      lastTestStatus: r.ok ? TEST_STATUS_OK : TEST_STATUS_FAIL,
      lastTestError: r.ok ? null : r.detail.slice(0, 500),
      lastTestLatencyMs: r.latencyMs,
    },
  });
  logger.info({ event: "asr_config.probe", ok: r.ok, latencyMs: r.latencyMs });
}
