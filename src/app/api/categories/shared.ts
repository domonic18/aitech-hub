/** 分类 API 共享件(同 posts/shared 口径):错误码 → HTTP 状态映射单点 */
import { NextResponse } from "next/server";

import { CategoryAdminError } from "@/lib/content/categories-admin";
import { apiEnvelope } from "@/lib/http/response";

const ERROR_STATUS = {
  not_found: 404,
  slug_conflict: 409,
  in_use: 409,
  last_category: 409,
} as const satisfies Record<CategoryAdminError["code"], number>;

export function categoryErrorResponse(e: unknown): NextResponse | null {
  if (e instanceof CategoryAdminError) {
    return apiEnvelope(ERROR_STATUS[e.code], e.message);
  }
  return null;
}
