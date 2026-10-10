/**
 * 支付模式 + 网关凭据读写服务(M21 批②;2026-10-08 拍板凭据入数据库,
 * 2026-10-09 追加拍板支付开关一并入数据库——env 无任何支付变量,admin
 * 「支付配置」页是唯一控制面)。模式落表形态:enabled=true 的行即当前
 * 生效网关(至多一行,全 false = 收银台关闭);mock 仅开发环境可启用
 * (生产保存拒绝 + 运行时忽略,双护栏)。运行时配置模块缓存键含
 * updatedAt,admin 保存自动换新;appSecret 只写不读(掩码回显,留空保留)。
 */
import { z } from "zod";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

export const GATEWAY_XUNHU = "xunhu";
export const GATEWAY_MOCK = "mock";

/** 支付模式(off=收银台关闭;mock=全链路模拟仅开发;xunhu=虎皮椒) */
export const PAY_MODES = ["off", "mock", "xunhu"] as const;
export type PayMode = (typeof PAY_MODES)[number];

const FIELD_MAX = 128;

const URL_MAX = 500;
const TTL_MIN = 1;
const TTL_MAX = 1440;

/** https URL 或空串(notify/return 允许留空未配置;下单前校验非空) */
const httpsUrlOrEmpty = z
  .string()
  .trim()
  .max(URL_MAX)
  .refine((v) => v === "" || v.startsWith("https://"), { message: "须为 https URL 或留空" });

/** PUT /api/pay-config 请求体:mode 为主键字段;凭据字段仅 mode=xunhu 必填
 * (off/mock 可整块留空,已填值照常入库,便于先填后开);secret 缺省/空 = 保留 */
export const PayGatewayConfigUpdateSchema = z
  .object({
    mode: z.enum(PAY_MODES),
    appId: z.string().trim().max(64).default(""),
    appSecret: z.string().max(FIELD_MAX).optional(),
    apiBase: httpsUrlOrEmpty.default(""),
    apiBaseBackup: z
      .string()
      .trim()
      .url()
      .max(FIELD_MAX)
      .refine((v) => v.startsWith("https://"), { message: "apiBaseBackup 必须 https" })
      .optional()
      .or(z.literal(""))
      .transform((v) => v ?? ""),
    notifyUrl: httpsUrlOrEmpty.default(""),
    returnUrl: httpsUrlOrEmpty.default(""),
    orderTtlMin: z.coerce.number().int().min(TTL_MIN).max(TTL_MAX).default(30),
  })
  .superRefine((data, ctx) => {
    if (data.mode !== GATEWAY_XUNHU) return;
    if (data.appId.length < 4)
      ctx.addIssue({ code: "custom", path: ["appId"], message: "appId 至少 4 字" });
    if (!data.apiBase.startsWith("https://"))
      ctx.addIssue({ code: "custom", path: ["apiBase"], message: "apiBase 须为 https URL" });
  });
export type PayGatewayConfigUpdateInput = z.input<typeof PayGatewayConfigUpdateSchema>;

/** mock 仅开发环境可用(生产:保存拒绝 + 运行时忽略;单一出口便于单测) */
export function assertModeAllowedInEnv(mode: PayMode, nodeEnv: string = env.NODE_ENV): void {
  if (mode === GATEWAY_MOCK && nodeEnv === "production") {
    throw new Error("mock 网关仅开发环境可用");
  }
}

/** admin 读侧视图(mode 即总闸;appSecret 只暴露是否已设与掩码形态) */
export interface PayGatewayConfigView {
  mode: PayMode;
  appId: string;
  apiBase: string;
  apiBaseBackup: string;
  notifyUrl: string;
  returnUrl: string;
  orderTtlMin: number;
  secretSet: boolean;
  secretMask: string; // 未设置时为空串;已设置时 `9191…3184` 形态
  updatedAt: string | null;
}

