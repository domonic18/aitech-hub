/**
 * GET /api/distribute/xiaohongshu/state(M49 批X3):小红书登录态探针。
 * 会话鉴权;web 转发 xhs-gateway /xhs/state(探针必须可答,永不 5xx 语义)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage pins";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const base = process.env.DOUYIN_GATEWAY_URL ?? "http://douyin-gateway:8010";
  try {
    const res = await fetch(`${base}/xhs/state`, {
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return apiEnvelope(0, "ok", data ?? { storage_state_ready: false, logged_in: null });
  } catch (e) {
    return apiEnvelope(0, "ok", {
      storage_state_ready: false,
      logged_in: null,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
