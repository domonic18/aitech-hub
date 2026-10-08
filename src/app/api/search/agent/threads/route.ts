/**
 * Drawer 线程列表/新建(K2.5;K2.6 身份分流):
 * GET——admin 出会话列表(前端按 lastMessageAt 分组);游客恒空列表
 * (不落行,无列表语义)。
 * POST——admin 建会话行(Redis 配额 20/日);游客发 `g_` 线程 id
 * (Redis 绑归属 + 2h 活跃 TTL,零 DB 行,建会话不耗配额,按问计费闸)。
 * 公开接口,mutation 走 isSameOrigin;游客 cookie 首次交互下发(ah_av)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { tryConsumeSessionQuota } from "@/lib/agent/quota";
import { createSession, listSessions } from "@/lib/agent/sessions";
import { bindGuestThread, newGuestThreadId } from "@/lib/agent/guest-threads";
import { attachIdentityCookie, resolveAgentIdentity } from "@/lib/agent/identity";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const identity = await resolveAgentIdentity(req);
  const sessions = identity.kind === "admin" ? await listSessions(identity.key) : [];
  const res = apiEnvelope(0, "ok", sessions);
  attachIdentityCookie(res, identity);
  return res;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const identity = await resolveAgentIdentity(req);
  let threadId: string;
  if (identity.kind === "admin") {
    if (!(await tryConsumeSessionQuota(identity.key))) {
      logger.info({ event: "agent.session_quota_exceeded", visitorId: identity.key });
      return apiEnvelope(429, "今日新建会话已达上限(20 个),明天再来吧");
    }
    threadId = (await createSession(identity.key)).id;
  } else {
    // 游客:零行线程,归属绑 Redis(2h 活跃 TTL);fail-closed(Redis 挂 500)
    threadId = newGuestThreadId();
    await bindGuestThread(threadId, identity.key);
  }
  const res = apiEnvelope(0, "ok", { threadId });
  attachIdentityCookie(res, identity);
  return res;
}
