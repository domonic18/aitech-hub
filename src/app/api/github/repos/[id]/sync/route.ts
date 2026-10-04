/** 手动触发仓库同步(M11 批②):入队即返回,结果看台账(spider 总览看队列)。 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { GithubAdminError, triggerRepoSync } from "@/lib/github/repos-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage github repos";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return apiEnvelope(400, "invalid id");
  try {
    const r = await triggerRepoSync(Number(id));
    return apiEnvelope(0, "enqueued", r);
  } catch (e) {
    if (e instanceof GithubAdminError) {
      return apiEnvelope(
        e.code === "not_found" ? 404 : e.code === "disabled" ? 409 : 400,
        e.message,
      );
    }
    throw e;
  }
}
