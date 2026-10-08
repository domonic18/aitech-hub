/**
 * 配套文章关联(M11 批②):GET 出关联弹窗数据(已发布文章 + 当前关联标记,
 * id 字符串化);PUT 整体替换(事务删旧插新,仅 published,成功失效详情/列表)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import {
  GithubAdminError,
  RepoPostsSchema,
  listRepoPostOptions,
  setRepoPosts,
} from "@/lib/github/repos-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage github repos";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return apiEnvelope(400, "invalid id");
  try {
    const items = await listRepoPostOptions(Number(id));
    return apiEnvelope(0, "ok", { items });
  } catch (e) {
    if (e instanceof GithubAdminError) return apiEnvelope(404, e.message);
    throw e;
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return apiEnvelope(400, "invalid id");
  const parsed = RepoPostsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "postIds 须为 id 字符串数组(至多 50)");
  try {
    const r = await setRepoPosts(Number(id), parsed.data.postIds);
    return apiEnvelope(0, "updated", r);
  } catch (e) {
    if (e instanceof GithubAdminError) {
      return apiEnvelope(
        e.code === "not_found" ? 404 : e.code === "invalid" ? 400 : 409,
        e.message,
      );
    }
    throw e;
  }
}
