/**
 * /api/posts 路由族共享协议层(arch/05-services §1:Handler 只做参数解析/鉴权/包络)。
 * mutation 守卫自 M5-b 起收编 lib/http/mutation-guard(media 域共用);
 * PostAdminError → HTTP 映射仍为本域私有。
 */
import { NextResponse } from "next/server";

import { PostAdminError, type PostAdminErrorCode } from "@/lib/content/posts-admin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export { requireAdminForMutation } from "@/lib/http/mutation-guard";

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
