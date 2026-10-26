/**
 * 专题 API(M26 批③治理台,docs/plan/topic-pipeline-plan.md §8):GET 列表
 * (状态分段+分页+分段计数)/ POST 新建(标题必填,定位可选)。仅会话通道
 * (PAT 不得操纵专题,同 discovery/bloggers 口径)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { parseListSegment, parsePage } from "@/lib/admin/list";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import {
  TOPIC_LIST_SEGMENTS,
  TOPIC_OUTPUT_TYPES,
  type TopicOutputType,
} from "@/lib/topics/constants";
import { toTopicDto } from "@/lib/topics/dto";
import { createTopic, countByStatus, listTopics } from "@/lib/topics/repo";
import { topicCreateSchema } from "@/lib/topics/schemas";
import { deriveSkillKey } from "@/lib/topics/writing-config";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage topics";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const sp = req.nextUrl.searchParams;
  const segment = parseListSegment(TOPIC_LIST_SEGMENTS, sp.get("status") ?? undefined, "all");
  const rawOutput = sp.get("output") ?? undefined;
  const output = (TOPIC_OUTPUT_TYPES as readonly string[]).includes(rawOutput ?? "")
    ? (rawOutput as TopicOutputType)
    : undefined;
  const page = parsePage(sp.get("page") ?? undefined);
  const [{ items, total }, counts] = await Promise.all([
    listTopics({
      status: segment === "all" ? undefined : segment,
      ...(output ? { output } : {}),
      page,
    }),
    countByStatus(output),
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
  if (!parsed.success) {
    return apiEnvelope(400, "标题必填(1-200 字符),定位最长 1000 字符,主意图仅 article/pin");
  }
  // 形式 → skillKey 单点回写(M39 批②,同 PATCH 口径):定位命中预置形式时
  // 派生绑定;自定义/空串不绑(agent 侧自动匹配兜底)。贴图意图且未填长文
  // 定位时不绑写作技能(避免给贴图创作挂上文章指南)
  const skillKey =
    parsed.data.outputType === "pin" && parsed.data.positioning === undefined
      ? undefined
      : deriveSkillKey(parsed.data.positioning ?? null);
  const topic = await createTopic({ ...parsed.data, skillKey });
  return apiEnvelope(0, "created", toTopicDto(topic));
}
