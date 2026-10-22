/**
 * 专题单条 API(M26 批③治理台,方案 §8):GET 详情(含素材水合出参)/
 * PATCH 定位字段与状态流转(字段与 status 可同请求;状态合法性按当前态在
 * repo 层校验,collecting→drafted 仅合成驱动属运营纪律,API 不另行收紧)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { toItemDto, toTopicDto } from "@/lib/topics/dto";
import { mapTopicError } from "@/lib/topics/http";
import { hydrateItems } from "@/lib/topics/materials";
import { getTopic, updateTopic, updateTopicStatus } from "@/lib/topics/repo";
import { topicStatusSchema, topicUpdateSchema } from "@/lib/topics/schemas";
import { deriveSkillKey } from "@/lib/topics/writing-config";

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
    return apiEnvelope(
      400,
      "字段不合法(标题 1-200 / 定位与贴图配置 ≤1000 / 文章 id 与样例图 id 纯数字 / status 枚举 / outputType article|pin)",
    );
  }
  // skillKey 存在性核(soft ref 可解绑,但指向必须落在启用的 agent_skill 上)
  if (parsed.success && parsed.data.skillKey) {
    const skill = await prisma.agentSkill.findUnique({
      where: { key: parsed.data.skillKey },
      select: { enabled: true },
    });
    if (!skill || !skill.enabled) return apiEnvelope(400, "skillKey 不存在或已停用");
  }
  // 样例参照图存在性核(M39 批③,同 skillKey soft ref 口径:可解绑,指向必须存在)
  if (parsed.success && parsed.data.sampleImageId) {
    const sample = await prisma.writingSampleImage.findUnique({
      where: { id: BigInt(parsed.data.sampleImageId) },
      select: { id: true },
    });
    if (!sample) return apiEnvelope(400, "样例参照图不存在");
  }
  // 形式 → skillKey 单点回写(M39 批②):body 带 positioning 且未显式给
  // skillKey 时按预置形式派生绑定(自定义文本返回 undefined = 不动人工绑定)。
  // 派生值是注册表常量非用户输入,故在上面的存在性核之后注入、免核;专属
  // skill 种子落库前(批④)agent 侧经 list_skills 自动匹配兜底(topic-tools)。
  if (
    parsed.success &&
    parsed.data.positioning !== undefined &&
    parsed.data.skillKey === undefined
  ) {
    const derived = deriveSkillKey(parsed.data.positioning ?? null);
    if (derived !== undefined) parsed.data.skillKey = derived;
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
