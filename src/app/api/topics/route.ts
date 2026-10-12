/**
 * 专题 API(M26 批③治理台,docs/plan/topic-pipeline-plan.md §8):GET 列表
 * (状态分段+分页+分段计数)/ POST 新建(标题必填,定位可选)。仅会话通道
 * (PAT 不得操纵专题,同 discovery/bloggers 口径)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { parseListSegment, parsePage } from "@/lib/admin/list";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { TOPIC_LIST_SEGMENTS } from "@/lib/topics/constants";
import { toTopicDto } from "@/lib/topics/dto";
import { createTopic, countByStatus, listTopics } from "@/lib/topics/repo";
import { topicCreateSchema } from "@/lib/topics/schemas";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage topics";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const sp = req.nextUrl.searchParams;
  const segment = parseListSegment(TOPIC_LIST_SEGMENTS, sp.get("status") ?? undefined, "all");
  const page = parsePage(sp.get("page") ?? undefined);
  const [{ items, total }, counts] = await Promise.all([
    listTopics({ status: segment === "all" ? undefined : segment, page }),
    countByStatus(),
  ]);
  return apiEnvelope(0, "ok", {
    items: items.map((t) => toTopicDto(t)),
    total,
    counts,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = topicCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "标题必填(1-200 字符),定位最长 1000 字符");
  const topic = await createTopic(parsed.data);
  return apiEnvelope(0, "created", toTopicDto(topic));
}
