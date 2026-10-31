/**
 * 手机号验证码登录(M65,plan M65;登录 + 注册合一,用户裁定)。
 *
 * 手机号已存在 → 直接登录;不存在 → 自动建号(`username` 空,昵称「用户+尾号
 * 4 位」,role=user)。老站 243 个只有手机号的 WP 账号因此恢复登录能力。
 *
 * 安全红线:
 * - **admin 拒绝短信登录**:迁移老账号的手机号来自 WP 自助填写、从未验证,
 *   且 296 条迁移行里含 admin 主账号——验证码通过只证明「此人持有该号码」,
 *   不足以证明「此人是管理员本人」。
 * - 校验失败 5 次锁 15 分钟(站点侧兜底,PNVS 自身也有次数限制)。
 * - 需显式同意用户协议与隐私政策(自动建号场景的合规前提)。
 * - 日志只记掩码手机号与 IP 哈希。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { issueSession, sessionCookie } from "@/lib/auth/issuer";
import { maskPhone } from "@/lib/auth/mask";
import { PHONE_RE } from "@/lib/auth/rules";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/http/origin";
import { clientIp } from "@/lib/http/request";
import { apiEnvelope } from "@/lib/http/response";
import { ipHash, logger } from "@/lib/logger";
import { getActiveSmsChannel } from "@/lib/sms/config";
import { clearVerifyFails, isVerifyLocked, recordVerifyFail } from "@/lib/sms/limit";
import { USER_STATUS_ACTIVE } from "@/lib/users/user-status";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  phone: z.string().trim().regex(PHONE_RE, "手机号格式不正确"),
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, "验证码格式不正确"),
  agreed: z.literal(true),
});

const UNAVAILABLE = "短信登录暂不可用,请稍后再试";
const CODE_INVALID = "验证码不正确或已过期";
const LOCKED = "验证码错误次数过多,请 15 分钟后再试";
const ADMIN_FORBIDDEN = "该账号不支持短信登录,请使用密码登录";

/** 新号默认昵称:用户 + 手机尾号 4 位 */
function defaultNickname(phone: string): string {
  return `用户${phone.slice(-4)}`;
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
    const issue = parsed.error.issues[0];
    return apiEnvelope(
      400,
      issue?.path[0] === "agreed"
        ? "请先阅读并同意用户协议与隐私政策"
        : (issue?.message ?? "invalid body"),
    );
  }
  const { phone, code } = parsed.data;
  const masked = maskPhone(phone);
  const ip = clientIp(req);

  const channel = await getActiveSmsChannel();
  if (!channel) {
    logger.warn({ event: "sms.login.reject", reason: "channel_disabled" });
    return apiEnvelope(503, UNAVAILABLE);
  }

  if (await isVerifyLocked(phone)) {
    logger.warn({ event: "sms.login.blocked", phone: masked, ipHash: await ipHash(ip) });
    return apiEnvelope(429, LOCKED);
  }

  const checked = await channel.provider.checkVerifyCode({ phone, code });
  if (!checked.ok) {
    if (checked.reason === "mismatch") {
      const fails = await recordVerifyFail(phone);
      logger.warn({
        event: "sms.login.fail",
        phone: masked,
        fails,
        ipHash: await ipHash(ip),
      });
      return apiEnvelope(400, CODE_INVALID);
    }
    logger.error({
      event: "sms.login.error",
      reason: checked.reason,
      providerCode: checked.code,
      detail: checked.message,
      phone: masked,
      ipHash: await ipHash(ip),
    });
    return checked.reason === "rate_limited"
      ? apiEnvelope(429, "请求过于频繁,请稍后再试")
      : apiEnvelope(503, UNAVAILABLE);
  }
  await clearVerifyFails(phone);

  let user = await prisma.userAccount.findUnique({
    where: { phone },
    select: { id: true, role: true, status: true, nickname: true },
  });
  let isNew = false;

  if (user) {
    if (user.role === "admin") {
      logger.warn({ event: "sms.login.reject", reason: "admin_account", phone: masked });
      return apiEnvelope(403, ADMIN_FORBIDDEN);
    }
    if (user.status !== USER_STATUS_ACTIVE) {
      logger.warn({
        event: "sms.login.reject",
        reason: "inactive",
        status: user.status,
        phone: masked,
      });
      return apiEnvelope(403, "账号状态异常,无法登录");
    }
  } else {
    try {
      user = await prisma.userAccount.create({
        data: {
          phone,
          nickname: defaultNickname(phone),
          role: "user",
          status: USER_STATUS_ACTIVE,
        },
        select: { id: true, role: true, status: true, nickname: true },
      });
      isNew = true;
    } catch (e) {
      // 并发首次登录撞唯一约束:回读已建行,按登录处理
      if ((e as { code?: string }).code !== "P2002") throw e;
      user = await prisma.userAccount.findUnique({
        where: { phone },
        select: { id: true, role: true, status: true, nickname: true },
      });
      if (!user) throw e;
    }
  }

  const { token } = await issueSession({ sub: user.id.toString(), role: user.role });
  logger.info({
    event: "sms.login.ok",
    isNew,
    role: user.role,
    phone: masked,
    ipHash: await ipHash(ip),
  });

  const res = apiEnvelope(0, "ok", { role: user.role, nickname: user.nickname, isNew });
  res.cookies.set(sessionCookie(token));
  return res;
}
