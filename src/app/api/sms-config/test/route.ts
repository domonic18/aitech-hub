/**
 * 短信通道连通性探测(M65):admin 在配置页填完凭据后发一条真实验证码,
 * 验证 AccessKey / 签名 / 模板三者齐备且账户可用。**不校验 `enabled`**——正是
 * 在开启通道之前做这道探测。结果写回 user_sms_config 的 last_test_* 三列,
 * 页面据此显示上次探测状态与耗时。
 *
 * admin-only;每次探测都真实计费(约 0.06 元),页面按钮前有明确提示。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { maskPhone } from "@/lib/auth/mask";
import { PHONE_RE } from "@/lib/auth/rules";
import { requireAdminRequest } from "@/lib/auth/guard";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { getActiveSmsChannel, recordSmsTest } from "@/lib/sms/config";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  phone: z.string().trim().regex(PHONE_RE, "手机号格式不正确"),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, parsed.error.issues[0]?.message ?? "invalid body");
  const { phone } = parsed.data;
  const masked = maskPhone(phone);

  const channel = await getActiveSmsChannel({ requireEnabled: false });
  if (!channel) {
    return apiEnvelope(400, "请先保存 AccessKeyId、AccessKeySecret 与签名");
  }

  const startedAt = Date.now();
  const result = await channel.provider.sendVerifyCode({
    phone,
    signName: channel.signName,
    templateCode: channel.templateCode,
  });
  const latencyMs = Date.now() - startedAt;

  await recordSmsTest({
    ok: result.ok,
    error: result.ok ? null : `${result.reason}: ${result.code ?? ""} ${result.message}`.trim(),
    latencyMs,
  });

  if (!result.ok) {
    logger.error({
      event: "admin.sms_config.test_failed",
      reason: result.reason,
      providerCode: result.code,
      detail: result.message,
      phone: masked,
      latencyMs,
    });
    return apiEnvelope(
      502,
      `发送失败(${result.reason})${result.message ? `:${result.message}` : ""}`,
    );
  }

  logger.info({ event: "admin.sms_config.test_ok", phone: masked, latencyMs });
  return apiEnvelope(0, "测试短信已发送,请查收", { latencyMs });
}
