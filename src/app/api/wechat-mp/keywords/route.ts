/**
 * 关键词直连管理(M66):GET 列表 / POST 新建。
 * admin-only(cookie 会话)+ Origin 校验;命中计数只读展示,不在此重置。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminRequest } from "@/lib/auth/guard";
import { createKeyword, listKeywordsAdmin } from "@/lib/channel/wechat-mp/admin";
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

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");
  return apiEnvelope(0, "ok", { items: await listKeywordsAdmin() });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "关键词 1-50 字;可挂文章或填固定话术");

  const result = await createKeyword(parsed.data);
  if (!result.ok) return apiEnvelope(409, result.error);

  logger.info({ event: "admin.wechat_mp.keyword_created", id: result.id });
  return apiEnvelope(0, "created", { id: result.id });
}
