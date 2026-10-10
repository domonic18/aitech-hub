/**
 * 重置密码落地(2026-10-09 验收反馈问题1):TOKEN_PURPOSE_RESET 令牌单次消费
 * (30 分钟 TTL,同 email-verify)+ 新密码落库,消费与改密同事务(与
 * verify-email 的 email_verified_at 同款裂缝防护)。已有会话不强制下线
 * (Redis jti 登记表无 uid 索引,扩大改动面不值当;改密后旧会话至多存活
 * 剩余 TTL,威胁模型为「忘记密码找回」而非「被盗号夺回」)。
 */
import { hash } from "bcryptjs";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { TOKEN_PURPOSE_RESET, consumeEmailToken } from "@/lib/auth/email-verify";
import { isOverLimit, recordHit } from "@/lib/auth/rate-limit";
import { PASSWORD_MAX_LENGTH, validatePassword } from "@/lib/auth/rules";
import { isSameOrigin } from "@/lib/http/origin";
import { clientIp } from "@/lib/http/request";
import { apiEnvelope } from "@/lib/http/response";
import { ipHash, logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token: z.string().min(1).max(128),
  password: z.string().min(1, "密码不能为空").max(PASSWORD_MAX_LENGTH),
});

/** 重置端点配额:IP 时窗 30 次(令牌 256 位随机,爆破不可行;配额只防滥用) */
const RESET_IP_LIMIT = 30;
const RESET_IP_WINDOW = 3600;

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "invalid body");
  const pwdError = validatePassword(parsed.data.password);
  if (pwdError) return apiEnvelope(400, pwdError);

  const ip = clientIp(req);
  if (await isOverLimit(`auth:reset:ip:${ip}`, RESET_IP_LIMIT)) {
    logger.warn({ event: "auth.reset.blocked", ipHash: await ipHash(ip) });
    return apiEnvelope(429, "操作过于频繁,请稍后再试");
  }
  await recordHit(`auth:reset:ip:${ip}`, RESET_IP_WINDOW);

  // bcrypt 12 轮对齐注册;哈希在消费前算好,事务内只做落库
  const passwordHash = await hash(parsed.data.password, 12);
  const { status, userId } = await consumeEmailToken(
    parsed.data.token,
    TOKEN_PURPOSE_RESET,
    (tx, uid) => tx.userAccount.update({ where: { id: uid }, data: { passwordHash } }),
  );
  if (status === "expired") {
    return apiEnvelope(400, "链接已过期,请返回登录页重新申请密码重置");
  }
  if (status !== "ok") {
    logger.warn({ event: "auth.reset.invalid", ipHash: await ipHash(ip) });
    return apiEnvelope(400, "链接无效或已被使用,请返回登录页重新申请");
  }
  logger.info({ event: "auth.reset.ok", userId: userId?.toString(), ipHash: await ipHash(ip) });
  return apiEnvelope(0, "密码已重置,请使用新密码登录");
}
