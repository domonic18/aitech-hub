/**
 * 反馈 admin API(M22 批⑤,需求9):列表查询(GET,分段/搜索/分页)。
 * 状态流转在 /api/feedback/[id] PUT。admin 守卫走 requireAdminRequest
 * (与 /api/pay/admin/grant 同款);路径按仓库惯例落顶层域目录,无
 * /api/admin/ 命名空间。会话通道专用,PAT 不得触达用户反馈。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { parseListSegment, parsePage } from "@/lib/admin/list";
import {
  FEEDBACK_LIST_SEGMENTS,
  listFeedbackAdmin,
  type FeedbackListSegment,
} from "@/lib/feedback/feedback-admin";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const admin = await requireAdminRequest(req);
  if (!admin) return apiEnvelope(401, "unauthorized");

  const sp = new URL(req.url).searchParams;
  const segment = parseListSegment<FeedbackListSegment>(
    FEEDBACK_LIST_SEGMENTS,
    sp.get("status") ?? undefined,
    "all",
  );
  const result = await listFeedbackAdmin({
    page: parsePage(sp.get("page") ?? undefined),
    segment,
    q: sp.get("q")?.trim() || undefined,
  });
  return apiEnvelope(0, "ok", result);
}
