/**
 * POST /api/posts/cover-candidates/[id]/adopt(D3,2026-11-15):采纳一张封面候选——
 * 临时件入库媒体库并设为文章封面。
 *
 * 与预览路由同一条 hold 口径:候选先落临时盘(不进媒体库),adopt 时才
 * uploadMedia;设封面失败不回滚入库(降级回报,可在封面设置处手动选用)。
 *
 * 鉴权:仅会话(admin 编辑器交互面);PAT 拒。
 */
import { type NextRequest } from "next/server";

import { adoptCoverForPost } from "@/lib/ai/cover-candidates";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { parseBigIntId } from "@/lib/http/parse-id";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await requireSessionActor(req, "PAT 不能采纳封面候选");
  if (actor.kind === "reject") return actor.response;

  const { id } = await params;
  const candidateId = parseBigIntId(id);
  if (candidateId === null) return apiEnvelope(400, "候选 id 不合法");

  let body: { postId?: unknown };
  try {
    body = (await req.json()) as { postId?: unknown };
  } catch {
    return apiEnvelope(400, "请求体不是合法 JSON");
  }
  const postId = typeof body.postId === "string" ? body.postId.trim() : "";
  if (!/^\d+$/.test(postId)) return apiEnvelope(400, "postId 缺失或不合法");

  try {
    const r = await adoptCoverForPost({ candidateId: candidateId.toString(), postId });
    return apiEnvelope(0, "ok", {
      path: r.path,
      coverSet: r.coverSet,
      ...(r.coverError ? { coverError: r.coverError } : {}),
    });
  } catch (e) {
    return apiEnvelope(400, e instanceof Error ? e.message : "入库失败");
  }
}