/** 掩码形态(提案 §8:9191…3184);过短密钥整体打码 */
export function maskSecret(secret: string): string {
  if (secret.length < 8) return "…";
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

/** 网关运行时配置(xunhu 签名/下单参数与 order-service TTL 消费;无行或未启用 → null) */
export interface PayGatewayRuntimeConfig {
  appId: string;
  appSecret: string;
  apiBase: string;
  apiBaseBackup?: string;
  notifyUrl: string;
  returnUrl: string;
  orderTtlMin: number;
  wapUrl: string; // do.html type=WAP 必填,取站点根
}

let cached: { key: string; cfg: PayGatewayRuntimeConfig } | null = null;

export async function getPayGatewayRuntimeConfig(
  gateway: string = GATEWAY_XUNHU,
): Promise<PayGatewayRuntimeConfig | null> {
  const row = await prisma.payGatewayConfig.findUnique({ where: { gateway } });
  if (!row || !row.enabled) return null;
  if (row.gateway === GATEWAY_MOCK && env.NODE_ENV === "production") return null; // 双护栏之运行时
  const key = `${row.id}:${row.updatedAt.getTime()}`;
  if (!cached || cached.key !== key) {
    cached = {
      key,
      cfg: {
        appId: row.appId,
        appSecret: row.appSecret,
        apiBase: row.apiBase,
        apiBaseBackup: row.apiBaseBackup ?? undefined,
        notifyUrl: row.notifyUrl,
        returnUrl: row.returnUrl,
        orderTtlMin: row.orderTtlMin,
        wapUrl: env.NEXT_PUBLIC_SITE_URL,
      },
    };
  }
  return cached.cfg;
}

/** admin 页/GET API:脱敏视图。mode 读自 enabled 行(生产忽略 mock 行,
 * fail-closed 显示 off);凭据字段恒读 xunhu 行——off/mock 模式下 admin
 * 仍能看到凭据配置状态。未配置 → 空表单 secretSet:false。 */
export async function getPayGatewayConfigView(): Promise<PayGatewayConfigView> {
  const [enabledRow, xunhuRow] = await Promise.all([
    prisma.payGatewayConfig.findFirst({ where: { enabled: true } }),
    prisma.payGatewayConfig.findUnique({ where: { gateway: GATEWAY_XUNHU } }),
  ]);
  const rawMode = enabledRow?.gateway;
  const mode: PayMode =
    rawMode === GATEWAY_MOCK && env.NODE_ENV === "production"
      ? "off" // 生产运行时也忽略 mock(与工厂同口径),视图如实显示关闭
      : rawMode === GATEWAY_XUNHU || rawMode === GATEWAY_MOCK
        ? rawMode
        : "off";
  return {
    mode,
    appId: xunhuRow?.appId ?? "",
    apiBase: xunhuRow?.apiBase ?? "https://api.dpweixin.com", // 2026-10-08 实证主用域(appid 仅此域有效)
    apiBaseBackup: xunhuRow?.apiBaseBackup ?? "",
    notifyUrl: xunhuRow?.notifyUrl ?? "",
    returnUrl: xunhuRow?.returnUrl ?? "",
    orderTtlMin: xunhuRow?.orderTtlMin ?? 30,
    secretSet: Boolean(xunhuRow?.appSecret),
    secretMask: xunhuRow ? maskSecret(xunhuRow.appSecret) : "",
    updatedAt:
      (mode !== "off"
        ? (enabledRow ?? xunhuRow)
        : (xunhuRow ?? enabledRow)
      )?.updatedAt.toISOString() ?? null,
  };
}

/**
 * 保存(模式切换 + 凭据整行覆盖,单事务):先清所有 enabled 标记,再按
 * mode upsert 目标行——xunhu/mock 行 enabled=true 即生效;off 落 xunhu 行
 * (凭据承载行)且 enabled=false,表单所填照常入库(先填后开)。xunhu
 * 切走再切回,secret 未重输则保留原值。secret 缺省 = 保留原值,首行未给
 * secret 由路由层先行拒绝;mock 生产拒绝由 assertModeAllowedInEnv 把关。
 */
export async function savePayGatewayConfig(
  input: PayGatewayConfigUpdateInput,
): Promise<PayGatewayConfigView> {
  const data = PayGatewayConfigUpdateSchema.parse(input);
  assertModeAllowedInEnv(data.mode);

  // mock 行无凭据语义:凭据列清空占位;TTL/回调/回跳照常入库供链路用
  const credFields: {
    appId: string;
    appSecret?: string;
    apiBase: string;
    apiBaseBackup: string | null;
  } =
    data.mode === GATEWAY_MOCK
      ? { appId: "", appSecret: "", apiBase: "", apiBaseBackup: null }
      : {
          appId: data.appId,
          ...(data.appSecret ? { appSecret: data.appSecret } : {}),
          apiBase: data.apiBase,
          apiBaseBackup: data.apiBaseBackup || null,
        };
  const targetGateway = data.mode === "off" ? GATEWAY_XUNHU : data.mode;

  await prisma.$transaction([
    prisma.payGatewayConfig.updateMany({ data: { enabled: false } }),
    prisma.payGatewayConfig.upsert({
      where: { gateway: targetGateway },
      update: {
        enabled: data.mode !== "off",
        ...credFields,
        notifyUrl: data.notifyUrl,
        returnUrl: data.returnUrl,
        orderTtlMin: data.orderTtlMin,
      },
      create: {
        gateway: targetGateway,
        enabled: data.mode !== "off",
        appId: credFields.appId,
        appSecret: credFields.appSecret ?? "",
        apiBase: credFields.apiBase,
        apiBaseBackup: credFields.apiBaseBackup,
        notifyUrl: data.notifyUrl,
        returnUrl: data.returnUrl,
        orderTtlMin: data.orderTtlMin,
      },
    }),
  ]);
  return getPayGatewayConfigView();
}
