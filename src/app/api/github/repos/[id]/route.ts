/**
 * 仓库编辑/删除(M11 批②):编辑同步间隔/排序/备注;删除两步武装——
 * 调度启用中 409,停用后才可物理删(activity 与配套文章关联随 Cascade 清)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import {
  GithubAdminError,
  RepoUpdateSchema,
  deleteRepo,
  updateRepo,
} from "@/lib/github/repos-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage github repos";

function mapError(e: GithubAdminError): NextResponse {
  const status =
    e.code === "not_found"
      ? 404
      : e.code === "duplicate" || e.code === "enabled" || e.code === "disabled"
        ? 409
        : 400;
  return apiEnvelope(status, e.message);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return apiEnvelope(400, "invalid id");
  const parsed = RepoUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "编辑字段不合法(间隔 10..1440 / 排序 0..9999)");
  try {
    const r = await updateRepo(Number(id), parsed.data);
    return apiEnvelope(0, "updated", r);
  } catch (e) {
    if (e instanceof GithubAdminError) return mapError(e);
    throw e;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return apiEnvelope(400, "invalid id");
  try {
    await deleteRepo(Number(id));
    return apiEnvelope(0, "deleted");
  } catch (e) {
    if (e instanceof GithubAdminError) return mapError(e);
    throw e;
  }
}
