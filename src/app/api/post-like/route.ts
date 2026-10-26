/**
 * 文章点赞 API(M23 批②):POST toggle(游客可赞,identityKey 单列去重,
 * 再点取消)+ GET 初始化 {liked, count}。身份走 resolveAgentIdentity 三路;
 * fresh 游客随响应种 ah_av cookie(GET 即种,首赞与状态查询同 uuid)。
 * 限流(身份 60/时 + IP 240/时)在 service。
 */
import { type NextRequest, NextResponse } from "next/server";

import { attachIdentityCookie, resolveAgentIdentity } from "@/lib/agent/identity";
import { postLikeSchema } from "@/lib/comment/comment-schema";
import { getPostLikeState, togglePostLike } from "@/lib/comment/like-service";
import { commentDomainErrorStatus } from "@/lib/comment/http-map";
import { clientIp } from "@/lib/http/request";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const parsed = postLikeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "invalid body");
  const identity = await resolveAgentIdentity(req);
  try {
    const state = await togglePostLike(parsed.data.postId, identity, clientIp(req));
    const res = apiEnvelope(0, "ok", state);
    attachIdentityCookie(res, identity);
    return res;
  } catch (e) {
    const status = commentDomainErrorStatus(e);
    if (status === null) throw e;
    return apiEnvelope(status, e instanceof Error ? e.message : "error");
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = new URL(req.url).searchParams;
  const parsed = postLikeSchema.safeParse({ postId: sp.get("postId") ?? undefined });
  if (!parsed.success) return apiEnvelope(400, "invalid query");
  const identity = await resolveAgentIdentity(req);
  try {
    const state = await getPostLikeState(parsed.data.postId, identity);
    const res = apiEnvelope(0, "ok", state);
    attachIdentityCookie(res, identity);
    return res;
  } catch (e) {
    const status = commentDomainErrorStatus(e);
    if (status === null) throw e;
    return apiEnvelope(status, e instanceof Error ? e.message : "error");
  }
}
