/**
 * 公众号私信入站配置读写(M66,plan/wechat-mp-bot-plan §4)。
 *
 * 单行语义(id=1)+ 整行覆盖,与 email/pay/sms 配置同款。**不含公众号凭据**:
 * appid/appsecret 一律经 `publish_wechat_config` 单源读取(M17),本表只存
 * 「接收消息服务器配置」的 Token / EncodingAESKey 与三档话术。
 *
 * EncodingAESKey 走 secret-box(write-only,读侧只回 Set 布尔 + 掩码),
 * 循 `channel_wechat_mp_config.encoding_aes_key_enc` 列契约。
 */
import { z } from "zod";

import { encryptTagged, maskSecret, readSecretCompat } from "@/lib/crypto/secret-box";
import { prisma } from "@/lib/db";

import { WECHAT_MP_DEFAULT_HANDOFF_KEYWORDS, WECHAT_MP_DEFAULT_TEXTS } from "./constants";

/** EncodingAESKey 官方形态(Base64 字母表去尾 `=` 共 43 位) */
const AES_KEY_RE = /^[A-Za-z0-9+/]{43}$/;
/** Token 官方 3–32 位 */
const TOKEN_RE = /^[A-Za-z0-9_-]{3,32}$/;

export const WechatMpConfigUpdateSchema = z.object({
  token: z.string().trim().max(32),
  /** 留空 = 保留原值(首次录入必填,由调用方在开启时校验) */
  encodingAESKey: z.string().trim().max(64).optional(),
  enabled: z.boolean(),
  greetingText: z.string().trim().max(500),
  fallbackText: z.string().trim().max(500),
  handoffText: z.string().trim().max(500),
  handoffKeywords: z.array(z.string().trim().min(1).max(20)).max(20),
  dailyAnswerLimit: z.coerce.number().int().min(1).max(10_000),
});
export type WechatMpConfigUpdateInput = z.infer<typeof WechatMpConfigUpdateSchema>;

/** admin 读侧视图(密钥只暴露是否已设 + 掩码) */
export interface WechatMpConfigView {
  token: string;
  encodingAesKeySet: boolean;
  encodingAesKeyMask: string | null;
  /** 只读回显:与出站分发共用的公众号 AppID(publish_wechat_config) */
  appId: string;
  enabled: boolean;
  greetingText: string;
  fallbackText: string;
  handoffText: string;
  handoffKeywords: string[];
  dailyAnswerLimit: number;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
  lastTestLatencyMs: number | null;
  updatedAt: string | null;
}

type ConfigRow = {
  token: string;
  encodingAesKeyEnc: string | null;
  encodingAesKeyMask: string | null;
  enabled: boolean;
  greetingText: string;
  fallbackText: string;
  handoffText: string;
  handoffKeywords: string[];
  dailyAnswerLimit: number;
  lastTestedAt: Date | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
  lastTestLatencyMs: number | null;
  updatedAt: Date;
};

