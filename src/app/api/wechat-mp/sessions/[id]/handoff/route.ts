/**
 * 处置转人工线索(M66):标记已处理 + 备注;该用户无其他 open 线索时解除待办角标。
 * admin-only(cookie 会话)+ Origin 校验。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminRequest } from "@/lib/auth/guard";
import { resolveLead } from "@/lib/channel/wechat-mp/admin";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  leadId: z.string().regex(/^\d+$/),
  note: z.string().trim().max(2000).optional().default(""),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return apiEnvelope(400, "invalid id");

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "参数不合法:leadId 必填,备注 ≤2000 字");

  const result = await resolveLead(BigInt(parsed.data.leadId), parsed.data.note);
  if (!result.ok) return apiEnvelope(404, result.error);

  logger.info({
    event: "admin.wechat_mp.lead_resolved",
    sessionId: id,
    leadId: parsed.data.leadId,
    hasNote: parsed.data.note.length > 0,
  });
  return apiEnvelope(0, "已标记处理");
}
