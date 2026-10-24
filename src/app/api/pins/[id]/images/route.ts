/**
 * 贴图图片序列 API(M41):POST 添加(工坊版本 versionIds[] 或本地上传
 * mediaPath 快照)/ PUT 序列重排(全量 id 有序数组)/ DELETE 移除单张
 * (?imageId=)。编辑态守卫(已同步/已发布禁改)在 repo 层。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { parseBigIntId } from "@/lib/http/parse-id";
import { mapPinError } from "@/lib/pins/http";
import { addPinImages, getPinDetail, removePinImage, reorderPinImages } from "@/lib/pins/repo";
import { pinImageAddSchema, pinImageReorderSchema } from "@/lib/pins/schemas";
import { toPinImageDto } from "@/lib/pins/dto";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage pins";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const bigId = parseBigIntId(id);
  if (bigId === null) return apiEnvelope(400, "invalid id");
  const parsed = pinImageAddSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, parsed.error.issues[0]?.message ?? "入参不合法");
  }
  try {
    const added = await addPinImages(bigId, parsed.data);
    const pin = await getPinDetail(bigId);
    return apiEnvelope(0, "added", {
      added,
      images: pin?.images.map(toPinImageDto) ?? [],
    });
  } catch (e) {
    const mapped = mapPinError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const bigId = parseBigIntId(id);
  if (bigId === null) return apiEnvelope(400, "invalid id");
  const parsed = pinImageReorderSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "ids 须为图片 id 有序数组");
  try {
    await reorderPinImages(bigId, parsed.data.ids);
    const pin = await getPinDetail(bigId);
    return apiEnvelope(0, "reordered", {
      images: pin?.images.map(toPinImageDto) ?? [],
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
  const imageId = req.nextUrl.searchParams.get("imageId") ?? "";
  if (!/^\d{1,10}$/.test(imageId)) return apiEnvelope(400, "imageId 须为纯数字");
  try {
    await removePinImage(bigId, BigInt(imageId));
    const pin = await getPinDetail(bigId);
    return apiEnvelope(0, "removed", {
      images: pin?.images.map(toPinImageDto) ?? [],
    });
  } catch (e) {
    const mapped = mapPinError(e);
    if (mapped) return mapped;
    throw e;
  }
}
