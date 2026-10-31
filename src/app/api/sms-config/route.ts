/**
 * 短信登录配置 API(M65,plan M65):配置入数据库 admin 后台维护,不入 env
 * (与邮件/支付/飞书同规则)。GET 返回脱敏视图(secret 明文永不回传,只给
 * accessKeySecretSet + 掩码);PUT 整行覆盖(表单留空 secret = 保留原值)。
 * admin-only(requireAdminRequest:cookie 会话 + role 判定,PAT 不得调用),
 * mutation 走 Origin 校验。保存即时生效:端点每次取配置都现构造 provider。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { SmsConfigUpdateSchema, getSmsConfigView, saveSmsConfig } from "@/lib/sms/config";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");
  return apiEnvelope(0, "ok", await getSmsConfigView());
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");

  const parsed = SmsConfigUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(
      400,
      "配置不合法:AccessKeyId/签名/模板必填,日预算 1-10000,若需开启通道则凭据须完整",
    );
  }
  if (parsed.data.enabled) {
    const view = await getSmsConfigView();
    const secretReady = Boolean(parsed.data.accessKeySecret) || view.accessKeySecretSet;
    if (!parsed.data.accessKeyId || !parsed.data.signName || !secretReady) {
      return apiEnvelope(400, "开启短信通道前须填全 AccessKeyId、AccessKeySecret 与签名");
    }
  }

  const view = await saveSmsConfig(parsed.data);
  // 密钥/AccessKeySecret 不入日志
  logger.info({ event: "admin.sms_config.saved", enabled: view.enabled });
  return apiEnvelope(0, "saved", view);
}
