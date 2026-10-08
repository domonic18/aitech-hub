/**
 * 未认证重发验证邮件(M21 批⑤,提案 §8 登录页「未认证重发入口」):账号+
 * 密码先过登录同款凭据校验(防向任意邮箱滥发),仅未认证邮箱账号放行 →
 * 重发 register 验证邮件(worker 发送)。限频:同账号 1/h(IP 日 10)。
 */
import { compare } from "bcryptjs";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { TOKEN_PURPOSE_REGISTER, issueEmailToken } from "@/lib/auth/email-verify";
import { isOverLimit, recordHit } from "@/lib/auth/rate-limit";
import { maskEmail } from "@/lib/auth/mask";
import { PASSWORD_MAX_LENGTH } from "@/lib/auth/rules";
import { EMAIL_JOB_SEND, QUEUE_EMAIL, getQueue } from "@/lib/queue";
import { prisma } from "@/lib/db";
import { verifyEmailContent } from "@/lib/email/mailer";
import { isSameOrigin } from "@/lib/http/origin";
import { clientIp } from "@/lib/http/request";
import { apiEnvelope } from "@/lib/http/response";
import { ipHash, logger } from "@/lib/logger";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  account: z.string().min(1).max(100),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

const ACCOUNT_LIMIT = 1;
const ACCOUNT_WINDOW = 3600;
const IP_LIMIT = 10;
const IP_WINDOW = 24 * 3600;
/** 与 login 同款假 hash:凭据校验计时抹平(防账号枚举) */
const DUMMY_HASH = "$2b$10$z0v4G/05ZpJuLAqaGbRU6u8b8b4iXFw3asySR2dApdsczV2KGOVuy";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "invalid body");

  const { account, password } = parsed.data;
  const ip = clientIp(req);
  // 账号 = 邮箱或用户名(手机号老账号无邮箱通道,不属重发面;login 同形状判定)
  const emailRow = await prisma.userAccount.findFirst({
    where: account.includes("@") ? { email: account.trim().toLowerCase() } : { username: account },
    select: {
      id: true,
      email: true,
      username: true,
      passwordHash: true,
      emailVerifiedAt: true,
      phone: true,
    },
  });

  // 统一响应防枚举:凭据不匹配/已认证/不存在同一话术
  const AMBIGUOUS = "若该账号存在且未认证,验证邮件已重新发送";
  const passwordOk = await compare(password, emailRow?.passwordHash ?? DUMMY_HASH);
  const eligible =
    emailRow && passwordOk && !emailRow.phone && !emailRow.emailVerifiedAt && emailRow.email;
  if (eligible && (await isOverLimit(`auth:resend:acc:${emailRow.id}`, ACCOUNT_LIMIT))) {
    return apiEnvelope(429, "重发过于频繁,请查收邮箱或稍后再试");
  }
  if (await isOverLimit(`auth:resend:ip:${ip}`, IP_LIMIT)) {
    return apiEnvelope(429, "操作过于频繁,请稍后再试");
  }
  if (!eligible || emailRow.email === null) {
    logger.warn({ event: "auth.resend.rejected", ipHash: await ipHash(ip) });
    return apiEnvelope(200, AMBIGUOUS);
  }
  await recordHit(`auth:resend:acc:${emailRow.id}`, ACCOUNT_WINDOW);
  await recordHit(`auth:resend:ip:${ip}`, IP_WINDOW);

  const token = await issueEmailToken(emailRow.id, TOKEN_PURPOSE_REGISTER);
  const verifyUrl = `${env.NEXT_PUBLIC_SITE_URL}/api/auth/verify-email?token=${token}`;
  await getQueue(QUEUE_EMAIL).add(EMAIL_JOB_SEND, {
    to: emailRow.email,
    // 邮箱通道注册必有 username(注册表单必填);理论 null 兜底用邮箱名
    ...verifyEmailContent(verifyUrl, emailRow.username ?? emailRow.email),
  });
  logger.info({
    event: "auth.resend.sent",
    email: maskEmail(emailRow.email),
    ipHash: await ipHash(ip),
  });
  return apiEnvelope(0, "ok", { message: AMBIGUOUS });
}
