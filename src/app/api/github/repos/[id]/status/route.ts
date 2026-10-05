/**
 * 仓库开关(M11 批②):enabled=调度启停(停用不再同步);display=前台上下架
 * (下架不删数据,详情/列表/首页即时失效)。至少一项。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { GithubAdminError, RepoStatusSchema, setRepoStatus } from "@/lib/github/repos-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage github repos";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return apiEnvelope(400, "invalid id");
  const parsed = RepoStatusSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "enabled/display 须为布尔且至少一项");
  try {
    await setRepoStatus(Number(id), parsed.data);
    return apiEnvelope(0, "updated");
  } catch (e) {
    if (e instanceof GithubAdminError) return apiEnvelope(404, e.message);
    throw e;
  }
}
