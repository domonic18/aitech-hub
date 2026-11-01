/**
 * 公众号解绑(M66):DELETE 清除本站内账号与 openid 的关联(渠道用户行保留,
 * 历史会话与线索不丢)。用户中心守卫 + Origin 校验。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAccountRequest } from "@/lib/auth/guard";
import { getUserBinding } from "@/lib/channel/wechat-mp/bind";
import { unbindChannelUser } from "@/lib/channel/wechat-mp/inbound";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await requireAccountRequest(req);
  if (!session) return apiEnvelope(401, "请先登录");
  return apiEnvelope(0, "ok", await getUserBinding(BigInt(session.sub)));
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const session = await requireAccountRequest(req);
  if (!session) return apiEnvelope(401, "请先登录");

  const count = await unbindChannelUser(BigInt(session.sub));
  logger.info({ event: "account.wechat_mp.unbound", userId: session.sub, count });
  return apiEnvelope(0, count > 0 ? "已解绑" : "当前未绑定", { count });
}
