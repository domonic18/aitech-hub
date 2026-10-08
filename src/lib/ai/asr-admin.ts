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
import { normalizeBaseUrl } from "./models-admin";

/** asr_config 单例行锚点(全库唯一 id;消费方禁再裸写 id:1) */
export const ASR_CONFIG_ID = 1;

/** 脱敏视图(永不含 apiKeyEnc) */
export interface AsrConfigView {
  provider: string;
  protocol: string;
  baseUrl: string | null;
  modelId: string;
  apiKeyMask: string | null;
  maxAudioSeconds: number;
  hotwords: string[];
  /** 牌价(¥/小时音频;null=未填,用量页 ASR 费用按 0 折算) */
  pricePerHour: number | null;
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
    (await prisma.asrConfig.findUnique({ where: { id: ASR_CONFIG_ID } })) ??
    (await prisma.asrConfig.create({
      data: { id: ASR_CONFIG_ID, provider: "", protocol: "openai", modelId: "whisper-1" },
    }));
  return {
    provider: row.provider,
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    modelId: row.modelId,
    apiKeyMask: row.apiKeyMask,
    maxAudioSeconds: row.maxAudioSeconds,
    hotwords: row.hotwords,
    pricePerHour: row.pricePerHour,
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
  /** 牌价选填(¥/小时音频);缺省/null=未定价 */
  pricePerHour: z.number().min(0).max(100000).nullable().optional(),
  enabled: z.boolean(),
});

export type AsrUpdateInput = z.infer<typeof AsrUpdateSchema>;

/** 更新单例;apiKey 空/缺省 = 保留旧值,非空 = 换钥重加密 */
export async function updateAsrConfig(input: AsrUpdateInput): Promise<void> {
  await getAsrConfigAdmin(); // 确保单例行存在(首访落默认行)
  const apiKey = input.apiKey?.trim() ? input.apiKey.trim() : null;
  await prisma.asrConfig.update({
    where: { id: ASR_CONFIG_ID },
    data: {
      provider: input.provider,
      protocol: input.protocol,
      baseUrl: normalizeBaseUrl(input.baseUrl ?? "") || null,
      modelId: input.modelId,
      ...(apiKey ? { apiKeyEnc: encryptSecret(apiKey), apiKeyMask: maskSecret(apiKey) } : {}),
      maxAudioSeconds: input.maxAudioSeconds,
      hotwords: input.hotwords,
      pricePerHour: input.pricePerHour ?? null,
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

/** 消费侧运行时取数(apiKey 已解密;仅供解读管道,禁回传客户端禁日志)。
 * 行不存在返回 null(未初始化运营态,调用方按未启用处理)——不 get-or-create,
 * 避免只读链路写库。 */
export interface AsrRuntimeConfig {
  enabled: boolean;
  protocol: string;
  baseUrl: string | null;
  modelId: string;
  apiKey: string | null;
  maxAudioSeconds: number;
  hotwords: string[];
}

export async function getAsrRuntimeConfig(): Promise<AsrRuntimeConfig | null> {
  const row = await prisma.asrConfig.findUnique({ where: { id: ASR_CONFIG_ID } });
  if (!row) return null;
  return {
    enabled: row.enabled,
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    modelId: row.modelId,
    apiKey: row.apiKeyEnc ? decryptSecret(row.apiKeyEnc) : null,
    maxAudioSeconds: row.maxAudioSeconds,
    hotwords: row.hotwords,
  };
}

/** 探针取数(内部解密;仅供 probe,不回客户端不入日志) */
export async function getAsrForTest(): Promise<{
  protocol: string;
  baseUrl: string | null;
  modelId: string;
  apiKey: string | null;
}> {
  const cfg = await getAsrRuntimeConfig();
  if (!cfg) throw new AiAdminError("not_found", "ASR 配置不存在");
  return { protocol: cfg.protocol, baseUrl: cfg.baseUrl, modelId: cfg.modelId, apiKey: cfg.apiKey };
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
    where: { id: ASR_CONFIG_ID },
    data: {
      lastTestedAt: new Date(),
      lastTestStatus: r.ok ? TEST_STATUS_OK : TEST_STATUS_FAIL,
      lastTestError: r.ok ? null : r.detail.slice(0, 500),
      lastTestLatencyMs: r.latencyMs,
    },
  });
  logger.info({ event: "asr_config.probe", ok: r.ok, latencyMs: r.latencyMs });
}
