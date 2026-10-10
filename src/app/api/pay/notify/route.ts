/**
 * 网关异步回调 API(M21 批③,提案 §5.1/§6):无 session/Origin 白名单——
 * 唯一鉴权是验签(安全清单 #10,plan line 48 既定)。虎皮椒 POST 表单编码
 * (兼容 JSON 供 mock 联调);验签结果全量落 notify_log;应答纯文本
 * "success" 仅在受理(含幂等重复)时返回,其余非 success 让网关重试。
 */
import { type NextRequest, NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { getPayGateway } from "@/lib/pay/gateway";
import { handleNotify } from "@/lib/pay/order-service";

export const dynamic = "force-dynamic";

async function parsePayload(req: NextRequest): Promise<Record<string, string> | null> {
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await req.json()) as unknown;
      return body && typeof body === "object" && !Array.isArray(body)
        ? Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)]))
        : null;
    }
    const form = await req.formData();
    return Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const payload = await parsePayload(req);
  if (!payload) {
    logger.warn({ event: "pay.notify_rejected", reason: "bad_payload" });
    return new NextResponse("fail", { status: 400 });
  }
  const gateway = await getPayGateway();
  if (!gateway) {
    logger.warn({ event: "pay.notify_rejected", reason: "gateway_off" });
    return new NextResponse("fail", { status: 503 });
  }
  const verified = gateway.verifyNotify(payload);
  const { ok } = await handleNotify(verified, payload);
  // ok=false(坏签/无单/金额不符)回非 success,网关按策略重试(留痕已落库可追溯)
  return ok
    ? new NextResponse("success", { status: 200 })
    : new NextResponse("fail", { status: 400 });
}
