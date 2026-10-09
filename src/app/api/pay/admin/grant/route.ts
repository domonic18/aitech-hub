/**
 * 人工开通/恢复 API(M21 批⑤,提案 §8):admin 输入用户(手机号或
 * wp_user_id)+ 文章 slug → entitlement 唯一写入口授予(source=manual /
 * 退款撤销后恢复=admin_restore,orderId=null)。操作者只进审计日志不落
 * purchase 表(无 operator 列;日志记事件+操作者 id+目标,不记凭据)。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminRequest } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { findUserByAccount } from "@/lib/pay/admin";
import { PURCHASE_SOURCES, grantPurchase } from "@/lib/pay/entitlement";
import { normalizeSlug } from "@/lib/slug";

export const dynamic = "force-dynamic";

const GrantSchema = z.object({
  /** 手机号或 wp_user_id(数字串) */
  account: z.string().trim().min(1, "账号不能为空").max(20),
  postSlug: z.string().trim().min(1, "文章 slug 不能为空").max(255),
  action: z.enum(["manual", "admin_restore"]),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const admin = await requireAdminRequest(req);
  if (!admin) return apiEnvelope(401, "unauthorized");

  const parsed = GrantSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, parsed.error.issues[0]?.message ?? "invalid body");
  }

  const user = await findUserByAccount(parsed.data.account);
  if (!user) return apiEnvelope(404, "用户不存在(手机号或 wp_user_id)");

  const post = await prisma.post.findFirst({
    where: { slug: normalizeSlug(parsed.data.postSlug), status: { not: "deleted" } },
    select: { id: true, title: true, status: true },
  });
  if (!post) return apiEnvelope(404, "文章不存在");

  const source = parsed.data.action;
  if (!(PURCHASE_SOURCES as readonly string[]).includes(source)) {
    return apiEnvelope(400, "invalid action"); // zod 已限,双保险
  }
  await grantPurchase(prisma, {
    userId: user.id,
    postId: post.id,
    orderId: null,
    source,
  });
  logger.info({
    event: "admin.pay.manual_grant",
    operatorId: admin.sub,
    userId: user.id.toString(),
    postId: post.id.toString(),
    source,
  });
  return apiEnvelope(0, "ok", {
    message: `已${source === "manual" ? "开通" : "恢复"}:${post.title}`,
  });
}
