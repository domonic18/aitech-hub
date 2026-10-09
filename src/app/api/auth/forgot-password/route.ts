/**
 * 忘记密码(2026-10-09 验收反馈问题1):账号(邮箱/用户名)→ 给邮箱通道账号
 * 签发 TOKEN_PURPOSE_RESET 令牌,重置链接入队 worker 发送(请求内禁秒级任务)。
 * 统一话术防枚举:账号不存在/手机号老账号(无邮箱)/正常,响应一致;
 * 滥发防护:同账号 1/h + IP 日 10(镜像 resend-verification)。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { TOKEN_PURPOSE_RESET, issueEmailToken } from "@/lib/auth/email-verify";
import { isOverLimit, recordHit } from "@/lib/auth/rate-limit";
import { maskEmail } from "@/lib/auth/mask";
import { EMAIL_JOB_SEND, QUEUE_EMAIL, getQueue } from "@/lib/queue";
import { prisma } from "@/lib/db";
import { passwordResetContent } from "@/lib/email/mailer";
import { isSameOrigin } from "@/lib/http/origin";
import { clientIp } from "@/lib/http/request";
import { apiEnvelope } from "@/lib/http/response";
import { ipHash, logger } from "@/lib/logger";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ account: z.string().min(1).max(100) });

const ACCOUNT_LIMIT = 1;
const ACCOUNT_WINDOW = 3600;
const IP_LIMIT = 10;
const IP_WINDOW = 24 * 3600;

/** 统一话术:不区分「账号不存在 / 无邮箱通道 / 已发送」(防账号枚举) */
const AMBIGUOUS = "若该账号存在,密码重置邮件已发送,请查收邮箱(含垃圾箱)";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "invalid body");

  const { account } = parsed.data;
  const ip = clientIp(req);
  // 邮箱或用户名解析(手机号老账号无邮箱通道,不属重置面;login 同形状判定)
  const row = await prisma.userAccount.findFirst({
    where: account.includes("@") ? { email: account.trim().toLowerCase() } : { username: account },
    select: { id: true, email: true, username: true, phone: true },
  });

  if (row && (await isOverLimit(`auth:forgot:acc:${row.id}`, ACCOUNT_LIMIT))) {
    return apiEnvelope(429, "操作过于频繁,请查收邮箱或稍后再试");
  }
  if (await isOverLimit(`auth:forgot:ip:${ip}`, IP_LIMIT)) {
    logger.warn({ event: "auth.forgot.blocked", ipHash: await ipHash(ip) });
    return apiEnvelope(429, "操作过于频繁,请稍后再试");
  }
  if (!row || !row.email || row.phone) {
    logger.info({ event: "auth.forgot.rejected", ipHash: await ipHash(ip) });
    return apiEnvelope(200, AMBIGUOUS);
  }
  await recordHit(`auth:forgot:acc:${row.id}`, ACCOUNT_WINDOW);
  await recordHit(`auth:forgot:ip:${ip}`, IP_WINDOW);

  const token = await issueEmailToken(row.id, TOKEN_PURPOSE_RESET);
  const resetUrl = `${env.NEXT_PUBLIC_SITE_URL}/reset-password?token=${token}`;
  await getQueue(QUEUE_EMAIL).add(EMAIL_JOB_SEND, {
    to: row.email,
    // 邮箱通道注册必有 username;理论 null 兜底用邮箱名
    ...passwordResetContent(resetUrl, row.username ?? row.email),
  });
  logger.info({
    event: "auth.forgot.sent",
    email: maskEmail(row.email),
    ipHash: await ipHash(ip),
  });
  return apiEnvelope(0, AMBIGUOUS);
}
