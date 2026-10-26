/**
 * POST /api/pins/[id]/xhs/publish(M49 批X1'):小红书笔记链接回填。
 * body {noteUrl};仅收 xiaohongshu.com 域;pending → synced。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { parseBigIntId } from "@/lib/http/parse-id";
import { DistributeError, distributeErrorStatus } from "@/lib/distribute/errors";
import { backfillXhsNote } from "@/lib/pins/xhs";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage pins";
const publishInputSchema = z.object({
  noteUrl: z.string().url().max(500),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const pinId = parseBigIntId(id);
  if (pinId === null) {
    return apiEnvelope(400, "贴图 id 不合法");
  }
  const body = publishInputSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return apiEnvelope(400, "参数无效(链接格式?)");
  }
  try {
    await backfillXhsNote(pinId, body.data.noteUrl);
    return apiEnvelope(0, "ok");
  } catch (e) {
    if (e instanceof DistributeError) {
      return apiEnvelope(distributeErrorStatus(e.code), e.message);
    }
    throw e;
  }
}
