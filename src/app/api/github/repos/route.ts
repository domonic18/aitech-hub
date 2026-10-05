/**
 * GitHub 仓库台账 API(M11 批②):列表与登记。同步消费 GitHub API 配额并
 * 决定前台展示面,仅会话通道(PAT 不得管理 github repos)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import {
  GithubAdminError,
  RepoCreateSchema,
  createRepo,
  listReposAdmin,
} from "@/lib/github/repos-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage github repos";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const items = await listReposAdmin();
  return apiEnvelope(0, "ok", { items });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = RepoCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "登记字段不合法(须为 owner/name 形态)");
  try {
    const r = await createRepo(parsed.data);
    return apiEnvelope(0, "created", r);
  } catch (e) {
    if (e instanceof GithubAdminError) {
      return apiEnvelope(
        e.code === "not_found" ? 404 : e.code === "duplicate" ? 409 : 400,
        e.message,
      );
    }
    throw e;
  }
}
