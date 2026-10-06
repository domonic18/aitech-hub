/**
 * 线程状态恢复(K2.5):切线程时前端 getState 契约——values.messages 扁平
 * 序列化(同 wire 口径)。归属校验:非本人/不存在 → 404(不泄露存在性)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { getThreadMessages } from "@/lib/agent/checkpointer";
import { serializeWireMessage } from "@/lib/agent/wire";
import { prisma } from "@/lib/db";
import { resolveVisitorId } from "@/lib/agent/visitor";
import { apiEnvelope } from "@/lib/http/response";
import type { BaseMessage } from "@langchain/core/messages";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
): Promise<NextResponse> {
  const { threadId } = await params;
  const visitor = resolveVisitorId(req);
  const row = await prisma.searchAgentSession.findUnique({
    where: { id: threadId },
    select: { visitorId: true },
  });
  if (!row || row.visitorId !== visitor.id) return apiEnvelope(404, "会话不存在");
  const messages = await getThreadMessages(threadId);
  return apiEnvelope(0, "ok", {
    values: {
      messages: (messages ?? []).map((m) => serializeWireMessage(m as BaseMessage)),
    },
  });
}
