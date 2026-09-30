/**
 * 下架(arch/05-services §5 content 行):回 draft 保留 publishedAt(展示态「已下架」),
 * 前台即刻不可见,可重新上架。
 */
import { type NextRequest } from "next/server";

import { unpublishPost } from "@/lib/content/posts-admin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

import { parsePostId, postErrorResponse, requireAdminForMutation } from "../../shared";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdminForMutation(req);
  if (denied) return denied;
  const { id: raw } = await ctx.params;
  const id = parsePostId(raw);
  if (id === null) return apiEnvelope(400, "invalid id");

  try {
    const { slug } = await unpublishPost(id);
    logger.info({ event: "post.unpublish", id: id.toString(), slug });
    return apiEnvelope(0, "ok", { slug });
  } catch (e) {
    return postErrorResponse(e);
  }
}
