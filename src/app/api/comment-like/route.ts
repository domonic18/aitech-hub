/**
 * 评论点赞 API(M23 批②):与 /api/post-like 同构,目标换评论 id
 * (评论须 visible 且其文 published,service 校验)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { attachIdentityCookie, resolveAgentIdentity } from "@/lib/agent/identity";
import { commentLikeSchema } from "@/lib/comment/comment-schema";
import { getCommentLikeState, toggleCommentLike } from "@/lib/comment/like-service";
import { commentDomainErrorStatus } from "@/lib/comment/http-map";
import { clientIp } from "@/lib/http/request";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const parsed = commentLikeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "invalid body");
  const identity = await resolveAgentIdentity(req);
  try {
    const state = await toggleCommentLike(parsed.data.commentId, identity, clientIp(req));
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
  const parsed = commentLikeSchema.safeParse({ commentId: sp.get("commentId") ?? undefined });
  if (!parsed.success) return apiEnvelope(400, "invalid query");
  const identity = await resolveAgentIdentity(req);
  try {
    const state = await getCommentLikeState(parsed.data.commentId, identity);
    const res = apiEnvelope(0, "ok", state);
    attachIdentityCookie(res, identity);
    return res;
  } catch (e) {
    const status = commentDomainErrorStatus(e);
    if (status === null) throw e;
    return apiEnvelope(status, e instanceof Error ? e.message : "error");
  }
}
