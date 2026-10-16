/**
 * 分类管理 API(2026-10-16 验收反馈:后台增删改查):列表与新增。
 * 内容管理域,鉴权走 admin 会话/PAT 双路(requireAdminForMutation 同一守卫,
 * 读侧清单同样仅 admin);slug 承载公开 URL,校验沿用 post-schema slugSchema。
 */
import { type NextRequest, NextResponse } from "next/server";

import {
  CategoryCreateSchema,
  createCategory,
  listCategoriesAdmin,
} from "@/lib/content/categories-admin";
import { requireAdminForMutation } from "@/lib/http/mutation-guard";
import { apiEnvelope } from "@/lib/http/response";

import { categoryErrorResponse } from "./shared";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = await requireAdminForMutation(req);
  if (denied) return denied;
  const items = await listCategoriesAdmin();
  return apiEnvelope(0, "ok", { items });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const denied = await requireAdminForMutation(req);
  if (denied) return denied;
  const parsed = CategoryCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, parsed.error.issues[0]?.message ?? "分类字段不合法");
  }
  try {
    const r = await createCategory(parsed.data);
    return apiEnvelope(0, "created", r);
  } catch (e) {
    const mapped = categoryErrorResponse(e);
    if (mapped) return mapped;
    throw e;
  }
}
