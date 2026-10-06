/**
 * 公众号渠道配置单例(M17 批①,镜像 asr-admin):publish_wechat_config
 * (id=1)get-or-create;appSecret write-only + 脱敏回显(secret-box
 * AES-256-GCM,AUTH_SECRET 派生——轮换使密文失效,与 ai_model 同口径需重录)。
 */
import { z } from "zod";

import { prisma } from "../db";
import { logger } from "../logger";
import { decryptSecret, encryptSecret, maskSecret } from "../crypto/secret-box";
import { TEST_STATUS_FAIL, TEST_STATUS_OK } from "../ai/constants";
import { WECHAT_DEFAULT_AUTHOR } from "./channels";
import { DistributeError } from "./errors";
import { WECHAT_THEME_IDS } from "./wechat-themes";

/** 单例行锚点(全库唯一 id;消费方禁再裸写 id:1) */
export const WECHAT_CONFIG_ID = 1;

/** 脱敏视图(永不含 appSecretEnc) */
export interface WechatConfigView {
  appid: string;
  appSecretMask: string | null;
  author: string | null;
  /** 渠道默认正文主题 id(wechat-themes 注册表;单篇弹窗可覆盖) */
  theme: string;
  autoSyncEnabled: boolean;
  enabled: boolean;
  lastTestedAt: Date | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
  lastTestLatencyMs: number | null;
  updatedAt: Date;
}

/** 单例取用;首次访问落默认行(无凭证/禁用,等管理员配置) */
export async function getWechatConfigAdmin(): Promise<WechatConfigView> {
  const row =
    (await prisma.wechatConfig.findUnique({ where: { id: WECHAT_CONFIG_ID } })) ??
    (await prisma.wechatConfig.create({ data: { id: WECHAT_CONFIG_ID, appid: "" } }));
  return {
    appid: row.appid,
    appSecretMask: row.appSecretMask,
    author: row.author,
    theme: row.theme,
    autoSyncEnabled: row.autoSyncEnabled,
    enabled: row.enabled,
    lastTestedAt: row.lastTestedAt,
    lastTestStatus: row.lastTestStatus,
    lastTestError: row.lastTestError,
    lastTestLatencyMs: row.lastTestLatencyMs,
    updatedAt: row.updatedAt,
  };
}

export const WechatConfigUpdateSchema = z.object({
  appid: z.string().trim().min(1, "AppID 必填").max(50),
  /** 空/缺省 = 保留旧 secret;非空 = 换钥重加密 */
  appSecret: z.string().trim().max(400).optional().nullable(),
  author: z.string().trim().max(64).optional().nullable(),
  /** 缺省 = 保留现值(e2e/旧客户端 PUT 不带 theme 不落 400) */
  theme: z.enum(WECHAT_THEME_IDS).optional(),
  autoSyncEnabled: z.boolean(),
  enabled: z.boolean(),
});

export type WechatConfigUpdateInput = z.infer<typeof WechatConfigUpdateSchema>;

/** 更新单例;appSecret 空/缺省 = 保留旧值,非空 = 换钥重加密 */
export async function updateWechatConfig(input: WechatConfigUpdateInput): Promise<void> {
  const current = await getWechatConfigAdmin(); // 确保单例行存在(首访落默认行)
  const secret = input.appSecret?.trim() ? input.appSecret.trim() : null;
  await prisma.wechatConfig.update({
    where: { id: WECHAT_CONFIG_ID },
    data: {
      appid: input.appid,
      ...(secret ? { appSecretEnc: encryptSecret(secret), appSecretMask: maskSecret(secret) } : {}),
      author: input.author?.trim() ? input.author.trim() : null,
      theme: input.theme ?? current.theme,
      autoSyncEnabled: input.autoSyncEnabled,
      enabled: input.enabled,
    },
  });
  logger.info({
    event: "wechat_config.updated",
    appid: input.appid,
    secretChanged: secret !== null,
    enabled: input.enabled,
    autoSync: input.autoSyncEnabled,
  });
}

/** 运行时取数(secret 已解密;仅供 sync 管道与探针,禁回传客户端禁日志)。
 * 行不存在返回 null(未初始化运营态,调用方按未启用处理)——不 get-or-create,
 * 避免只读链路写库;解密失败(AUTH_SECRET 轮换)抛 invalid 指引重录。 */
export interface WechatRuntimeConfig {
  enabled: boolean;
  autoSyncEnabled: boolean;
  appid: string;
  appSecret: string | null;
  author: string;
  /** 渠道默认正文主题 id */
  theme: string;
}

export async function getWechatRuntimeConfig(): Promise<WechatRuntimeConfig | null> {
  const row = await prisma.wechatConfig.findUnique({ where: { id: WECHAT_CONFIG_ID } });
  if (!row) return null;
  let secret: string | null = null;
  if (row.appSecretEnc) {
    try {
      secret = decryptSecret(row.appSecretEnc);
    } catch {
      throw new DistributeError(
        "invalid",
        "AppSecret 解密失败(AUTH_SECRET 已轮换?):请重新录入公众号密钥",
      );
    }
  }
  return {
    enabled: row.enabled,
    autoSyncEnabled: row.autoSyncEnabled,
    appid: row.appid,
    appSecret: secret,
    author: row.author?.trim() ? row.author.trim() : WECHAT_DEFAULT_AUTHOR,
    theme: row.theme,
  };
}

/** 探针取数(内部解密;仅供测试连接,不回客户端不入日志) */
export async function getWechatForTest(): Promise<{ appid: string; appSecret: string }> {
  const cfg = await getWechatRuntimeConfig();
  if (!cfg) throw new DistributeError("not_found", "公众号配置不存在");
  if (!cfg.appid || !cfg.appSecret) {
    throw new DistributeError("invalid", "请先录入 AppID 与 AppSecret");
  }
  return { appid: cfg.appid, appSecret: cfg.appSecret };
}

/** 探针结果落库(lastTest 四件套) */
export async function recordWechatTest(r: {
  ok: boolean;
  latencyMs: number;
  detail: string;
}): Promise<void> {
  await prisma.wechatConfig.update({
    where: { id: WECHAT_CONFIG_ID },
    data: {
      lastTestedAt: new Date(),
      lastTestStatus: r.ok ? TEST_STATUS_OK : TEST_STATUS_FAIL,
      lastTestError: r.ok ? null : r.detail.slice(0, 500),
      lastTestLatencyMs: r.latencyMs,
    },
  });
  logger.info({ event: "wechat_config.probe", ok: r.ok, latencyMs: r.latencyMs });
}

/** 渠道就绪判定(同步入口前置):enabled 且凭证齐;解密失败按未就绪
 * (入口禁用 + 配置页指引重录),不向上抛 */
export async function isWechatReady(): Promise<boolean> {
  try {
    const cfg = await getWechatRuntimeConfig();
    return cfg?.enabled === true && cfg.appid !== "" && cfg.appSecret !== null;
  } catch {
    return false;
  }
}
