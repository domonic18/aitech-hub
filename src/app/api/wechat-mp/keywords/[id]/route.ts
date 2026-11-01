/**
 * 关键词直连单条(M66):PUT 改 / DELETE 删。admin-only + Origin 校验。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminRequest } from "@/lib/auth/guard";
import { deleteKeyword, updateKeyword } from "@/lib/channel/wechat-mp/admin";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  keyword: z.string().trim().min(1).max(50),
  postId: z.string().regex(/^\d+$/).nullish(),
  replyText: z.string().trim().max(2000).nullish(),
  isEnabled: z.boolean().optional(),
});

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return apiEnvelope(400, "invalid id");

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "关键词 1-50 字;可挂文章或填固定话术");

  const result = await updateKeyword(BigInt(id), parsed.data);
  if (!result.ok) return apiEnvelope(result.error.includes("已存在") ? 409 : 404, result.error);

  logger.info({ event: "admin.wechat_mp.keyword_updated", id });
  return apiEnvelope(0, "saved");
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return apiEnvelope(400, "invalid id");

  const result = await deleteKeyword(BigInt(id));
  if (!result.ok) return apiEnvelope(404, result.error);

  logger.info({ event: "admin.wechat_mp.keyword_deleted", id });
  return apiEnvelope(0, "deleted");
}
