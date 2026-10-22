/**
 * 贴图域 PinError → HTTP 映射(M41 路由共用):
 * not_found/version_not_found→404 / invalid_input→400 / edit_locked·image_overflow·
 * invalid_transition→409(与当前事实冲突)。其余原样上抛(5xx)。
 */
import { NextResponse } from "next/server";

import { apiEnvelope } from "@/lib/http/response";

import { PinError } from "./repo";

export function mapPinError(e: unknown): NextResponse | null {
  if (!(e instanceof PinError)) return null;
  const status =
    e.code === "not_found" || e.code === "version_not_found"
      ? 404
      : e.code === "invalid_input"
        ? 400
        : 409;
  return apiEnvelope(status, e.message);
}
