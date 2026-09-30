/**
 * 新建文章草稿(arch/05-services §5 content 行):POST /api/posts → 草稿。
 * slug 缺省由标题派生(normalizeSlug);发布走 /api/posts/[id]/publish。
 */
import { type NextRequest } from "next/server";

import { createPost } from "@/lib/content/posts-admin";
import { postCreateSchema } from "@/lib/content/post-schema";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

import { postErrorResponse, requireAdminForMutation } from "./shared";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = await requireAdminForMutation(req);
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiEnvelope(400, "invalid json");
  }
  const parsed = postCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }

  try {
    const { id, slug } = await createPost(parsed.data);
    logger.info({ event: "post.create", id: id.toString(), slug });
    return apiEnvelope(0, "ok", { id: id.toString(), slug });
  } catch (e) {
    return postErrorResponse(e);
  }
}
