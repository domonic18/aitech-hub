/**
 * 飞书免登配置下发端点(M29;2026-10-16 随 h5sdk 新版免鉴权流替代旧 jssign):
 * GET → { enabled, appId },供 H5 侧 tt.requestAccess 直取 appId(jsapi_ticket
 * 签名四元组链整体下线)。appId 非密(本就要进客户端请求参数),但凭证不齐
 * 仍 403 fail-closed;enabled 仅透传不设门——登录兑换由 exchange 把关,绑定
 * 流程凭证齐即可(enabled 可后开)。
 */
import { NextResponse } from "next/server";

import { getFeishuRuntimeConfig } from "@/lib/auth/feishu-config";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const cfg = await getFeishuRuntimeConfig();
  if (!cfg?.appId || !cfg.appSecret) {
    return apiEnvelope(403, "飞书免登尚未配置");
  }
  return apiEnvelope(0, "ok", { enabled: cfg.enabled, appId: cfg.appId });
}
