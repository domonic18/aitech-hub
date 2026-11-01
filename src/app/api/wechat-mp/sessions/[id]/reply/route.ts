/**
 * 人工答复(M66 转人工闭环):保存 / 撤销待投递答复。
 *
 * 认证订阅号无客服消息权限,答复存在用户行上,等他下次发言时由被动回复带出
 * (契约见 lib/channel/wechat-mp/manual.ts 与 arch/05 §4.10)。
 * admin-only(cookie 会话)+ Origin 校验。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminRequest } from "@/lib/auth/guard";
import { clearManualReply, saveManualReply } from "@/lib/channel/wechat-mp/manual";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

function guard(req: NextRequest): NextResponse | null {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  return null;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rejected = guard(req);
  if (rejected) return rejected;
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return apiEnvelope(400, "invalid id");

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "参数不合法:答复内容必填,≤2000 字");

  const result = await saveManualReply(BigInt(id), parsed.data.text);
  if (!result.ok) return apiEnvelope(404, result.error);

  logger.info({ event: "admin.wechat_mp.manual_reply_saved", sessionId: id });
  return apiEnvelope(0, "已保存,用户下次发言时自动送达");
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rejected = guard(req);
  if (rejected) return rejected;
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return apiEnvelope(400, "invalid id");

  await clearManualReply(BigInt(id));
  logger.info({ event: "admin.wechat_mp.manual_reply_cleared", sessionId: id });
  return apiEnvelope(0, "已撤销待投递答复");
}
