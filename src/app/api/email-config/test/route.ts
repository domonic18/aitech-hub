/**
 * SMTP 测试发送 API(2026-10-09 验收反馈问题1 配套):admin 保存配置后
 * 就地验证连通性。收件人缺省取发件人地址中的邮箱。web 内联发送是「请求内
 * 禁秒级任务」的受控例外(仅 admin、低频、8-10s 超时兜底,见 mailer
 * sendTestMail);常规事务邮件仍走 BullMQ worker。收件人日志脱敏。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { maskEmail } from "@/lib/auth/mask";
import { requireAdminRequest } from "@/lib/auth/guard";
import { sendTestMail } from "@/lib/email/mailer";
import { getSmtpConfigRow } from "@/lib/email/smtp-config";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  to: z.string().trim().email("收件人须为合法邮箱地址").optional(),
});

function defaultRecipient(fromAddr: string): string | null {
  return fromAddr.match(/[\w.+-]+@[\w.-]+/)?.[0] ?? null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");

  const parsed = bodySchema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) return apiEnvelope(400, "收件人须为合法邮箱地址");

  const row = await getSmtpConfigRow();
  if (!row) return apiEnvelope(400, "尚未配置 SMTP,请先保存配置");
  const to = parsed.data.to ?? defaultRecipient(row.fromAddr);
  if (!to) return apiEnvelope(400, "发件人地址中无可用邮箱,请显式填写收件人");

  try {
    await sendTestMail(to);
  } catch (e) {
    // SMTP 错误原文回显 admin(排障需要);密码不出现在 nodemailer 错误里
    logger.warn({ event: "admin.email_config.test_failed", to: maskEmail(to) });
    return apiEnvelope(502, `发送失败:${e instanceof Error ? e.message : "未知错误"}`);
  }
  logger.info({ event: "admin.email_config.test_sent", to: maskEmail(to) });
  return apiEnvelope(0, "已发送", { to: maskEmail(to) });
}
