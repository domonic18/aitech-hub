/**
 * POST /api/distribute/xiaohongshu/publish(M49 批X2):人工发布确认回填。
 * body {postId, noteUrl};仅收 xiaohongshu.com 域链接,ready/synced 可回填。
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { parsePostId } from "@/lib/content/posts-admin";
import { DistributeError, distributeErrorStatus } from "@/lib/distribute/errors";
import { publishXhsNote } from "@/lib/distribute/xhs";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const publishInputSchema = z.object({
  postId: z.string().regex(/^\d{1,19}$/),
  noteUrl: z.string().url().max(500),
});

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, "PAT 不能回填分发结果");
  if (actor.kind === "reject") return actor.response;
  const body = publishInputSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return apiEnvelope(400, "参数无效(链接格式?)");
  }
  try {
    await publishXhsNote(BigInt(body.data.postId), body.data.noteUrl);
    return apiEnvelope(0, "ok");
  } catch (e) {
    if (e instanceof DistributeError) {
      return apiEnvelope(distributeErrorStatus(e.code), e.message);
    }
    throw e;
  }
}
