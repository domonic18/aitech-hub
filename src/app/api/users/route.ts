/**
 * 用户管理 API(M5-c):仅会话通道——PAT 凭证限发布域,不得触达用户管理。
 * GET 四分段列表(page/status/q)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { USER_LIST_SEGMENTS, listUsersAdmin, type UserListSegment } from "@/lib/users/admin-users";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage users";

function parsePage(raw: string | null): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const url = new URL(req.url);
  const raw = url.searchParams.get("status");
  const segment: UserListSegment = (USER_LIST_SEGMENTS as readonly string[]).includes(raw ?? "")
    ? (raw as UserListSegment)
    : "all";
  const result = await listUsersAdmin({
    page: parsePage(url.searchParams.get("page")),
    segment,
    q: url.searchParams.get("q")?.trim() || undefined,
  });
  return apiEnvelope(0, "ok", result);
}
