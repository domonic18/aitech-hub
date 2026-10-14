import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ADMIN_ROLE } from "@/lib/auth/constants";
import { ACCESS_COOKIE_NAME, verifyAccessToken } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { isBotUa } from "@/lib/stats/classify";
import { CLICK_KINDS, CLICK_SURFACES, ingestClick } from "@/lib/stats/clicks";

/**
 * 条目点击 beacon(M28 批①:首页/电报流条目点击行为,POST /api/stats/click)。
 * 公开接口:与 /api/view 同护栏——同源校验/去 bot/去管理员;mutation 类需同源。
 * ref 是条目键(telegram/post=BigInt id 文本、project=slug),字符集白名单收窄;
 * target 只用于服务端解析外链域名,不落原文。204 无包络:beacon 客户端不消费响应体。
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  surface: z.enum(CLICK_SURFACES),
  kind: z.enum(CLICK_KINDS),
  ref: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, "ref 字符集越界"),
  target: z.string().min(1, "target 不能为空").max(1000),
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
  if (session?.role === ADMIN_ROLE) {
    // 管理员点击不入行为账(与 PV 统计口径一致)
    return new NextResponse(null, { status: 204 }) as NextResponse;
  }
  if (isBotUa(req.headers.get("user-agent") ?? "")) {
    return new NextResponse(null, { status: 204 }) as NextResponse;
  }

  ingestClick(parsed.data);
  return new NextResponse(null, { status: 204 }) as NextResponse;
}
