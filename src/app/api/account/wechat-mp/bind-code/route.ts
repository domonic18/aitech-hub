/**
 * 公众号绑定码(M66):登录用户在账号设置页生成一次性 8 位码,
 * 复制到公众号里发出即完成绑定(认证订阅号无网页授权,只能这样反着打通)。
 * 用户中心守卫(session 完整校验)+ Origin 校验。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAccountRequest } from "@/lib/auth/guard";
import { issueBindCode } from "@/lib/channel/wechat-mp/bind";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const session = await requireAccountRequest(req);
  if (!session) return apiEnvelope(401, "请先登录");

  try {
    const r = await issueBindCode(BigInt(session.sub));
    logger.info({ event: "account.wechat_mp.bind_code_issued", userId: session.sub });
    return apiEnvelope(0, "ok", r);
  } catch (e) {
    logger.error({
      event: "account.wechat_mp.bind_code_failed",
      userId: session.sub,
      error: e instanceof Error ? e.message : String(e),
    });
    return apiEnvelope(500, "绑定码生成失败,请稍后重试");
  }
}
