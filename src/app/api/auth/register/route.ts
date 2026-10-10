/**
 * 邮箱通道注册(M21 批⓪,D1):用户名+邮箱+密码 → 建号(bcrypt 12 轮,
 * 未认证态)→ 验证邮件入队(worker 发送;请求内禁秒级任务)。Zod 边界 +
 * Origin 校验 + IP/账号配额(注册写接口按成功也计数)+ pino 事件(邮箱/用户名
 * 脱敏,IP 记哈希)。认证前登录被 login 路由拦截(注册→认证→登录,决议 D1)。
 */
import { hash } from "bcryptjs";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { TOKEN_PURPOSE_REGISTER, issueEmailToken } from "@/lib/auth/email-verify";
import { isOverLimit, recordHit } from "@/lib/auth/rate-limit";
import {
  PASSWORD_MAX_LENGTH,
  validateEmail,
  validatePassword,
  validateUsername,
} from "@/lib/auth/rules";
import { maskEmail } from "@/lib/auth/mask";
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
  username: z.string().superRefine((v, ctx) => {
    const err = validateUsername(v);
    if (err) ctx.addIssue({ code: "custom", message: err });
  }),
  email: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .refine((v) => validateEmail(v) === null, { message: "邮箱格式不正确" }),
  password: z.string().min(1, "密码不能为空").max(PASSWORD_MAX_LENGTH),
});

/** 注册端点配额:IP 日 10 次 / 同邮箱时窗 5 次(成功也计数,注册是重写操作) */
const REGISTER_IP_LIMIT = 10;
const REGISTER_IP_WINDOW = 24 * 3600;
const REGISTER_EMAIL_LIMIT = 5;
const REGISTER_EMAIL_WINDOW = 3600;

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
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }
  const { username, email, password } = parsed.data;
  const ip = clientIp(req);

  const pwdError = validatePassword(password);
  if (pwdError) return apiEnvelope(400, pwdError);

  if (await isOverLimit(`auth:reg:ip:${ip}`, REGISTER_IP_LIMIT)) {
    logger.warn({ event: "auth.register.blocked", scope: "ip", ipHash: await ipHash(ip) });
    return apiEnvelope(429, "注册过于频繁,请稍后再试");
  }
  if (await isOverLimit(`auth:reg:email:${email}`, REGISTER_EMAIL_LIMIT)) {
    logger.warn({ event: "auth.register.blocked", scope: "email", email: maskEmail(email) });
    return apiEnvelope(429, "该邮箱操作过于频繁,请稍后再试");
  }

  const clash = await prisma.userAccount.findFirst({
    where: { OR: [{ username }, { email }] },
    select: { username: true, email: true },
  });
  if (clash) {
    const which = clash.email === email ? "邮箱已被注册" : "用户名已被占用";
    logger.info({
      event: "auth.register.clash",
      email: maskEmail(email),
      ipHash: await ipHash(ip),
    });
    return apiEnvelope(409, which);
  }

  const passwordHash = await hash(password, 12);
  let user: { id: bigint };
  try {
    user = await prisma.userAccount.create({
      data: { username, email, passwordHash, role: "user", status: "active" },
      select: { id: true },
    });
  } catch (e) {
    // 并发双注册撞唯一约束:与预检同文案,不给枚举增量
    if ((e as { code?: string }).code === "P2002") return apiEnvelope(409, "用户名或邮箱已被占用");
    throw e;
  }

  await recordHit(`auth:reg:ip:${ip}`, REGISTER_IP_WINDOW);
  await recordHit(`auth:reg:email:${email}`, REGISTER_EMAIL_WINDOW);

  const token = await issueEmailToken(user.id, TOKEN_PURPOSE_REGISTER);
  const verifyUrl = `${env.NEXT_PUBLIC_SITE_URL}/api/auth/verify-email?token=${token}`;
  await getQueue(QUEUE_EMAIL).add(EMAIL_JOB_SEND, {
    to: email,
    ...verifyEmailContent(verifyUrl, username),
  });

  logger.info({ event: "auth.register.ok", email: maskEmail(email), ipHash: await ipHash(ip) });
  return apiEnvelope(0, "ok", { message: "注册成功,请查收验证邮件完成认证" });
}
