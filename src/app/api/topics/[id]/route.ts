/**
 * 专题单条 API(M26 批③治理台,方案 §8):GET 详情(含素材水合出参)/
 * PATCH 定位字段与状态流转(字段与 status 可同请求;状态合法性按当前态在
 * repo 层校验,collecting→drafted 仅合成驱动属运营纪律,API 不另行收紧)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { toItemDto, toTopicDto } from "@/lib/topics/dto";
import { mapTopicError } from "@/lib/topics/http";
import { getTopic, hydrateItems, updateTopic, updateTopicStatus } from "@/lib/topics/repo";
import { topicStatusSchema, topicUpdateSchema } from "@/lib/topics/schemas";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage topics";

const ID_RE = /^\d{1,10}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!ID_RE.test(id)) return apiEnvelope(400, "invalid id");
  try {
    const topic = await getTopic(BigInt(id));
    const materials = await hydrateItems(topic.items);
    return apiEnvelope(0, "ok", {
      ...toTopicDto(topic, topic.items.length),
      items: topic.items.map((item) => toItemDto(item, materials.get(item.id))),
    });
  } catch (e) {
    const mapped = mapTopicError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!ID_RE.test(id)) return apiEnvelope(400, "invalid id");
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return apiEnvelope(400, "请求体须为 JSON 对象");
  // 字段组与 status 两组 schema 独立解析,任一命中即可(纯 status 体在字段组会
  // 因未知键剔除后为空而不命中,须先并判再拒,不能在字段组失败时提前 400)
  const parsed = topicUpdateSchema.safeParse(body);
  const status = topicStatusSchema.safeParse(body);
  if (!parsed.success && !status.success) {
    return apiEnvelope(400, "字段不合法(标题 1-200 / 定位 ≤1000 / 文章 id 纯数字 / status 枚举)");
  }
  try {
    let topic = await updateTopic(BigInt(id), parsed.success ? parsed.data : {});
    if (status.success) {
      topic = await updateTopicStatus(BigInt(id), status.data.status);
    }
    return apiEnvelope(0, "ok", toTopicDto(topic));
  } catch (e) {
    const mapped = mapTopicError(e);
    if (mapped) return mapped;
    throw e;
  }
}
