/**
 * 付费全文获取 API(M21 批③):门禁的最后防线——全文 HTML/md 只经此口
 * 下发(登录 + 有效权益或 admin), ISR 缓存的截断预览页永不携带全文。
 * 显式 no-store(响应含付费内容,禁任何缓存层留存)。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { readSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { apiEnvelope } from "@/lib/http/response";
import { hasValidPurchase } from "@/lib/pay/entitlement";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({ postId: z.coerce.bigint().positive() });

export async function GET(req: NextRequest): Promise<NextResponse> {
  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return apiEnvelope(400, "invalid postId");
  const session = await readSessionUser(req.headers.get("cookie"));
  if (!session) return apiEnvelope(401, "请先登录后解锁");

  const isAdmin = session.role === "admin";
  const userId = BigInt(session.sub);
  if (!isAdmin && !(await hasValidPurchase(userId, parsed.data.postId))) {
    return apiEnvelope(403, "未持有该文章权益");
  }

  const post = await prisma.post.findFirst({
    where: { id: parsed.data.postId, status: "published", publishedAt: { not: null } },
    select: { contentMd: true, contentHtml: true },
  });
  if (!post) return apiEnvelope(404, "文章不存在");

  return NextResponse.json(
    { code: 0, message: "ok", data: { contentMd: post.contentMd, contentHtml: post.contentHtml } },
    { headers: { "cache-control": "no-store" } },
  );
}
