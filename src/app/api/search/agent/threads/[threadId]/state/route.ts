/**
 * 线程状态恢复(K2.5;K2.6 身份分流):切线程时前端 getState 契约——
 * values.messages 扁平序列化(同 wire 口径)。admin 查会话行归属;游客查
 * Redis 归属键(过期/非本人 → 404「会话已过期」,前端据此自愈开新会话)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { getThreadMessages } from "@/lib/agent/checkpointer";
import { isGuestThreadId, getGuestThreadOwner } from "@/lib/agent/guest-threads";
import { resolveAgentIdentity } from "@/lib/agent/identity";
import { serializeWireMessage } from "@/lib/agent/wire";
import { prisma } from "@/lib/db";
import { apiEnvelope } from "@/lib/http/response";
import type { BaseMessage } from "@langchain/core/messages";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
): Promise<NextResponse> {
  const { threadId } = await params;
  const identity = await resolveAgentIdentity(req);
  if (identity.kind === "guest") {
    if (!isGuestThreadId(threadId)) return apiEnvelope(404, "会话不存在");
    const owner = await getGuestThreadOwner(threadId);
    if (owner !== identity.key) return apiEnvelope(404, "会话已过期");
  } else {
    const row = await prisma.searchAgentSession.findUnique({
      where: { id: threadId },
      select: { visitorId: true },
    });
    if (!row || row.visitorId !== identity.key) return apiEnvelope(404, "会话不存在");
  }
  const messages = await getThreadMessages(threadId);
  return apiEnvelope(0, "ok", {
    values: {
      messages: (messages ?? []).map((m) => serializeWireMessage(m as BaseMessage)),
    },
  });
}
