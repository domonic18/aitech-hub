/**
 * 文章批量软删(M31 验收反馈:列表多选批量删除):镜像单条 DELETE 语义
 * (softDeletePost,前台即刻不可见),逐条容错——不存在/已删等业务错跳过列
 * 原因,不废整批。守卫同单条(requireAdminForMutation,PAT 兼容)。
 */
import { type NextRequest } from "next/server";

import { PostAdminError, softDeletePost } from "@/lib/content/posts-admin";
import { batchIdsBodySchema, dedupeIds, type BatchOutcome } from "@/lib/http/batch";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

import { requireAdminForMutation } from "../shared";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = await requireAdminForMutation(req);
  if (denied) return denied;

  const parsed = batchIdsBodySchema().safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }
  const ids = dedupeIds(parsed.data.ids);
  const out: BatchOutcome = { updated: 0, skipped: [] };
  for (const id of ids) {
    try {
      await softDeletePost(BigInt(id));
      out.updated += 1;
    } catch (e) {
      if (!(e instanceof PostAdminError)) throw e;
      out.skipped.push({ id, reason: e.code });
    }
  }
  logger.info({ event: "post.batch_delete", total: ids.length, deleted: out.updated });
  return apiEnvelope(0, "ok", out);
}
