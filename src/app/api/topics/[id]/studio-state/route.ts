/**
 * 创作中心生成态轮询(M44 状态驱动交互):GET 当前落库快照
 * {status, updatedAt, linkedPostId, pinIds},前端「生成中→完成」比对用。
 * 轻查询:topic 裸 select(getTopicStateSnapshot)+ 贴图 id 集
 * (listPinIdsByTopic),不水合素材/贴图内容;守卫与 /api/topics/[id] 同款。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { parseBigIntId } from "@/lib/http/parse-id";
import { listPinIdsByTopic } from "@/lib/pins/repo";
import { mapTopicError } from "@/lib/topics/http";
import { getTopicStateSnapshot } from "@/lib/topics/repo";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage topics";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const bigId = parseBigIntId(id);
  if (bigId === null) return apiEnvelope(400, "invalid id");
  const topic = await getTopicStateSnapshot(bigId);
  if (!topic) return apiEnvelope(404, "创作不存在或已删除");
  try {
    const pinIds = await listPinIdsByTopic(bigId);
    return apiEnvelope(0, "ok", {
      status: topic.status,
      updatedAt: topic.updatedAt.toISOString(),
      linkedPostId: topic.linkedPostId ? topic.linkedPostId.toString() : null,
      pinIds,
    });
  } catch (e) {
    const mapped = mapTopicError(e);
    if (mapped) return mapped;
    throw e;
  }
}
