/**
 * 飞书免登配置单例(M29 批①,镜像 publish_wechat_config):admin_feishu_config
 * (id=1)get-or-create;appSecret write-only + 脱敏回显(secret-box AES-256-GCM,
 * AUTH_SECRET 派生——轮换使密文失效需重录)。enabled=免登通道总开关;绑定
 * 流程只要求凭证齐(enabled 可后开),status 下发同口径——appId 下发/绑定
 * 是启用前置。
 */
import { z } from "zod";

import { TEST_STATUS_FAIL, TEST_STATUS_OK } from "@/lib/ai/constants";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto/secret-box";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

/** 单例行锚点(全库唯一 id;消费方禁再裸写 id:1) */
export const FEISHU_CONFIG_ID = 1;

/** 脱敏视图(永不含 appSecretEnc;日期 ISO 字符串——过 RSC 边界不失真) */
export interface FeishuConfigView {
  appId: string;
  appSecretMask: string | null;
  enabled: boolean;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
  lastTestLatencyMs: number | null;
  updatedAt: string | null;
}

/** 单例取用;首次访问落默认行(无凭证/禁用,等管理员配置) */
export async function getFeishuConfigAdmin(): Promise<FeishuConfigView> {
  const row =
    (await prisma.adminFeishuConfig.findUnique({ where: { id: FEISHU_CONFIG_ID } })) ??
    (await prisma.adminFeishuConfig.create({ data: { id: FEISHU_CONFIG_ID, appId: "" } }));
  return {
    appId: row.appId,
    appSecretMask: row.appSecretMask,
    enabled: row.enabled,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestStatus: row.lastTestStatus,
    lastTestError: row.lastTestError,
    lastTestLatencyMs: row.lastTestLatencyMs,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const FeishuConfigUpdateSchema = z.object({
  appId: z.string().trim().min(1, "AppID 必填").max(50),
  /** 空/缺省 = 保留旧 secret;非空 = 换钥重加密 */
  appSecret: z.string().trim().max(400).optional().nullable(),
  enabled: z.boolean(),
});

export type FeishuConfigUpdateInput = z.infer<typeof FeishuConfigUpdateSchema>;

/** 更新单例;appSecret 空/缺省 = 保留旧值,非空 = 换钥重加密 */
export async function updateFeishuConfig(input: FeishuConfigUpdateInput): Promise<void> {
  await getFeishuConfigAdmin(); // 确保单例行存在(首访落默认行)
  const secret = input.appSecret?.trim() ? input.appSecret.trim() : null;
  await prisma.adminFeishuConfig.update({
    where: { id: FEISHU_CONFIG_ID },
    data: {
      appId: input.appId,
      ...(secret ? { appSecretEnc: encryptSecret(secret), appSecretMask: maskSecret(secret) } : {}),
      enabled: input.enabled,
    },
  });
  logger.info({
    event: "feishu_config.updated",
    appId: input.appId,
    secretChanged: secret !== null,
    enabled: input.enabled,
  });
}

/** 运行时取数(secret 已解密;仅供兑换/签名/绑定/探针,禁回传客户端禁日志)。
 * 行不存在返回 null(未初始化运营态,调用方按未启用处理)——不 get-or-create,
 * 避免只读链路写库;解密失败(如 AUTH_SECRET 已轮换)同样归 null,全部调用方
 * 沿既有「凭证不齐」分支 fail-closed,细节只进日志。 */
export interface FeishuRuntimeConfig {
  enabled: boolean;
  appId: string;
  appSecret: string | null;
}

export async function getFeishuRuntimeConfig(): Promise<FeishuRuntimeConfig | null> {
  const row = await prisma.adminFeishuConfig.findUnique({ where: { id: FEISHU_CONFIG_ID } });
  if (!row) return null;
  let secret: string | null = null;
  if (row.appSecretEnc) {
    secret = decryptSecret(row.appSecretEnc);
    if (secret === null) {
      logger.warn({ event: "feishu.config.decrypt_failed" });
      return null;
    }
  }
  return { enabled: row.enabled, appId: row.appId, appSecret: secret };
}

/** 探针结果落库(lastTest 四件套) */
export async function recordFeishuTest(r: {
  ok: boolean;
  latencyMs: number;
  detail: string;
}): Promise<void> {
  await prisma.adminFeishuConfig.update({
    where: { id: FEISHU_CONFIG_ID },
    data: {
      lastTestedAt: new Date(),
      lastTestStatus: r.ok ? TEST_STATUS_OK : TEST_STATUS_FAIL,
      lastTestError: r.ok ? null : r.detail.slice(0, 500),
      lastTestLatencyMs: r.latencyMs,
    },
  });
  logger.info({ event: "feishu_config.probe", ok: r.ok, latencyMs: r.latencyMs });
}
