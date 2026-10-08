/**
 * 支付配置 API(M21 批②,自批⑤ 提前——凭据与模式链路随网关代码闭环;
 * 2026-10-08 拍板:appid/appsecret 入数据库 admin 后台维护,不入 env;
 * 2026-10-09 追加拍板:支付开关一并入数据库,本接口即支付唯一控制面):
 * GET 读脱敏视图(secret 明文永不回传,只给 secretSet + 掩码形态);
 * PUT 保存模式与凭据(off/mock 凭据可留空;xunhu 须 appId/apiBase,首启
 * 必填 secret;mock 生产环境拒绝)。保存即时生效:运行时配置缓存键含
 * updatedAt,无需重启。admin-only(requireAdminRequest,同 /api/email-config)
 * + Origin 校验。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import {
  assertModeAllowedInEnv,
  getPayGatewayConfigView,
  savePayGatewayConfig,
  PayGatewayConfigUpdateSchema,
} from "@/lib/pay/gateway-config";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");
  return apiEnvelope(0, "ok", await getPayGatewayConfigView());
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");

  const parsed = PayGatewayConfigUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(
      400,
      "配置不合法:mode 须 off|mock|xunhu;xunhu 须 appId(≥4 字)+ https apiBase;回调/回跳须 https 或留空;TTL 1-1440 分钟",
    );
  }
  try {
    assertModeAllowedInEnv(parsed.data.mode);
  } catch {
    return apiEnvelope(400, "mock 网关仅开发环境可用");
  }
  if (parsed.data.mode === "xunhu" && !parsed.data.appSecret) {
    const view = await getPayGatewayConfigView();
    if (!view.secretSet) return apiEnvelope(400, "首次启用必须填写 appSecret");
  }

  const view = await savePayGatewayConfig(parsed.data);
  logger.info({ event: "admin.pay_config.saved", mode: view.mode }); // secret/appId 不入日志
  return apiEnvelope(0, "saved", view);
}
