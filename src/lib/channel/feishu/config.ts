/**
 * 站务通知(飞书自建应用)配置读写(M66)。
 *
 * 用户明确要求:飞书 app_id / app_secret **只入库**,不进 env、不进代码。
 * appSecret 走 secret-box(write-only,读侧只回 Set 布尔 + 掩码),循
 * `channel_feishu_alert_config.app_secret_enc` 列契约。
 *
 * 与 M29「飞书工作台免登」是**两个不同的飞书应用**,互不共享凭据与 token 缓存。
 */
import { z } from "zod";

import { encryptTagged, maskSecret, readSecretCompat } from "@/lib/crypto/secret-box";
import { prisma } from "@/lib/db";

export const FeishuAlertConfigUpdateSchema = z.object({
  appId: z.string().trim().max(64),
  /** 留空 = 保留原值 */
  appSecret: z.string().trim().max(200).optional(),
  chatId: z.string().trim().max(100),
  chatName: z.string().trim().max(100),
  enabled: z.boolean(),
  isNotifyHandoff: z.boolean(),
  isNotifyDaily: z.boolean(),
  dailySummaryHour: z.coerce.number().int().min(0).max(23),
});
export type FeishuAlertConfigUpdateInput = z.infer<typeof FeishuAlertConfigUpdateSchema>;

export interface FeishuAlertConfigView {
  appId: string;
  appSecretSet: boolean;
  appSecretMask: string | null;
  chatId: string;
  chatName: string;
  enabled: boolean;
  isNotifyHandoff: boolean;
  isNotifyDaily: boolean;
  dailySummaryHour: number;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
  lastTestLatencyMs: number | null;
  updatedAt: string | null;
}

type AlertConfigRow = {
  appId: string;
  appSecretEnc: string | null;
  appSecretMask: string | null;
  chatId: string;
  chatName: string;
  enabled: boolean;
  isNotifyHandoff: boolean;
  isNotifyDaily: boolean;
  dailySummaryHour: number;
  lastTestedAt: Date | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
  lastTestLatencyMs: number | null;
  updatedAt: Date;
};

function toView(row: AlertConfigRow): FeishuAlertConfigView {
  return {
    appId: row.appId,
    appSecretSet: Boolean(row.appSecretEnc),
    appSecretMask: row.appSecretMask,
    chatId: row.chatId,
    chatName: row.chatName,
    enabled: row.enabled,
    isNotifyHandoff: row.isNotifyHandoff,
    isNotifyDaily: row.isNotifyDaily,
    dailySummaryHour: row.dailySummaryHour,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestStatus: row.lastTestStatus,
    lastTestError: row.lastTestError,
    lastTestLatencyMs: row.lastTestLatencyMs,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const EMPTY_VIEW: FeishuAlertConfigView = {
  appId: "",
  appSecretSet: false,
  appSecretMask: null,
  chatId: "",
  chatName: "",
  enabled: false,
  isNotifyHandoff: true,
  isNotifyDaily: false,
  dailySummaryHour: 9,
  lastTestedAt: null,
  lastTestStatus: null,
  lastTestError: null,
  lastTestLatencyMs: null,
  updatedAt: null,
};

export function getFeishuAlertConfigRow(): Promise<AlertConfigRow | null> {
  return prisma.channelFeishuAlertConfig.findUnique({ where: { id: 1 } });
}

export async function getFeishuAlertConfigView(): Promise<FeishuAlertConfigView> {
  const row = await getFeishuAlertConfigRow();
  return row ? toView(row) : EMPTY_VIEW;
}

export async function saveFeishuAlertConfig(
  input: FeishuAlertConfigUpdateInput,
): Promise<FeishuAlertConfigView> {
  const data = FeishuAlertConfigUpdateSchema.parse(input);
  const secret = data.appSecret?.trim();
  const payload = {
    appId: data.appId,
    chatId: data.chatId,
    chatName: data.chatName,
    enabled: data.enabled,
    isNotifyHandoff: data.isNotifyHandoff,
    isNotifyDaily: data.isNotifyDaily,
    dailySummaryHour: data.dailySummaryHour,
    ...(secret ? { appSecretEnc: encryptTagged(secret), appSecretMask: maskSecret(secret) } : {}),
  };
  const row = await prisma.channelFeishuAlertConfig.upsert({
    where: { id: 1 },
    create: { id: 1, ...payload },
    update: payload,
  });
  return toView(row);
}

export function recordFeishuAlertTest(result: {
  ok: boolean;
  error: string | null;
  latencyMs: number;
}): Promise<void> {
  return prisma.channelFeishuAlertConfig
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

/** 运行态凭据(发送侧用;缺任一项返回 null) */
export interface FeishuAlertRuntimeConfig {
  appId: string;
  appSecret: string;
  chatId: string;
  enabled: boolean;
  isNotifyHandoff: boolean;
  isNotifyDaily: boolean;
  dailySummaryHour: number;
}

export async function getFeishuAlertRuntimeConfig(): Promise<FeishuAlertRuntimeConfig | null> {
  const row = await getFeishuAlertConfigRow();
  if (!row || !row.appId || !row.chatId) return null;
  const secret = readSecretCompat(row.appSecretEnc);
  if (!secret) return null;
  return {
    appId: row.appId,
    appSecret: secret,
    chatId: row.chatId,
    enabled: row.enabled,
    isNotifyHandoff: row.isNotifyHandoff,
    isNotifyDaily: row.isNotifyDaily,
    dailySummaryHour: row.dailySummaryHour,
  };
}