function toView(row: ConfigRow, appId: string): WechatMpConfigView {
  return {
    token: row.token,
    encodingAesKeySet: Boolean(row.encodingAesKeyEnc),
    encodingAesKeyMask: row.encodingAesKeyMask,
    appId,
    enabled: row.enabled,
    greetingText: row.greetingText,
    fallbackText: row.fallbackText,
    handoffText: row.handoffText,
    handoffKeywords: row.handoffKeywords,
    dailyAnswerLimit: row.dailyAnswerLimit,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestStatus: row.lastTestStatus,
    lastTestError: row.lastTestError,
    lastTestLatencyMs: row.lastTestLatencyMs,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

const EMPTY_VIEW: WechatMpConfigView = {
  token: "",
  encodingAesKeySet: false,
  encodingAesKeyMask: null,
  appId: "",
  enabled: false,
  greetingText: "",
  fallbackText: "",
  handoffText: "",
  handoffKeywords: [...WECHAT_MP_DEFAULT_HANDOFF_KEYWORDS],
  dailyAnswerLimit: 200,
  lastTestedAt: null,
  lastTestStatus: null,
  lastTestError: null,
  lastTestLatencyMs: null,
  updatedAt: null,
};

export function getWechatMpConfigRow(): Promise<ConfigRow | null> {
  return prisma.channelWechatMpConfig.findUnique({ where: { id: 1 } });
}

/** 公众号 AppID 单源(出站分发配置;缺行回落空串) */
export async function getWechatAppId(): Promise<string> {
  const row = await prisma.wechatConfig.findUnique({
    where: { id: 1 },
    select: { appid: true },
  });
  return row?.appid ?? "";
}

export async function getWechatMpConfigView(): Promise<WechatMpConfigView> {
  const [row, appId] = await Promise.all([getWechatMpConfigRow(), getWechatAppId()]);
  return row ? toView(row, appId) : { ...EMPTY_VIEW, appId };
}

/** 表单留空话术 = 回落默认值(避免空串把用户推到无话术状态) */
function textOrDefault(value: string, fallback: string): string {
  return value.trim() ? value.trim() : fallback;
}

export async function saveWechatMpConfig(
  input: WechatMpConfigUpdateInput,
): Promise<WechatMpConfigView> {
  const data = WechatMpConfigUpdateSchema.parse(input);
  const key = data.encodingAESKey?.trim();
  if (key && !AES_KEY_RE.test(key)) {
    throw new Error("EncodingAESKey 应为 43 位 Base64 字符(公众号后台「消息加解密密钥」)");
  }
  if (data.token && !TOKEN_RE.test(data.token)) {
    throw new Error("Token 应为 3–32 位字母、数字、下划线或连字符");
  }

  const payload = {
    token: data.token,
    enabled: data.enabled,
    greetingText: textOrDefault(data.greetingText, WECHAT_MP_DEFAULT_TEXTS.greeting),
    fallbackText: textOrDefault(data.fallbackText, WECHAT_MP_DEFAULT_TEXTS.fallback),
    handoffText: textOrDefault(data.handoffText, WECHAT_MP_DEFAULT_TEXTS.handoff),
    handoffKeywords:
      data.handoffKeywords.length > 0
        ? data.handoffKeywords
        : [...WECHAT_MP_DEFAULT_HANDOFF_KEYWORDS],
    dailyAnswerLimit: data.dailyAnswerLimit,
    ...(key ? { encodingAesKeyEnc: encryptTagged(key), encodingAesKeyMask: maskSecret(key) } : {}),
  };

  const row = await prisma.channelWechatMpConfig.upsert({
    where: { id: 1 },
    create: { id: 1, ...payload },
    update: payload,
  });
  return toView(row, await getWechatAppId());
}

export function recordWechatMpTest(result: {
  ok: boolean;
  error: string | null;
  latencyMs: number;
}): Promise<void> {
  return prisma.channelWechatMpConfig
    .update({
      where: { id: 1 },
      data: {
        lastTestedAt: new Date(),
        lastTestStatus: result.ok ? "ok" : "fail",
        lastTestError: result.error?.slice(0, 500) ?? null,
        lastTestLatencyMs: result.latencyMs,
      },
    })
    .then(() => undefined);
}

/** 运行态话术(默认值可被后台覆盖;timeout/blocked 等固定口径不开放编辑) */
export type WechatMpTexts = { [K in keyof typeof WECHAT_MP_DEFAULT_TEXTS]: string };

/** 运行态配置(端点/worker 用;缺任一项返回 null = 端点显式拒绝) */
export interface WechatMpRuntimeConfig {
  token: string;
  encodingAESKey: string;
  appId: string;
  enabled: boolean;
  texts: WechatMpTexts;
  handoffKeywords: string[];
  dailyAnswerLimit: number;
}

export async function getWechatMpRuntimeConfig(): Promise<WechatMpRuntimeConfig | null> {
  const [row, appId] = await Promise.all([getWechatMpConfigRow(), getWechatAppId()]);
  if (!row || !row.token || !appId) return null;
  const aesKey = readSecretCompat(row.encodingAesKeyEnc);
  if (!aesKey) return null;
  return {
    token: row.token,
    encodingAESKey: aesKey,
    appId,
    enabled: row.enabled,
    texts: {
      greeting: textOrDefault(row.greetingText, WECHAT_MP_DEFAULT_TEXTS.greeting),
      fallback: textOrDefault(row.fallbackText, WECHAT_MP_DEFAULT_TEXTS.fallback),
      timeout: WECHAT_MP_DEFAULT_TEXTS.timeout,
      continueEmpty: WECHAT_MP_DEFAULT_TEXTS.continueEmpty,
      handoff: textOrDefault(row.handoffText, WECHAT_MP_DEFAULT_TEXTS.handoff),
      blocked: WECHAT_MP_DEFAULT_TEXTS.blocked,
      help: WECHAT_MP_DEFAULT_TEXTS.help,
      bindOk: WECHAT_MP_DEFAULT_TEXTS.bindOk,
      bindFail: WECHAT_MP_DEFAULT_TEXTS.bindFail,
      tooLong: WECHAT_MP_DEFAULT_TEXTS.tooLong,
    },
    handoffKeywords:
      row.handoffKeywords.length > 0
        ? row.handoffKeywords
        : [...WECHAT_MP_DEFAULT_HANDOFF_KEYWORDS],
    dailyAnswerLimit: row.dailyAnswerLimit,
  };
}
