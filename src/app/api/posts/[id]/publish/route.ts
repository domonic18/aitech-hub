/**
 * 发布(arch/05-services §5 content 行):置 published + 按需 revalidate,前台即时可见。
 * 首次发布落 publishedAt;已下架重发保留原发布时间。
 */
import { type NextRequest } from "next/server";

import { parsePostId, publishPost } from "@/lib/content/posts-admin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

import { postErrorResponse, requireAdminForMutation } from "../../shared";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdminForMutation(req);
  if (denied) return denied;
  const { id: raw } = await ctx.params;
  const id = parsePostId(raw);
  if (id === null) return apiEnvelope(400, "invalid id");

  try {
    const { slug } = await publishPost(id);
    logger.info({ event: "post.publish", id: id.toString(), slug });
    return apiEnvelope(0, "ok", { slug });
  } catch (e) {
    return postErrorResponse(e);
  }
}
