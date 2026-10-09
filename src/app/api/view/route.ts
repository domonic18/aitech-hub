import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ADMIN_ROLE } from "@/lib/auth/constants";
import { ACCESS_COOKIE_NAME, verifyAccessToken } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { isSameOrigin } from "@/lib/http/origin";
import { clientIp } from "@/lib/http/request";
import { apiEnvelope } from "@/lib/http/response";
import { ingestView } from "@/lib/stats/service";

/**
 * 全站 beacon 上报(arch/05-services §5 stats:POST /api/view;requirement §3.5)。
 * 公开接口:去 bot/去管理员;UV 用 IP+UA 哈希(不存明文 IP);mutation 类需同源校验。
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  path: z.string().min(1, "path 不能为空").max(500),
  referrer: z.string().max(2000).optional(),
  q: z.string().max(200).optional(), // /search 页搜索词原文;归一与截断在 ingestView 侧
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return apiEnvelope(400, "invalid json");
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }

  const session = await verifyAccessToken(req.cookies.get(ACCESS_COOKIE_NAME)?.value);
  await ingestView({
    path: parsed.data.path,
    referrer: parsed.data.referrer ?? "",
    ua: req.headers.get("user-agent") ?? "",
    ip: clientIp(req),
    salt: env.AUTH_SECRET,
    isAdmin: session?.role === ADMIN_ROLE,
    q: parsed.data.q,
  });
  // 204 无包络:beacon 场景客户端不消费响应体
  return new NextResponse(null, { status: 204 }) as NextResponse;
}
