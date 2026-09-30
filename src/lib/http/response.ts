/**
 * API 响应包络(arch/05-services §4):{ code, message, data }。
 * code=0 → HTTP 200;其余 code 同时作为 HTTP 状态码。Route Handler 共用,防形态漂移。
 */
import { NextResponse } from "next/server";

export function apiEnvelope(code: number, message: string, data: unknown = null): NextResponse {
  return NextResponse.json({ code, message, data }, { status: code === 0 ? 200 : code });
}
