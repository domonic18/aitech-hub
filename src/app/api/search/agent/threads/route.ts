/**
 * Drawer 线程列表/新建(K2.5,arch/04 §3.1「线程列表 今/昨/更早 + 新建」):
 * GET 平铺列表(前端按 lastMessageAt 分组);POST 新建(Redis 独立配额
 * 20/日,超 429)。公开接口,mutation 走 isSameOrigin;访客 cookie 首次
 * 交互下发(ah_av)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { tryConsumeSessionQuota } from "@/lib/agent/quota";
import { createSession, listSessions } from "@/lib/agent/sessions";
import { attachVisitorCookie, resolveVisitorId } from "@/lib/agent/visitor";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const visitor = resolveVisitorId(req);
  const sessions = await listSessions(visitor.id);
  const res = apiEnvelope(0, "ok", sessions);
  if (visitor.fresh) attachVisitorCookie(res, visitor.id);
  return res;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const visitor = resolveVisitorId(req);
  if (!(await tryConsumeSessionQuota(visitor.id))) {
    logger.info({ event: "agent.session_quota_exceeded", visitorId: visitor.id });
    return apiEnvelope(429, "今日新建会话已达上限(20 个),明天再来吧");
  }
  const { id } = await createSession(visitor.id);
  const res = apiEnvelope(0, "ok", { threadId: id });
  if (visitor.fresh) attachVisitorCookie(res, visitor.id);
  return res;
}
