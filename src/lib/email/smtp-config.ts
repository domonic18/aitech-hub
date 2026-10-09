/**
 * SMTP 配置读/写侧(M21 批⓪;用户拍板 2026-10-08:入数据库 admin 后台维护,
 * 不入 env——与支付网关凭据同规则)。单行语义:恒读首行,保存整行覆盖。
 * password 纪律同 pay_gateway_config:读侧视图永不回传明文(只给 passwordSet
 * 布尔),表单留空 = 保留原值;不入日志。无行 → null 视图(admin 页可空表单,
 * 发送侧显式跳过)。
 */
import { z } from "zod";

import { prisma } from "@/lib/db";

export const SMTP_PORT_MIN = 1;
export const SMTP_PORT_MAX = 65535;
const FIELD_MAX = 255;

/** PUT /api/email-config 请求体:password 可选(缺省/空 = 保留原值;建首行时必填) */
export const SmtpConfigUpdateSchema = z.object({
  host: z.string().trim().min(1).max(FIELD_MAX),
  port: z.coerce.number().int().min(SMTP_PORT_MIN).max(SMTP_PORT_MAX),
  username: z.string().trim().min(1).max(FIELD_MAX),
  password: z.string().max(FIELD_MAX).optional(),
  fromAddr: z
    .string()
    .trim()
    .min(3)
    .max(FIELD_MAX)
    .refine((v) => v.includes("@"), {
      message: "发件人须含邮箱地址",
    }),
  enabled: z.boolean(),
});
export type SmtpConfigUpdateInput = z.infer<typeof SmtpConfigUpdateSchema>;

/** admin 读侧视图(password 只暴露是否已设,明文不出库) */
export interface SmtpConfigView {
  host: string;
  port: number;
  username: string;
  fromAddr: string;
  enabled: boolean;
  passwordSet: boolean;
  updatedAt: string | null; // ISO;未配置为 null
}

function toView(row: {
  host: string;
  port: number;
  username: string;
  fromAddr: string;
  enabled: boolean;
  updatedAt: Date;
}): SmtpConfigView {
  return {
    host: row.host,
    port: row.port,
    username: row.username,
    fromAddr: row.fromAddr,
    enabled: row.enabled,
    passwordSet: true,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 发送侧/页面共用:首行配置(无行 → null;enabled 与否由消费方判定) */
export async function getSmtpConfigRow() {
  return prisma.emailConfig.findFirst({ orderBy: { id: "asc" } });
}

/** admin 页/GET API:脱敏视图(未配置 → 全空 passwordSet:false) */
export async function getSmtpConfigView(): Promise<SmtpConfigView> {
  const row = await getSmtpConfigRow();
  if (!row) {
    return {
      host: "",
      port: 465,
      username: "",
      fromAddr: "",
      enabled: false,
      passwordSet: false,
      updatedAt: null,
    };
  }
  return toView(row);
}

/**
 * 保存(整行覆盖;password 缺省时保留原值——首行且未给密码属请求构造错误,
 * 由调用方 Zod 层先行拒绝)。返回脱敏视图供 API 应答。
 */
export async function saveSmtpConfig(input: SmtpConfigUpdateInput): Promise<SmtpConfigView> {
  const data = SmtpConfigUpdateSchema.parse(input);
  const keepPassword = !data.password;
  const row = await getSmtpConfigRow();
  if (!row) {
    const created = await prisma.emailConfig.create({
      data: {
        host: data.host,
        port: data.port,
        username: data.username,
        password: data.password ?? "",
        fromAddr: data.fromAddr,
        enabled: data.enabled,
      },
    });
    return toView(created);
  }
  const updated = await prisma.emailConfig.update({
    where: { id: row.id },
    data: {
      host: data.host,
      port: data.port,
      username: data.username,
      ...(keepPassword ? {} : { password: data.password }),
      fromAddr: data.fromAddr,
      enabled: data.enabled,
    },
  });
  return toView(updated);
}
