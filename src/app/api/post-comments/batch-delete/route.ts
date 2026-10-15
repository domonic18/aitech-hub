/**
 * 评论批量删除(M31 验收反馈):逐条镜像单条 DELETE 语义(deleteCommentWithReplies
 * 连带直接子与点赞行,单条事务),不存在/已删跳过列原因不废整批。守卫同单条
 * (isSameOrigin + requireAdminRequest,PAT 拒);操作者进审计日志。
 */
import { type NextRequest } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { deleteCommentWithReplies } from "@/lib/comment/comment-admin";
import { CommentError } from "@/lib/comment/comment-service";
import { batchIdsBodySchema, dedupeIds, type BatchOutcome } from "@/lib/http/batch";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const admin = await requireAdminRequest(req);
  if (!admin) return apiEnvelope(401, "unauthorized");

  const parsed = batchIdsBodySchema().safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }
  const ids = dedupeIds(parsed.data.ids);
  const out: BatchOutcome = { updated: 0, skipped: [] };
  let cascadeTotal = 0;
  for (const id of ids) {
    try {
      const { deleted } = await deleteCommentWithReplies(BigInt(id));
      out.updated += 1;
      cascadeTotal += deleted;
    } catch (e) {
      // 单条失败(含不存在 P2025)不废整批;意外错误同口径跳过并记日志
      logger.warn({
        event: "comment.batch_delete_skip",
        commentId: id,
        error: e instanceof Error ? e.message : String(e),
      });
      out.skipped.push({
        id,
        reason: e instanceof CommentError && e.code === "not_found" ? "不存在" : "失败",
      });
    }
  }
  logger.info({
    event: "comment.batch_deleted",
    operatorId: admin.sub,
    total: ids.length,
    comments: out.updated,
    cascadeRows: cascadeTotal,
  });
  return apiEnvelope(0, "ok", out);
}
