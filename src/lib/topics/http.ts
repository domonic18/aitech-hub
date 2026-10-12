/**
 * 专题域 TopicError → HTTP 映射(M26 批③治理台路由共用):
 * not_found→404 / invalid_material·invalid_transition→409(与当前事实冲突)/
 * conflict→409。其余原样上抛(5xx)。
 */
import { NextResponse } from "next/server";

import { apiEnvelope } from "@/lib/http/response";

import { TopicError } from "./repo";

export function mapTopicError(e: unknown): NextResponse | null {
  if (!(e instanceof TopicError)) return null;
  const status = e.code === "not_found" ? 404 : 409;
  return apiEnvelope(status, e.message);
}
