/**
 * 短信通道配置读写(M65,plan M65):单行语义——恒读 id=1,保存整行覆盖。
 * AccessKeySecret 纪律同 email_config / pay_gateway_config:读侧永不回传明文
 * (仅给 accessKeySecretSet 布尔 + 脱敏冗余列),表单留空 = 保留原值;不入日志。
 *
 * 签名必须入库而非 env:PNVS 的签名由阿里云签发且可能轮换,环境变量化会让
 * 轮换变成一次发版。enabled=false 或凭据不全时 `getActiveSmsChannel()` 返回
 * null,端点侧显式拒绝(登录页页签随之隐显)。
 */
import { z } from "zod";

import { encryptTagged, maskSecret, readSecretCompat } from "@/lib/crypto/secret-box";
import { prisma } from "@/lib/db";
import { prerenderSafe } from "@/lib/prerender-safe";

import { AliyunPnvsProvider } from "./aliyun-pnvs";
import type { SmsProvider } from "./provider";

/** PNVS 预置模板:100001 登录/注册(绑定场景 100002/100004/100005 复用同字段) */
export const SMS_DEFAULT_TEMPLATE_CODE = "100001";
export const SMS_DEFAULT_DAILY_LIMIT = 200;

const FIELD_MAX = 100;

/** PUT /api/sms-config 请求体:accessKeySecret 可选(缺省/空 = 保留原值) */
export const SmsConfigUpdateSchema = z.object({
  accessKeyId: z.string().trim().max(FIELD_MAX),
  accessKeySecret: z.string().max(200).optional(),
  signName: z.string().trim().max(50),
  templateCode: z.string().trim().max(50),
  enabled: z.boolean(),
  dailyLimit: z.coerce.number().int().min(1).max(10_000),
});
export type SmsConfigUpdateInput = z.infer<typeof SmsConfigUpdateSchema>;

/** admin 读侧视图(secret 只暴露是否已设,明文不出库) */
export interface SmsConfigView {
  accessKeyId: string;
  accessKeySecretSet: boolean;
  accessKeySecretMask: string | null;
  signName: string;
  templateCode: string;
  enabled: boolean;
  dailyLimit: number;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
  lastTestLatencyMs: number | null;
  updatedAt: string | null;
}

type ConfigRow = {
  accessKeyId: string;
  accessKeySecretEnc: string | null;
  accessKeySecretMask: string | null;
  signName: string;
  templateCode: string;
  enabled: boolean;
  dailyLimit: number;
  lastTestedAt: Date | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
  lastTestLatencyMs: number | null;
  updatedAt: Date;
};

function toView(row: ConfigRow): SmsConfigView {
  return {
    accessKeyId: row.accessKeyId,
    accessKeySecretSet: Boolean(row.accessKeySecretEnc),
    accessKeySecretMask: row.accessKeySecretMask,
    signName: row.signName,
    templateCode: row.templateCode,
    enabled: row.enabled,
    dailyLimit: row.dailyLimit,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestStatus: row.lastTestStatus,
    lastTestError: row.lastTestError,
    lastTestLatencyMs: row.lastTestLatencyMs,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const EMPTY_VIEW: SmsConfigView = {
  accessKeyId: "",
  accessKeySecretSet: false,
  accessKeySecretMask: null,
  signName: "",
  templateCode: SMS_DEFAULT_TEMPLATE_CODE,
  enabled: false,
  dailyLimit: SMS_DEFAULT_DAILY_LIMIT,
  lastTestedAt: null,
  lastTestStatus: null,
  lastTestError: null,
  lastTestLatencyMs: null,
  updatedAt: null,
};

export async function getSmsConfigRow(): Promise<ConfigRow | null> {
  return prisma.userSmsConfig.findUnique({ where: { id: 1 } });
}

/** admin 页 / GET API:脱敏视图(未配置 → 默认空视图) */
export async function getSmsConfigView(): Promise<SmsConfigView> {
  const row = await getSmsConfigRow();
  return row ? toView(row) : EMPTY_VIEW;
}

/** 登录页取数:只读开关与凭据完备性,不构造 provider。
 *  构建期无 DB 时降级为 false(登录页按需动态渲染),运行时错误照常上抛。 */
export async function isSmsLoginAvailable(): Promise<boolean> {
  return prerenderSafe("sms.login.available", false, async () => {
    const row = await getSmsConfigRow();
    return Boolean(row?.enabled && row.accessKeyId && row.accessKeySecretEnc && row.signName);
  });
}

/**
 * 保存(整行覆盖;accessKeySecret 缺省/空 = 保留原值)。
 * 首次录入必须给 secret——否则行存在但通道不可用,由调用方在 Zod 层拒绝。
 */
export async function saveSmsConfig(input: SmsConfigUpdateInput): Promise<SmsConfigView> {
  const data = SmsConfigUpdateSchema.parse(input);
  const row = await getSmsConfigRow();
  if (!row) {
    const created = await prisma.userSmsConfig.create({
      data: {
        id: 1,
        accessKeyId: data.accessKeyId,
        accessKeySecretEnc: data.accessKeySecret ? encryptTagged(data.accessKeySecret) : null,
        accessKeySecretMask: data.accessKeySecret ? maskSecret(data.accessKeySecret) : null,
        signName: data.signName,
        templateCode: data.templateCode,
        enabled: data.enabled,
        dailyLimit: data.dailyLimit,
      },
    });
    return toView(created);
  }
  const updated = await prisma.userSmsConfig.update({
    where: { id: 1 },
    data: {
      accessKeyId: data.accessKeyId,
      ...(data.accessKeySecret
        ? {
            accessKeySecretEnc: encryptTagged(data.accessKeySecret),
            accessKeySecretMask: maskSecret(data.accessKeySecret),
          }
        : {}),
      signName: data.signName,
      templateCode: data.templateCode,
      enabled: data.enabled,
      dailyLimit: data.dailyLimit,
    },
  });
  return toView(updated);
}

/** 记录一次连通性探测结果(admin「发送测试短信」写回) */
export async function recordSmsTest(result: {
  ok: boolean;
  error: string | null;
  latencyMs: number;
}): Promise<void> {
  const row = await getSmsConfigRow();
  if (!row) return;
  await prisma.userSmsConfig.update({
    where: { id: 1 },
    data: {
      lastTestedAt: new Date(),
      lastTestStatus: result.ok ? "ok" : "fail",
      lastTestError: result.error?.slice(0, 500) ?? null,
      lastTestLatencyMs: result.latencyMs,
    },
  });
}

/** 端点在用通道:凭据齐且开关打开才返回(null = 显式拒绝) */
export interface ActiveSmsChannel {
  provider: SmsProvider;
  signName: string;
  templateCode: string;
  dailyLimit: number;
}

export async function getActiveSmsChannel(
  opts: { requireEnabled?: boolean } = {},
): Promise<ActiveSmsChannel | null> {
  const row = await getSmsConfigRow();
  if (!row || !row.accessKeyId || !row.signName) return null;
  if (opts.requireEnabled !== false && !row.enabled) return null;
  const secret = readSecretCompat(row.accessKeySecretEnc);
  if (!secret) return null;
  return {
    provider: new AliyunPnvsProvider({
      accessKeyId: row.accessKeyId,
      accessKeySecret: secret,
    }),
    signName: row.signName,
    templateCode: row.templateCode || SMS_DEFAULT_TEMPLATE_CODE,
    dailyLimit: row.dailyLimit,
  };
}
