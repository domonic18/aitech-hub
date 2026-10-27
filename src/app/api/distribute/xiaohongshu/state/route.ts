/**
 * GET /api/distribute/xiaohongshu/state(M49 批X3):小红书登录态探针。
 * 会话鉴权;web 转发 xhs-gateway /xhs/state(探针必须可答,永不 5xx 语义)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { fetchXhsState } from "@/lib/distribute/xhs-probe";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage pins";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  // M50 批F:取数逻辑收口 xhs-probe(与 worker 每日探照同源),应答形状不变
  const snap = await fetchXhsState();
  return apiEnvelope(0, "ok", {
    storage_state_ready: snap.storage_state_ready,
    logged_in: snap.logged_in,
    ...(snap.error ? { error: snap.error } : {}),
  });
}
