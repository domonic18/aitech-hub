/**
 * 账号中心手机号验证码校验(M65 P1,arch/05-services §3.4)。
 *
 * 与下发端点共用 `planSend` 解析目标号——校验的永远是刚下发的那一个号码:
 * 换绑第一步校验会话账号当前号(PNVS 100005),第二步才校验新号(100002)。
 *
 * 第一步通过只置 Redis 放行标记(10 分钟一次性),不落库;第二步落库时二次
 * 核对并消费标记,客户端无法跳过第一步直接改绑。
 *
 * 失败计数与登录同桶(同号 5 次锁 15 分钟),服务商侧另有校验次数上限。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAccountRequest } from "@/lib/auth/guard";
import { maskPhone } from "@/lib/auth/mask";
import { isSameOrigin } from "@/lib/http/origin";
import { clientIp } from "@/lib/http/request";
import { apiEnvelope } from "@/lib/http/response";
import { ipHash, logger } from "@/lib/logger";
import { commitPhone, markRebindVerified, planSend } from "@/lib/sms/account-phone";
import { getActiveSmsChannel } from "@/lib/sms/config";
import { clearVerifyFails, isVerifyLocked, recordVerifyFail } from "@/lib/sms/limit";
import { PHONE_BIND_ERROR_STATUS, PhoneBindError, phoneVerifySchema } from "@/lib/sms/scenes";

export const dynamic = "force-dynamic";

const UNAVAILABLE = "短信服务暂不可用,请稍后再试";
const CODE_INVALID = "验证码不正确或已过期";
const LOCKED = "验证码错误次数过多,请 15 分钟后再试";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const session = await requireAccountRequest(req);
  if (!session) return apiEnvelope(401, "请先登录");

  const parsed = phoneVerifySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, parsed.error.issues[0]?.message ?? "invalid body");

  const { scene, phone, code } = parsed.data;
  const userId = BigInt(session.sub);
  const ip = clientIp(req);

  let plan: { targetPhone: string; templateCode: string };
  try {
    plan = await planSend(userId, scene, phone);
  } catch (e) {
    if (e instanceof PhoneBindError) return apiEnvelope(PHONE_BIND_ERROR_STATUS[e.code], e.message);
    throw e;
  }
  const target = plan.targetPhone;
  const masked = maskPhone(target);

  const channel = await getActiveSmsChannel();
  if (!channel) {
    logger.warn({ event: "account.phone.verify.reject", reason: "channel_disabled" });
    return apiEnvelope(503, UNAVAILABLE);
  }

  if (await isVerifyLocked(target)) {
    logger.warn({
      event: "account.phone.verify.blocked",
      scene,
      phone: masked,
      ipHash: await ipHash(ip),
    });
    return apiEnvelope(429, LOCKED);
  }

  const checked = await channel.provider.checkVerifyCode({ phone: target, code });
  if (!checked.ok) {
    if (checked.reason === "mismatch") {
      const fails = await recordVerifyFail(target);
      logger.warn({
        event: "account.phone.verify.fail",
        scene,
        phone: masked,
        fails,
        ipHash: await ipHash(ip),
      });
      return apiEnvelope(400, CODE_INVALID);
    }
    logger.error({
      event: "account.phone.verify.error",
      scene,
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
  await clearVerifyFails(target);

  if (scene === "rebind_old") {
    await markRebindVerified(userId);
    logger.info({ event: "account.phone.rebind_old_ok", userId: userId.toString() });
    return apiEnvelope(0, "当前手机号验证通过,请继续绑定新手机号", { step: "rebind_new" });
  }

  try {
    await commitPhone(userId, target, { requireRebindVerified: scene === "rebind_new" });
  } catch (e) {
    if (e instanceof PhoneBindError) return apiEnvelope(PHONE_BIND_ERROR_STATUS[e.code], e.message);
    throw e;
  }

  logger.info({
    event: "account.phone.verify.ok",
    scene,
    userId: userId.toString(),
    phone: masked,
    ipHash: await ipHash(ip),
  });
  return apiEnvelope(0, scene === "bind" ? "手机号已绑定" : "手机号已更换", {
    phone: masked,
  });
}
