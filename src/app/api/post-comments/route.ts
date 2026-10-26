/**
 * 文章评论公开 API(M23 批②):GET 分页列表(visible+个人化 liked 现判,
 * IP 读限 120/分)+ POST 登录发评(先发后审,即时 visible;屏蔽词与双闸
 * 限流在 service)。force-dynamic + BigInt 字符串化(service 序列化层);
 * 评论区为 client island,不进 ISR,治理动作零 revalidate。
 */
import { type NextRequest, NextResponse } from "next/server";

import { resolveAgentIdentity } from "@/lib/agent/identity";
import { ACCESS_COOKIE_NAME, verifyAccessToken } from "@/lib/auth/session";
import { commentCreateBodySchema, commentListQuerySchema } from "@/lib/comment/comment-schema";
import {
  createPostComment,
  guardCommentList,
  listPostComments,
} from "@/lib/comment/comment-service";
import { buildIdentityKey } from "@/lib/comment/like-service";
import { commentDomainErrorStatus } from "@/lib/comment/http-map";
import { clientIp } from "@/lib/http/request";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = new URL(req.url).searchParams;
  const parsed = commentListQuerySchema.safeParse({
    postId: sp.get("postId") ?? undefined,
    page: sp.get("page") ?? undefined,
  });
  if (!parsed.success) return apiEnvelope(400, "invalid query");
  try {
    await guardCommentList(clientIp(req));
    const identity = await resolveAgentIdentity(req);
    const result = await listPostComments(
      parsed.data.postId,
      parsed.data.page,
      buildIdentityKey(identity),
    );
    return apiEnvelope(0, "ok", result);
  } catch (e) {
    const status = commentDomainErrorStatus(e);
    if (status === null) throw e;
    return apiEnvelope(status, e instanceof Error ? e.message : "error");
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const claims = await verifyAccessToken(req.cookies.get(ACCESS_COOKIE_NAME)?.value);
  if (!claims) return apiEnvelope(401, "请先登录后评论");
  const parsed = commentCreateBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, parsed.error.issues[0]?.message ?? "invalid body");
  }
  try {
    const item = await createPostComment({
      postId: parsed.data.postId,
      userId: BigInt(claims.sub),
      content: parsed.data.content,
      parentId: parsed.data.parentId === undefined ? undefined : BigInt(parsed.data.parentId),
      ip: clientIp(req),
    });
    return apiEnvelope(0, "ok", { item });
  } catch (e) {
    const status = commentDomainErrorStatus(e);
    if (status === null) throw e;
    return apiEnvelope(status, e instanceof Error ? e.message : "error");
  }
}
