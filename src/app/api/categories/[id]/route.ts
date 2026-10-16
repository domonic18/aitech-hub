/** 分类更新与删除(2026-10-16 后台增删改查):更新不含 slug(URL 红线),
 * 删除守卫在 service(引用禁删/至少留一)。id 数字串解析复用 parsePostId。 */
import { type NextRequest, NextResponse } from "next/server";

import {
  CategoryUpdateSchema,
  deleteCategory,
  updateCategory,
} from "@/lib/content/categories-admin";
import { parsePostId } from "@/lib/content/posts-admin";
import { requireAdminForMutation } from "@/lib/http/mutation-guard";
import { apiEnvelope } from "@/lib/http/response";

import { categoryErrorResponse } from "../shared";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const denied = await requireAdminForMutation(req);
  if (denied) return denied;
  const { id } = await params;
  const numeric = parsePostId(id);
  if (numeric === null) return apiEnvelope(400, "invalid id");
  const parsed = CategoryUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, parsed.error.issues[0]?.message ?? "分类字段不合法");
  }
  try {
    const r = await updateCategory(numeric, parsed.data);
    return apiEnvelope(0, "updated", r);
  } catch (e) {
    const mapped = categoryErrorResponse(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const denied = await requireAdminForMutation(req);
  if (denied) return denied;
  const { id } = await params;
  const numeric = parsePostId(id);
  if (numeric === null) return apiEnvelope(400, "invalid id");
  try {
    await deleteCategory(numeric);
    return apiEnvelope(0, "deleted");
  } catch (e) {
    const mapped = categoryErrorResponse(e);
    if (mapped) return mapped;
    throw e;
  }
}
