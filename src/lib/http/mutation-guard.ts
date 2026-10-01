/**
 * mutation 类 Route Handler 共用三关守卫(arch/07-frontend §4):
 * Origin → 会话完整校验 → role(admin)。失败返回响应,通过返回 null。
 * (M5-b 起由 /api/posts 与 /api/media 两域共用,原 posts/shared 实现收编至此)
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export async function requireAdminForMutation(req: NextRequest): Promise<NextResponse | null> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const claims = await requireAdminRequest(req);
  if (!claims) {
    logger.warn({ event: "authz.denied", path: new URL(req.url).pathname });
    return apiEnvelope(401, "unauthorized");
  }
  return null;
}
