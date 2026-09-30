/**
 * admin 密码登录(arch/05-services §3.1/§5,M4):Zod 边界 + Origin 校验 +
 * bcrypt 校验(10 轮,`legacy_phpass` 不参与)+ 爆破防护(账号 5 次锁 15min /
 * IP 日 50 次)+ pino `auth` 事件(手机号掩码、IP 记哈希不记明文)。
 */
import { compare } from "bcryptjs";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { issueSession, sessionCookie } from "@/lib/auth/issuer";
import { maskPhone } from "@/lib/auth/mask";
import { PASSWORD_MAX_LENGTH, PHONE_RE } from "@/lib/auth/rules";
import {
  clearAccountFails,
  isAccountLocked,
  isIpBlocked,
  recordAccountFail,
  recordIpFail,
} from "@/lib/auth/rate-limit";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/http/origin";
import { clientIp } from "@/lib/http/request";
import { apiEnvelope } from "@/lib/http/response";
import { ipHash, logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  phone: z.string().regex(PHONE_RE, "手机号格式不正确"),
  password: z.string().min(1, "密码不能为空").max(PASSWORD_MAX_LENGTH),
});

/** 校验用假 hash:账号不存在时也走等价 bcrypt,抹平计时差(防账号枚举) */
const DUMMY_HASH = "$2b$10$z0v4G/05ZpJuLAqaGbRU6u8b8b4iXFw3asySR2dApdsczV2KGOVuy";

/** 爆破防护与密码错误共用模糊提示,不区分原因(不给枚举面) */
const AMBIGUOUS_429 = "尝试过于频繁,请稍后再试";

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
  const { phone, password } = parsed.data;
  const ip = clientIp(req);

  if (await isIpBlocked(ip)) {
    logger.warn({ event: "auth.login.blocked", scope: "ip", ipHash: await ipHash(ip) });
    return apiEnvelope(429, AMBIGUOUS_429);
  }
  if (await isAccountLocked(phone)) {
    logger.warn({ event: "auth.login.blocked", scope: "account", phone: maskPhone(phone) });
    return apiEnvelope(429, AMBIGUOUS_429);
  }

  const user = await prisma.userAccount.findUnique({ where: { phone } });
  const passwordOk = await compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk) {
    await recordAccountFail(phone);
    await recordIpFail(ip);
    logger.warn({
      event: "auth.login.fail",
      phone: maskPhone(phone),
      ipHash: await ipHash(ip),
      reason: user ? "bad_password" : "no_account",
    });
    return apiEnvelope(401, "手机号或密码不正确");
  }
  if (user.status !== "active") {
    logger.warn({
      event: "auth.login.reject",
      phone: maskPhone(phone),
      status: user.status,
      ipHash: await ipHash(ip),
    });
    return apiEnvelope(403, "账号状态异常,无法登录");
  }

  await clearAccountFails(phone);
  const { token } = await issueSession({ sub: user.id.toString(), role: user.role });
  logger.info({
    event: "auth.login.ok",
    phone: maskPhone(phone),
    ipHash: await ipHash(ip),
  });

  const res = apiEnvelope(0, "ok", { role: user.role, nickname: user.nickname });
  res.cookies.set(sessionCookie(token));
  return res;
}
