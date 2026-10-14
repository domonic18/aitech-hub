/**
 * 飞书凭证连通性探针 API(M29 批①,镜像 /api/email-config/test):admin 保存
 * 配置后就地验证 app_access_token + jsapi_ticket 两条 OpenAPI 链路,结果落
 * lastTest 四件套。web 内联外呼是「请求内禁秒级任务」的受控例外(仅 admin、
 * 低频、8s 超时兜底);错误原文回显 admin(排障需要,secret 不出现在错误里)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { getJsapiTicket, getAppAccessToken } from "@/lib/auth/feishu-client";
import { getFeishuRuntimeConfig, recordFeishuTest } from "@/lib/auth/feishu-config";
import { FeishuError } from "@/lib/auth/feishu-errors";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");

  const cfg = await getFeishuRuntimeConfig();
  if (!cfg?.appId || !cfg.appSecret) {
    return apiEnvelope(400, "尚未配置完整凭证,请先保存 AppID 与 AppSecret");
  }
  const creds = { appId: cfg.appId, appSecret: cfg.appSecret };

  const startedAt = Date.now();
  try {
    await getAppAccessToken(creds);
    await getJsapiTicket(creds);
  } catch (e) {
    const detail = e instanceof FeishuError ? e.message : "未知错误";
    await recordFeishuTest({ ok: false, latencyMs: Date.now() - startedAt, detail });
    logger.warn({ event: "admin.feishu_config.test_failed" });
    return apiEnvelope(502, `连通失败:${detail}`);
  }
  const latencyMs = Date.now() - startedAt;
  await recordFeishuTest({ ok: true, latencyMs, detail: "ok" });
  return apiEnvelope(0, `连通正常(${latencyMs}ms)`, { latencyMs });
}
