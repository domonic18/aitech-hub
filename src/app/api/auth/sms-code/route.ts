/**
 * 短信验证码下发(M65,plan M65;arch/05-services §3.1)。
 *
 * 通道 = 阿里云号码认证服务 PNVS「短信认证」,验证码由服务商生成与托管
 * (5 分钟有效、60 秒重发间隔、新码覆盖旧码),本站不落库。
 *
 * 口径纪律:
 * - **恒定应答**:除格式/频控外,一律回「验证码已发送」——不区分手机号是否
 *   已注册,不给账号枚举面。
 * - **admin 账号静默不发**:admin 禁止短信登录(迁移老账号含 admin 主账号,
 *   且历史手机号来自 WP 自助填写、从未验证过);此处直接按成功应答返回,
 *   既不花钱也不泄漏账号角色。
 * - **预算 fail-closed**:日预算先占位后发送,达线拒绝并告警;发送失败归还。
 * - 频控/预算/记账/日志统一走 `sendSmsCodeGuarded`(与账号中心绑定下发同源)。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { maskPhone } from "@/lib/auth/mask";
import { PHONE_RE } from "@/lib/auth/rules";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/http/origin";
import { clientIp } from "@/lib/http/request";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { getActiveSmsChannel } from "@/lib/sms/config";
import { SMS_SENT_MESSAGE, sendSmsCodeGuarded } from "@/lib/sms/send";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  phone: z.string().trim().regex(PHONE_RE, "手机号格式不正确"),
});

const UNAVAILABLE = "短信登录暂不可用,请稍后再试";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiEnvelope(400, "invalid json");
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return apiEnvelope(400, parsed.error.issues[0]?.message ?? "invalid body");
  }
  const { phone } = parsed.data;
  const masked = maskPhone(phone);
  const ip = clientIp(req);

  const channel = await getActiveSmsChannel();
  if (!channel) {
    logger.warn({ event: "sms.code.reject", reason: "channel_disabled" });
    return apiEnvelope(503, UNAVAILABLE);
  }

  // admin 禁短信登录:静默按成功应答,不发送、不计数
  const existing = await prisma.userAccount.findUnique({
    where: { phone },
    select: { role: true },
  });
  if (existing?.role === "admin") {
    logger.warn({ event: "sms.code.skip", reason: "admin_account", phone: masked });
    return apiEnvelope(0, SMS_SENT_MESSAGE);
  }

  const sent = await sendSmsCodeGuarded({
    channel,
    phone,
    ip,
    eventPrefix: "sms.code",
    unavailableMessage: UNAVAILABLE,
  });
  if (!sent.ok) return apiEnvelope(sent.status, sent.message);

  return apiEnvelope(0, SMS_SENT_MESSAGE);
}
