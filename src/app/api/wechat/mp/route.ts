/**
 * 微信公众号服务器回调(M66)。
 *
 * 无站点会话、无 Origin 校验:调用方是微信服务器,**唯一凭据是签名**
 * (明文 `signature` / 安全模式 `msg_signature`,均以后台配置的 Token 计算)。
 * 因此本路由不走 requireAdminRequest / isSameOrigin,校验落在 service 层。
 *
 * GET  = 公众号后台「服务器配置」提交时的验签回显;
 * POST = 用户消息/事件,todo 在 5s 内返回被动回复 XML。
 */
import type { NextRequest } from "next/server";

import { handleWechatMpGet, handleWechatMpPost } from "@/lib/channel/wechat-mp/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toResponse(r: { status: number; body: string; contentType: string }): Response {
  return new Response(r.body, {
    status: r.status,
    headers: { "Content-Type": r.contentType, "Cache-Control": "no-store" },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  return toResponse(await handleWechatMpGet(req.nextUrl.searchParams));
}

export async function POST(req: NextRequest): Promise<Response> {
  const rawBody = await req.text();
  return toResponse(await handleWechatMpPost(rawBody, req.nextUrl.searchParams));
}
