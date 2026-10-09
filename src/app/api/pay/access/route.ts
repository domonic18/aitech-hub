/**
 * 文章解锁状态 API(M21 批③):详情页 ISR 缓存截断预览,解锁卡为客户端
 * island——本接口供 island 挂载时查当前用户对该文的权益与收银台形态。
 * 未登录合法(游客看到引导登录态);mode 供卡片区分「去支付/联系站长」。
 * admin/作者豁免由 content API 自行判角色;此处保持纯权益语义。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ACCESS_COOKIE_NAME, verifyAccessToken } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { apiEnvelope } from "@/lib/http/response";
import { hasValidPurchase } from "@/lib/pay/entitlement";
import { getPayGateway } from "@/lib/pay/gateway";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({ postId: z.coerce.bigint().positive() });

export async function GET(req: NextRequest): Promise<NextResponse> {
  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return apiEnvelope(400, "invalid postId");

  const session = await verifyAccessToken(req.cookies.get(ACCESS_COOKIE_NAME)?.value);
  const gateway = await getPayGateway();
  const mode = (gateway?.name ?? "off") as "off" | "mock" | "xunhu";
  if (!session) {
    return apiEnvelope(0, "ok", { loggedIn: false, hasAccess: false, mode });
  }
  // 门禁档位(补齐批):登录可见文已登录即放行;付费文验权益;admin 豁免(content API 同口径)
  const post = await prisma.post.findUnique({
    where: { id: parsed.data.postId },
    select: { isPurchasable: true, isLoginRequired: true },
  });
  const hasAccess =
    session.role === "admin" ||
    post?.isLoginRequired === true ||
    (post?.isPurchasable === true &&
      (await hasValidPurchase(BigInt(session.sub), parsed.data.postId)));
  return apiEnvelope(0, "ok", { loggedIn: true, hasAccess, mode });
}
