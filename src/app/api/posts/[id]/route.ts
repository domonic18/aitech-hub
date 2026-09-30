/**
 * 文章更新(PUT)与软删(DELETE)(arch/05-services §5 content 行)。
 * 旧文保真:纯 HTML 正文拒绝改写(409);软删前台即刻不可见、列表不显示。
 */
import { type NextRequest, NextResponse } from "next/server";

import { postUpdateSchema } from "@/lib/content/post-schema";
import { softDeletePost, updatePost } from "@/lib/content/posts-admin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

import { parsePostId, postErrorResponse, requireAdminForMutation } from "../shared";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

async function withId(req: NextRequest, ctx: Ctx): Promise<{ id: bigint } | NextResponse> {
  const denied = await requireAdminForMutation(req);
  if (denied) return denied;
  const { id: raw } = await ctx.params;
  const id = parsePostId(raw);
  if (id === null) return apiEnvelope(400, "invalid id");
  return { id };
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await withId(req, ctx);
  if (guard instanceof NextResponse) return guard;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiEnvelope(400, "invalid json");
  }
  const parsed = postUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }

  try {
    const { slug } = await updatePost(guard.id, parsed.data);
    logger.info({ event: "post.update", id: guard.id.toString(), slug });
    return apiEnvelope(0, "ok", { slug });
  } catch (e) {
    return postErrorResponse(e);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await withId(req, ctx);
  if (guard instanceof NextResponse) return guard;

  try {
    const { slug } = await softDeletePost(guard.id);
    logger.info({ event: "post.delete", id: guard.id.toString(), slug });
    return apiEnvelope(0, "ok", { slug });
  } catch (e) {
    return postErrorResponse(e);
  }
}
