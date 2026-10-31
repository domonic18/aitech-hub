/**
 * 账号中心手机号验证码下发(M65 P1,arch/05-services §3.4)。
 *
 * 场景见 `lib/sms/scenes.ts`:bind(绑新号)/ rebind_old(验证当前号,为换绑
 * 第一步)/ rebind_new(换绑第二步,发往新号)。**换绑第一步的号码由服务端
 * 从会话取**,客户端传什么都不会改变目标号——防止拿着会话去验别人的号码。
 *
 * 频控、日预算熔断、服务商错误归类与登录下发同源(`sendSmsCodeGuarded`)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAccountRequest } from "@/lib/auth/guard";
import { isSameOrigin } from "@/lib/http/origin";
import { clientIp } from "@/lib/http/request";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { planSend } from "@/lib/sms/account-phone";
import { getActiveSmsChannel } from "@/lib/sms/config";
import { PHONE_BIND_ERROR_STATUS, PhoneBindError, phoneCodeSchema } from "@/lib/sms/scenes";
import { SMS_SENT_MESSAGE, sendSmsCodeGuarded } from "@/lib/sms/send";

export const dynamic = "force-dynamic";

const UNAVAILABLE = "短信服务暂不可用,请稍后再试";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const session = await requireAccountRequest(req);
  if (!session) return apiEnvelope(401, "请先登录");

  const parsed = phoneCodeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, parsed.error.issues[0]?.message ?? "invalid body");

  const userId = BigInt(session.sub);
  const ip = clientIp(req);

  let plan: { targetPhone: string; templateCode: string };
  try {
    plan = await planSend(userId, parsed.data.scene, parsed.data.phone);
  } catch (e) {
    if (e instanceof PhoneBindError) return apiEnvelope(PHONE_BIND_ERROR_STATUS[e.code], e.message);
    throw e;
  }

  const channel = await getActiveSmsChannel();
  if (!channel) {
    logger.warn({ event: "account.phone.code.reject", reason: "channel_disabled" });
    return apiEnvelope(503, UNAVAILABLE);
  }

  const sent = await sendSmsCodeGuarded({
    channel,
    phone: plan.targetPhone,
    templateCode: plan.templateCode,
    ip,
    eventPrefix: "account.phone.code",
    unavailableMessage: UNAVAILABLE,
  });
  if (!sent.ok) return apiEnvelope(sent.status, sent.message);

  return apiEnvelope(0, SMS_SENT_MESSAGE);
}
