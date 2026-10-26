/**
 * GET /api/distribute/xiaohongshu/material?postId=(M49 批X2):物料视图轮询端点。
 * 行不存在 → data.material=null(status=null),前端据此呈现「生成」入口;
 * pending→ready→synced 状态机由前端按 status 驱动。
 */
import { type NextRequest, NextResponse } from "next/server";

import { parsePostId } from "@/lib/content/posts-admin";
import { getXhsMaterial } from "@/lib/distribute/xhs";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const actor = await requireSessionActor(req, "PAT 不能读取分发物料");
  if (actor.kind === "reject") return actor.response;
  const postId = parsePostId(req.nextUrl.searchParams.get("postId") ?? "");
  if (postId === null) {
    return apiEnvelope(400, "参数无效");
  }
  const view = await getXhsMaterial(postId);
  return apiEnvelope(
    0,
    "ok",
    view ?? {
      status: null,
      material: null,
      lastError: null,
      postTitle: "",
      coverUrl: null,
      images: [],
    },
  );
}
