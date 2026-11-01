/**
 * 后台会话管理列表 API(K2.6 需求5,admin 会话通道——同 users 套路,PAT 不
 * 得触达):GET page/kind(all|member|guest)/q;member 行 + 游客台账聚合
 * 合并视图,游客活跃态查 Redis 归属键。
 */
import { type NextRequest, NextResponse } from "next/server";

import { parsePage } from "@/lib/admin/list";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import {
  AGENT_SESSION_KINDS,
  listAgentSessionsAdmin,
  type AgentSessionKindFilter,
} from "@/lib/agent/admin-sessions";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage agent sessions";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const url = new URL(req.url);
  const raw = url.searchParams.get("kind");
  const kind: AgentSessionKindFilter = (AGENT_SESSION_KINDS as readonly string[]).includes(
    raw ?? "",
  )
    ? (raw as AgentSessionKindFilter)
    : "all";
  const result = await listAgentSessionsAdmin({
    page: parsePage(url.searchParams.get("page")),
    kind,
    q: url.searchParams.get("q")?.trim() || undefined,
  });
  return apiEnvelope(0, "ok", result);
}
