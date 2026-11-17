/**
 * AI 答案卡 SSE 端点(K2,arch/04 §3.4;站内首个流式 Handler):
 * q 校验(缺失/空 → 400 JSON)→ IP 频控(超 → 429)→ createAnswerStream。
 * 业务降级(无绑定/超日配额/生成失败)一律 SSE unavailable 事件,不占 HTTP 状态;
 * SSE 头 no-store + x-accel-buffering:no(nginx 即时透传,反代侧另配
 * location ^~ /api/search/ proxy_buffering off,见 arch/05 §5)。
 */
import { type NextRequest } from "next/server";

import { readVisitorId } from "@/lib/agent/visitor";
import { apiEnvelope } from "@/lib/http/response";
import { clientIp } from "@/lib/http/request";
import { tryConsumeAnswerQuota } from "@/lib/search/rate-limit";
import { createAnswerStream } from "@/lib/search/answer-service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q === "") {
    return apiEnvelope(400, "缺少 q 参数");
  }
  if (!(await tryConsumeAnswerQuota(clientIp(req)))) {
    return apiEnvelope(429, "请求过于频繁,请稍后再试");
  }
  // 留档访客标识(批A):ah_av cookie uuid;fresh 游客无 cookie 为 null
  // (本端点返回裸 SSE 流,不做 Set-Cookie 补发)
  const stream = await createAnswerStream(q, readVisitorId(req));
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
