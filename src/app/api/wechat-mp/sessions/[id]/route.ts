/**
 * 公众号会话明细(M66):渠道用户 + 200 条消息时间轴 + 线索列表。
 * admin-only(cookie 会话);只读。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { getSessionAdmin } from "@/lib/channel/wechat-mp/admin";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return apiEnvelope(400, "invalid id");

  const detail = await getSessionAdmin(BigInt(id));
  if (!detail) return apiEnvelope(404, "session not found");
  return apiEnvelope(0, "ok", detail);
}
