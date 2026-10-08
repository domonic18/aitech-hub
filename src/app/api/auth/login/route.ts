/**
 * 登录(arch/05-services §3.1/§5,M4 建;M21 批⓪ 扩为标识符登录,D1 邮箱通道):
 * account = 手机号 | 用户名 | 邮箱(形状判定;邮箱小写折叠)。Zod 边界 + Origin
 * 校验 + bcrypt 校验(`legacy_phpass` 不参与)+ 爆破防护(账号 5 次锁 15min /
 * IP 日 50 次)+ pino `auth` 事件(标识符掩码、IP 记哈希不记明文)。
 * 邮箱注册账号未完成邮件认证时拒绝登录(注册→认证→登录,D1 决议);
 * 手机号账号(admin/迁移老账号)不受此门约束,维持既有行为。
 */
import { compare } from "bcryptjs";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { issueSession, sessionCookie } from "@/lib/auth/issuer";
import { maskEmail, maskPhone } from "@/lib/auth/mask";
import { PASSWORD_MAX_LENGTH, PHONE_RE } from "@/lib/auth/rules";
import {
  clearAccountFails,
  isAccountLocked,
  isIpBlocked,
  recordAccountFail,
  recordIpFail,
} from "@/lib/auth/rate-limit";
import { prisma } from "@/lib/db";
import { USER_STATUS_ACTIVE } from "@/lib/users/user-status";
import { isSameOrigin } from "@/lib/http/origin";
import { clientIp } from "@/lib/http/request";
import { apiEnvelope } from "@/lib/http/response";
import { ipHash, logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  account: z.string().min(1, "账号不能为空").max(100),
  password: z.string().min(1, "密码不能为空").max(PASSWORD_MAX_LENGTH),
});

/** 标识符归一:手机号原样 / 邮箱小写折叠(注册同规则)/ 用户名原样(大小写敏感) */
type IdentifierKind = "phone" | "email" | "username";
function resolveIdentifier(account: string): { kind: IdentifierKind; value: string } {
  if (PHONE_RE.test(account)) return { kind: "phone", value: account };
  if (account.includes("@")) return { kind: "email", value: account.trim().toLowerCase() };
  return { kind: "username", value: account };
}

/** 校验用假 hash:账号不存在时也走等价 bcrypt,抹平计时差(防账号枚举) */
const DUMMY_HASH = "$2b$10$z0v4G/05ZpJuLAqaGbRU6u8b8b4iXFw3asySR2dApdsczV2KGOVuy";

/** 爆破防护与密码错误共用模糊提示,不区分原因(不给枚举面) */
const AMBIGUOUS_429 = "尝试过于频繁,请稍后再试";

function maskIdentifier(kind: IdentifierKind, value: string): string {
  return kind === "phone" ? maskPhone(value) : maskEmail(value);
}

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
  const { kind, value } = resolveIdentifier(parsed.data.account);
  const { password } = parsed.data;
  const ip = clientIp(req);
  const masked = maskIdentifier(kind, value);

  if (await isIpBlocked(ip)) {
    logger.warn({ event: "auth.login.blocked", scope: "ip", ipHash: await ipHash(ip) });
    return apiEnvelope(429, AMBIGUOUS_429);
  }
  if (await isAccountLocked(value)) {
    logger.warn({ event: "auth.login.blocked", scope: "account", identifier: masked });
    return apiEnvelope(429, AMBIGUOUS_429);
  }

  const user =
    kind === "phone"
      ? await prisma.userAccount.findUnique({ where: { phone: value } })
      : kind === "email"
        ? await prisma.userAccount.findUnique({ where: { email: value } })
        : await prisma.userAccount.findUnique({ where: { username: value } });
  const passwordOk = await compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk || !user.passwordHash) {
    await recordAccountFail(value);
    await recordIpFail(ip);
    logger.warn({
      event: "auth.login.fail",
      kind,
      identifier: masked,
      ipHash: await ipHash(ip),
      reason: user ? "bad_password" : "no_account",
    });
    return apiEnvelope(401, "账号或密码不正确");
  }
  if (user.status !== USER_STATUS_ACTIVE) {
    logger.warn({
      event: "auth.login.reject",
      kind,
      identifier: masked,
      status: user.status,
      ipHash: await ipHash(ip),
    });
    return apiEnvelope(403, "账号状态异常,无法登录");
  }
  // 邮箱通道账号未认证不得登录(D1:注册→认证→登录);老账号(有手机号)不受限
  if (!user.phone && user.email && !user.emailVerifiedAt) {
    logger.warn({
      event: "auth.login.reject",
      kind,
      identifier: masked,
      reason: "email_unverified",
      ipHash: await ipHash(ip),
    });
    return apiEnvelope(403, "请先完成邮箱认证后再登录(可重新发送验证邮件)");
  }

  await clearAccountFails(value);
  const { token } = await issueSession({ sub: user.id.toString(), role: user.role });
  logger.info({ event: "auth.login.ok", kind, identifier: masked, ipHash: await ipHash(ip) });

  const res = apiEnvelope(0, "ok", { role: user.role, nickname: user.nickname });
  res.cookies.set(sessionCookie(token));
  return res;
}
