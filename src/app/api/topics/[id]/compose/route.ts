/**
 * 专题合成 API(M26 批④,方案 §5/§8):POST 同步调 LLM 起草 → 落 content_post
 * 草稿并锚定(≤15s 形态,超时受绑定模型 timeoutSec 约束)。重合成保护(§10-3):
 * 关联文档被人工编辑过(或人工关联未合成过)→ 409 needConfirm,客户端确认后带
 * confirm=true 重发覆盖。未绑 compose 模型 400 人话;无素材 400;PAT 拒。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { AiAdminError, AiClientError, aiErrorStatus } from "@/lib/ai/errors";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { isPostAdminError, composeTopicDraft, needsRecomposeConfirm } from "@/lib/topics/compose";
import { getTopic } from "@/lib/topics/repo";
import { mapTopicError } from "@/lib/topics/http";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage topics";

const ID_RE = /^\d{1,10}$/;

const Body = z.object({ confirm: z.boolean().default(false) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!ID_RE.test(id)) return apiEnvelope(400, "invalid id");
  const parsed = Body.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) return apiEnvelope(400, "请求体须为 {confirm?: boolean}");
  try {
    const topic = await getTopic(BigInt(id));
    if (topic.items.length === 0) {
      return apiEnvelope(400, "尚未挂载素材——先挂 2~3 条解读/文章再合成");
    }
    // 重合成保护:关联文档存在且人工动过 → 409 需确认(软删弃锚直接新建)
    const linked =
      topic.linkedPostId !== null
        ? await prisma.post.findUnique({
            where: { id: topic.linkedPostId },
            select: { status: true, updatedAt: true },
          })
        : null;
    if (
      !parsed.data.confirm &&
      linked &&
      linked.status !== "deleted" &&
      needsRecomposeConfirm(topic, linked)
    ) {
      return apiEnvelope(409, "关联文档在合成后被人工编辑过,重合成将覆盖这些改动——确认覆盖吗?", {
        needConfirm: true,
      });
    }
    const outcome = await composeTopicDraft(topic);
    logger.info({
      event: "topic.composed",
      topicId: id,
      postId: outcome.postId.toString(),
      recomposed: outcome.recomposed,
      materials: topic.items.length,
    });
    return apiEnvelope(0, outcome.recomposed ? "已重合成(覆盖原文档)" : "已合成初稿", {
      postId: outcome.postId.toString(),
      postTitle: outcome.postTitle,
      recomposed: outcome.recomposed,
      coverPath: outcome.coverPath,
    });
  } catch (e) {
    if (e instanceof AiAdminError) return apiEnvelope(aiErrorStatus(e.code), e.message);
    if (e instanceof AiClientError) {
      logger.warn({ event: "topic.compose_failed", topicId: id, kind: e.kind });
      return apiEnvelope(502, `LLM 调用失败:${e.message}`.slice(0, 300));
    }
    if (isPostAdminError(e)) return apiEnvelope(409, e.message);
    const mapped = mapTopicError(e);
    if (mapped) return mapped;
    throw e;
  }
}
