/**
 * 词库单条状态流转 API(M25 批③治理台):PUT { status: active|dismissed|pending }。
 * active 记 confirmedAt,pending/dismissed 清之(语义统一在 setKeywordStatus)。
 */
import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { setKeywordStatus } from "@/lib/discovery/keywords";
import { KEYWORD_STATUSES } from "@/lib/discovery/status";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage discovery keywords";

const Body = z.object({ status: z.enum(KEYWORD_STATUSES) });

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return apiEnvelope(400, "invalid id");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "status 不合法");
  try {
    const row = await setKeywordStatus(BigInt(id), parsed.data.status);
    return apiEnvelope(0, "ok", { id: row.id.toString(), status: row.status });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return apiEnvelope(404, "关键词不存在");
    }
    throw e;
  }
}
