/**
 * 博主编辑/删除(M8 批③):编辑全量表单;删除两步武装——启用中 409,
 * 停用后才可物理删(telegram.video_blogger 冗余已隔离,不级联)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import {
  BloggerAdminError,
  BloggerUpdateSchema,
  deleteBlogger,
  updateBlogger,
} from "@/lib/telegram/bloggers-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage bloggers";

function mapError(e: BloggerAdminError): NextResponse {
  const status =
    e.code === "not_found"
      ? 404
      : e.code === "duplicate" || e.code === "enabled" || e.code === "disabled"
        ? 409
        : 400;
  return apiEnvelope(status, e.message);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return apiEnvelope(400, "invalid id");
  const parsed = BloggerUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "编辑字段不合法(昵称/分类/间隔)");
  try {
    const r = await updateBlogger(Number(id), parsed.data);
    return apiEnvelope(0, "updated", r);
  } catch (e) {
    if (e instanceof BloggerAdminError) return mapError(e);
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
  if (!/^\d{1,10}$/.test(id)) return apiEnvelope(400, "invalid id");
  try {
    await deleteBlogger(Number(id));
    return apiEnvelope(0, "deleted");
  } catch (e) {
    if (e instanceof BloggerAdminError) return mapError(e);
    throw e;
  }
}
