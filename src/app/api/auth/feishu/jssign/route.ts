/**
 * h5sdk.config 签名端点(M29 批①):GET ?url=<页面完整地址去 hash> → 服务端
 * 取 jsapi_ticket 签出四元组。凭证齐即可用(enabled 可后开——绑定/签名是启用
 * 前置);URL 强制同站点源(防作签名 oracle 滥用);IP 60/hour 限频。
 * 失败归一 apiEnvelope 非 0 code,客户端 catch 回落密码表单。
 */
import { type NextRequest, NextResponse } from "next/server";

import { getJsapiTicket, signJsapi } from "@/lib/auth/feishu-client";
import { getFeishuRuntimeConfig } from "@/lib/auth/feishu-config";
import { feishuErrorStatus, FeishuError } from "@/lib/auth/feishu-errors";
import { isOverLimit, recordHit } from "@/lib/auth/rate-limit";
import { env } from "@/lib/env";
import { clientIp } from "@/lib/http/request";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const JSSIGN_LIMIT = 60;
const JSSIGN_WINDOW_SECONDS = 3600;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ip = clientIp(req);
  const bucket = `auth:feishu:jssign:${ip}`;
  if (await isOverLimit(bucket, JSSIGN_LIMIT)) {
    return apiEnvelope(429, "请求过于频繁,请稍后再试");
  }
  await recordHit(bucket, JSSIGN_WINDOW_SECONDS);

  const raw = req.nextUrl.searchParams.get("url") ?? "";
  let pageOrigin = "";
  try {
    pageOrigin = new URL(raw).origin;
  } catch {
    return apiEnvelope(400, "url 参数不合法");
  }
  if (pageOrigin !== new URL(env.NEXT_PUBLIC_SITE_URL).origin) {
    return apiEnvelope(400, "url 不属于本站,拒绝签名");
  }

  const cfg = await getFeishuRuntimeConfig();
  if (!cfg?.appId || !cfg.appSecret) {
    return apiEnvelope(403, "飞书免登尚未配置");
  }
  const creds = { appId: cfg.appId, appSecret: cfg.appSecret };
  try {
    const ticket = await getJsapiTicket(creds);
    return apiEnvelope(0, "ok", signJsapi(creds, ticket, raw));
  } catch (e) {
    if (e instanceof FeishuError) {
      return apiEnvelope(feishuErrorStatus(e.code), "签名服务暂不可用,请改用密码登录");
    }
    throw e;
  }
}
