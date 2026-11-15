/**
 * GET /api/topics/[id]/export(D5,2026-11-15):创作素材包导出——创作职责迁到
 * 线下 Claude Code 后,站内创作中心保留「素材台账 + 写作配置 + 导出给线下」,
 * 本路由是那份导出的唯一出口。
 *
 * 鉴权:仅会话(admin 创作中心交互面);PAT 拒——Topic 是站内创作项目状态机,
 * D6 裁定不向外部通道开放(arch/05 PAT_DENY 口径)。
 */
import { type NextRequest } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { parseBigIntId } from "@/lib/http/parse-id";
import { TopicError } from "@/lib/topics/errors";
import { buildTopicExportBundle } from "@/lib/topics/export-bundle";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await requireSessionActor(req, "PAT 不能导出创作素材包");
  if (actor.kind === "reject") return actor.response;

  const { id } = await params;
  const topicId = parseBigIntId(id);
  if (topicId === null) return apiEnvelope(400, "创作 id 不合法");

  try {
    const bundle = await buildTopicExportBundle(topicId);
    return apiEnvelope(0, "ok", bundle);
  } catch (e) {
    if (e instanceof TopicError && e.code === "not_found") return apiEnvelope(404, e.message);
    return apiEnvelope(500, e instanceof Error ? e.message : "导出失败");
  }
}
