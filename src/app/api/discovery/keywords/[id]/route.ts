/**
 * 词库单条状态流转 API(M25 批③治理台):PUT { status: active|dismissed|pending|merged }。
 * active 记 confirmedAt,pending/dismissed 清之;merged 必带 mergedIntoId
 * (F24 候选治理合并 = 并入已有词作别名,不新建词条),校验失败 422。
 */
import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { KeywordMergeError, setKeywordStatus } from "@/lib/discovery/keywords";
import { KEYWORD_STATUSES } from "@/lib/discovery/status";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { parseBigIntId } from "@/lib/http/parse-id";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage discovery keywords";

const Body = z.object({
  status: z.enum(KEYWORD_STATUSES),
  // keyword id 为 int64,10 位上限会拒掉大 id;与路径口径一致放宽到 19 位
  mergedIntoId: z
    .string()
    .regex(/^\d{1,19}$/)
    .optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const bigId = parseBigIntId(id);
  if (bigId === null) return apiEnvelope(400, "invalid id");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "status 不合法");
  if (parsed.data.status === "merged" && !parsed.data.mergedIntoId)
    return apiEnvelope(400, "merged 需要 mergedIntoId");
  try {
    const row = await setKeywordStatus(bigId, parsed.data.status, {
      ...(parsed.data.mergedIntoId !== undefined
        ? { mergedIntoId: BigInt(parsed.data.mergedIntoId) }
        : {}),
    });
    return apiEnvelope(0, "ok", { id: row.id.toString(), status: row.status });
  } catch (e) {
    if (e instanceof KeywordMergeError) return apiEnvelope(422, e.message);
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return apiEnvelope(404, "关键词不存在");
    }
    throw e;
  }
}
