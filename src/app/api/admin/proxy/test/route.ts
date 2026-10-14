/**
 * 系统出口代理连通性探针 API(M33 批B,镜像 /api/admin/feishu/test):admin
 * 保存配置后就地验证——经网关 POST /proxy-test 用该代理访问 B 站首页一跳
 * (真正的消费方是网关 curl_cffi,由它测才测得准),结果落 lastTest 四件套。
 * web 内联外呼是「请求内禁秒级任务」的受控例外(仅 admin、低频、网关侧 10s
 * 超时兜底);代理 URL 不出现在任何日志/错误里(网关只回 ok/延迟/短语)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { env } from "@/lib/env";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { getEgressProxyRuntime, recordEgressProxyTest } from "@/lib/telegram/egress-proxy";

export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 15_000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");

  const runtime = await getEgressProxyRuntime();
  if (!runtime) {
    return apiEnvelope(400, "尚未配置代理 URL 或未启用,请先保存");
  }

  const startedAt = Date.now();
  try {
    const res = await fetch(`${env.DOUYIN_GATEWAY_URL}/proxy-test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proxy: runtime.proxyUrl }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      latency_ms?: number;
      detail?: string;
    } | null;
    const latencyMs = Date.now() - startedAt;
    if (!res.ok || !body) {
      await recordEgressProxyTest({
        ok: false,
        latencyMs,
        detail: `网关探针失败(HTTP ${res.status})`,
      });
      return apiEnvelope(502, `连通失败:网关探针不可用(HTTP ${res.status})`);
    }
    await recordEgressProxyTest({
      ok: body.ok === true,
      latencyMs: body.latency_ms ?? latencyMs,
      detail: body.detail ?? "",
    });
    if (body.ok !== true) {
      return apiEnvelope(502, `连通失败:${body.detail || "未知错误"}`);
    }
    return apiEnvelope(0, `连通正常(${body.latency_ms ?? latencyMs}ms)`, {
      latencyMs: body.latency_ms ?? latencyMs,
    });
  } catch (e) {
    const latencyMs = Date.now() - startedAt;
    const detail = e instanceof Error ? e.message : String(e);
    await recordEgressProxyTest({ ok: false, latencyMs, detail });
    logger.warn({ event: "admin.egress_proxy.test_failed" });
    return apiEnvelope(502, `连通失败:${detail.slice(0, 200)}`);
  }
}
