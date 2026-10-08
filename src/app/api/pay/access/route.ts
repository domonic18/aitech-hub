/**
 * 文章解锁状态 API(M21 批③):详情页 ISR 缓存截断预览,解锁卡为客户端
 * island——本接口供 island 挂载时查当前用户对该文的权益与收银台形态。
 * 未登录合法(游客看到引导登录态);mode 供卡片区分「去支付/联系站长」。
 * admin/作者豁免由 content API 自行判角色;此处保持纯权益语义。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { readSessionUser } from "@/lib/auth/session";
import { apiEnvelope } from "@/lib/http/response";
import { hasValidPurchase } from "@/lib/pay/entitlement";
import { getPayGateway } from "@/lib/pay/gateway";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({ postId: z.coerce.bigint().positive() });

export async function GET(req: NextRequest): Promise<NextResponse> {
  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return apiEnvelope(400, "invalid postId");

  const session = await readSessionUser(req.headers.get("cookie"));
  const gateway = await getPayGateway();
  const mode = (gateway?.name ?? "off") as "off" | "mock" | "xunhu";
  if (!session) {
    return apiEnvelope(0, "ok", { loggedIn: false, hasAccess: false, mode });
  }
  // admin 与 content API 同口径豁免(后台抽检付费内容展示)
  const hasAccess =
    session.role === "admin" || (await hasValidPurchase(BigInt(session.sub), parsed.data.postId));
  return apiEnvelope(0, "ok", { loggedIn: true, hasAccess, mode });
}
