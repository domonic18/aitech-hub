/**
 * /api/media 路由族共享协议层(arch/05-services §1):守卫 + MediaError → HTTP 映射。
 * mutation 守卫与 posts 域共用 lib/http/mutation-guard(M5-b 收编)。
 */
import { NextResponse } from "next/server";

import { MediaError, type MediaErrorCode } from "@/lib/media/service";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export { requireAdminForMutation } from "@/lib/http/mutation-guard";

const ERROR_STATUS = {
  not_found: 404,
  referenced: 409,
  invalid: 400,
  too_large: 413,
  unsupported: 415,
} as const satisfies Record<MediaErrorCode, number>;

export function mediaErrorResponse(e: unknown): NextResponse {
  if (e instanceof MediaError) {
    return apiEnvelope(ERROR_STATUS[e.code], e.message);
  }
  logger.error({ event: "media.write.fail", error: String(e) });
  return apiEnvelope(500, "internal error");
}
