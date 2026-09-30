/**
 * /api/posts 路由族共享协议层(arch/05-services §1:Handler 只做参数解析/鉴权/包络):
 * admin 鉴权(Origin + 会话)、路径 id 解析、PostAdminError → HTTP 映射。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { PostAdminError, type PostAdminErrorCode } from "@/lib/content/posts-admin";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export function parsePostId(raw: string): bigint | null {
  if (!/^\d+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

/** mutation 三关:Origin → 会话完整校验 → role(admin);失败返回响应,通过返回 null */
export async function requireAdminForMutation(req: NextRequest): Promise<NextResponse | null> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const claims = await requireAdminRequest(req);
  if (!claims) {
    logger.warn({ event: "authz.denied", path: new URL(req.url).pathname });
    return apiEnvelope(401, "unauthorized");
  }
  return null;
}

const ERROR_STATUS = {
  not_found: 404,
  slug_conflict: 409,
  legacy_readonly: 409,
  category_missing: 400,
} as const satisfies Record<PostAdminErrorCode, number>;

export function postErrorResponse(e: unknown): NextResponse {
  if (e instanceof PostAdminError) {
    return apiEnvelope(ERROR_STATUS[e.code], e.message);
  }
  logger.error({ event: "post.write.fail", error: String(e) });
  return apiEnvelope(500, "internal error");
}
