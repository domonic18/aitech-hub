/**
 * 贴图单条 API(M41):GET 详情(图片序列+渠道留痕)/ PATCH 文案字段与状态
 * 流转(字段与 status 可同请求;流转合法性按当前态在 repo 层校验;已同步/
 * 已发布禁直编内容,先撤回待验收)/ DELETE 删除(级联图片与渠道行)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { parseBigIntId } from "@/lib/http/parse-id";
import { toPinChannelDto, toPinDto, toPinImageDto } from "@/lib/pins/dto";
import { mapPinError } from "@/lib/pins/http";
import { deletePin, getPinDetail, setPinStatus, updatePin } from "@/lib/pins/repo";
import { pinStatusSchema, pinUpdateSchema } from "@/lib/pins/schemas";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage pins";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const bigId = parseBigIntId(id);
  if (bigId === null) return apiEnvelope(400, "invalid id");
  const pin = await getPinDetail(bigId);
  if (!pin) return apiEnvelope(404, "贴图不存在");
  return apiEnvelope(0, "ok", {
    ...toPinDto(pin, pin.images.length),
    images: pin.images.map(toPinImageDto),
    channels: pin.channels.map(toPinChannelDto),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const bigId = parseBigIntId(id);
  if (bigId === null) return apiEnvelope(400, "invalid id");
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return apiEnvelope(400, "请求体须为 JSON 对象");
  // 字段组与 status 组独立解析,任一命中即可(同 topics PATCH 口径)
  const fieldParsed = pinUpdateSchema.safeParse(body);
  const statusParsed = pinStatusSchema.safeParse(body);
  if (!fieldParsed.success && !statusParsed.success) {
    return apiEnvelope(400, fieldParsed.error.issues[0]?.message ?? "入参不合法");
  }
  try {
    if (fieldParsed.success) await updatePin(bigId, fieldParsed.data);
    if (statusParsed.success) await setPinStatus(bigId, statusParsed.data.status);
    const pin = await getPinDetail(bigId);
    if (!pin) return apiEnvelope(404, "贴图不存在");
    return apiEnvelope(0, "updated", {
      ...toPinDto(pin, pin.images.length),
      images: pin.images.map(toPinImageDto),
      channels: pin.channels.map(toPinChannelDto),
    });
  } catch (e) {
    const mapped = mapPinError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const bigId = parseBigIntId(id);
  if (bigId === null) return apiEnvelope(400, "invalid id");
  try {
    await deletePin(bigId);
    return apiEnvelope(0, "deleted");
  } catch (e) {
    const mapped = mapPinError(e);
    if (mapped) return mapped;
    throw e;
  }
}
