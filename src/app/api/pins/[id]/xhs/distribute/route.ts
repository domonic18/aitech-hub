/**
 * POST /api/pins/[id]/xhs/distribute(M49 批X3:贴图 → 小红书全自动发布)。
 * 贴图即物料直发:创建/复位渠道行 + 发布 job 入子队列(worker 调 gateway
 * Playwright 创作平台发布);失败自动重试 3 次,终态 failed 后界面「重新
 * 发布」复用本路由重新入队。零人工流程。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { parseBigIntId } from "@/lib/http/parse-id";
import { DistributeError, distributeErrorStatus } from "@/lib/distribute/errors";
import { enqueueXhsAutoPublish } from "@/lib/pins/xhs";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage pins";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const pinId = parseBigIntId(id);
  if (pinId === null) {
    return apiEnvelope(400, "贴图 id 不合法");
  }
  try {
    await enqueueXhsAutoPublish(pinId);
    return apiEnvelope(0, "ok", { status: "pending", channel: "xiaohongshu", auto: true });
  } catch (e) {
    if (e instanceof DistributeError) {
      return apiEnvelope(distributeErrorStatus(e.code), e.message);
    }
    throw e;
  }
}
